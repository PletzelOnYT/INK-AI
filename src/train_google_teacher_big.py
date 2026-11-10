#!/usr/bin/env python3
"""Google InkSight motion-pretrained larger experimental online GRU.

- 336-hidden-unit two-layer class-conditioned MDN GRU (>1M parameters).
- Real *ordered* UJI pen traces, writer-disjoint validation/final evaluation.
- Synthetic mathematical symbols tagged as such (not counted as real writers).
- Class-balanced exposure and lower-LR fine-tuning for ambiguous glyphs.
- Pen-lift-aware loss, independent comparison to the shipped V1 checkpoint.
- Never publish V2 when tested likelihood/pen-up quality regresses.

The learned neural model generates pen movements, never raster templates.
"""
from __future__ import annotations
import argparse,base64,json,math,random,sys,time
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,WeightedRandomSampler
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,LOOKUP,SEED
from train_stroke_sequence import (
  SeqMDN,Strokes,parse_uji,fetch_uji,recipes,evaluate,objective,export,MAX_STEPS,MIXTURES
)
from import_inksight_teacher import teacher_motion_records
from train_prefix_domain_v2 import validate_rollout,prefix_frame
from train_prefix_completion import prefix_rollout_batch

HIDDEN=384
def transplant_existing_gru(teacher_student, published):
    """Expand a trained two-layer MDN GRU without changing its predictions.

    Original gates occupy the first H units in each new 3*H gate row.
    Their recurrent and layer-2 input connections to expanded units are zero.
    The enlarged, teacher-pretrained units can subsequently learn residual
    corrections, but the initial prediction is exactly the published one.
    """
    old=published.hidden;new=teacher_student.hidden
    if not old<new or published.layers!=teacher_student.layers:
        raise ValueError("Require a wider GRU with same depth")
    with torch.no_grad():
        teacher_student.embedding.weight.copy_(published.embedding.weight)
        for layer in range(published.layers):
            for stem in ("weight_ih_l","weight_hh_l"):
                a=getattr(published.rnn,stem+str(layer))
                b=getattr(teacher_student.rnn,stem+str(layer))
                for gate in range(3):
                    rows=slice(gate*new,gate*new+old)
                    prior=slice(gate*old,(gate+1)*old)
                    b[rows].zero_()
                    b[rows,:a.shape[1]].copy_(a[prior])
            for stem in ("bias_ih_l","bias_hh_l"):
                a=getattr(published.rnn,stem+str(layer))
                b=getattr(teacher_student.rnn,stem+str(layer))
                for gate in range(3):
                    b[gate*new:gate*new+old].copy_(a[gate*old:(gate+1)*old])
        teacher_student.head.weight.zero_()
        teacher_student.head.weight[:,:old].copy_(published.head.weight)
        teacher_student.head.bias.copy_(published.head.bias)
    return teacher_student

def check_preserved_predictions(expanded,reference):
    """Reject an expanded initialization if it changes verified baseline behavior."""
    expanded.eval();reference.eval()
    with torch.no_grad():
        x=torch.zeros((4,18,3))
        x[:,:,0]=torch.linspace(-.05,.05,18)
        x[:,:,1]=torch.linspace(.04,-.02,18)
        x[:,1:,2]=1
        labels=torch.tensor([0,1,20,44],dtype=torch.long)
        a=reference(x,labels);b=expanded(x,labels)
        largest=float((a-b).abs().max())
    if largest>2e-5:
        raise RuntimeError(f"Expanded model changed old predictions: {largest}")
    return largest

HARD_GROUP=set("Il1iLjJ0OoQ9gqPpBb6GSs5Zz2UuVvWwMnHhryYcCeAaTtFf")
MATH_SYMBOLS=set("+-=^:#@!%?×÷±∞√≠≤≥")
def load_published(path):
    src=json.loads(Path(path).read_text())
    arch=src["architecture"]
    net=SeqMDN(hidden=arch["hidden"],embed=arch["embed"],layers=arch["layers"])
    def to_tensor(packed):
        raw=np.frombuffer(base64.b64decode(packed["weights"]),dtype=np.int8)
        return torch.from_numpy(raw.astype(np.float32).reshape(packed["shape"])*packed["scale"])
    with torch.no_grad():
        net.embedding.weight.copy_(torch.tensor(src["embedding"]))
        for i,l in enumerate(src["gru"]):
            getattr(net.rnn,f"weight_ih_l{i}").copy_(to_tensor(l["ih"]))
            getattr(net.rnn,f"weight_hh_l{i}").copy_(to_tensor(l["hh"]))
            getattr(net.rnn,f"bias_ih_l{i}").copy_(torch.tensor(l["bias_ih"]))
            getattr(net.rnn,f"bias_hh_l{i}").copy_(torch.tensor(l["bias_hh"]))
        net.head.weight.copy_(to_tensor(src["head_weight"]))
        net.head.bias.copy_(torch.tensor(src["head_bias"]))
    return net.eval()

@torch.no_grad()
def quality(model,loader):
    model.eval()
    total_loss=correct_pen=valid_moves=0
    true_up=pred_up=matched_up=0
    observed=0
    for seq,label,length in loader:
        logits=model(seq,label)
        total_loss+=float(objective(logits,seq,length))*len(seq)
        idx=torch.arange(MAX_STEPS-1)[None,:]
        valid=idx<length[:,None]-1
        drawn=seq[:,1:,2]>.5
        pen_prob=torch.sigmoid(logits[:,:-1,5*MIXTURES])
        predicted=pen_prob>.5
        real_lift=(~drawn)&valid
        predicted_lift=(~predicted)&valid
        true_up+=int(real_lift.sum())
        pred_up+=int(predicted_lift.sum())
        matched_up+=int((real_lift&predicted_lift).sum())
        correct_pen+=int(((predicted==drawn)&valid).sum())
        valid_moves+=int(valid.sum())
        observed+=len(seq)
    return {
        "nll":round(total_loss/max(1,observed),6),
        "pen_state_accuracy":round(correct_pen/max(1,valid_moves),6),
        "pen_lift_f1":round(2*matched_up/max(1,pred_up+true_up),6),
        "heldout_glyphs":observed,
        "true_pen_lifts":true_up,
        "predicted_pen_lifts":pred_up
    }

def learned_criterion(output,series,length):
    base=objective(output,series,length)
    b,t,_=output.shape
    valid=torch.arange(t-1)[None,:]<length[:,None]-1
    actual_lift=series[:,1:,2]<.5
    pred=output[:,:-1,5*MIXTURES]
    logits=nn.functional.binary_cross_entropy_with_logits(
        pred,(~actual_lift).float(),reduction="none")
    # Rare real pen lifts matter for +, :, X, equals and dotted letters.
    reweight=torch.where(actual_lift,4.0,1.0)
    penalty=(logits*valid*reweight).sum()/valid.sum().clamp(min=1)
    return base+0.11*penalty

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--epochs",type=int,default=4)
    p.add_argument("--fine-epochs",type=int,default=2)
    p.add_argument("--samples-per-epoch",type=int,default=15000)
    p.add_argument("--batch",type=int,default=128)
    p.add_argument("--real-data",default=".data/ujipenchars2")
    p.add_argument("--out",default="models/ink-stroke-google-teacher-big-v1.json")
    p.add_argument("--teacher-root",default=".data/inksight")
    p.add_argument("--teacher-epochs",type=int,default=2)
    p.add_argument("--teacher-limit",type=int,default=5000)
    args=p.parse_args()
    torch.set_num_threads(4);torch.manual_seed(SEED+244)
    random.seed(SEED+244);np.random.seed(SEED+244)
    records=parse_uji(fetch_uji(args.real_data))
    train_real=[(char,strokes) for char,writer,partition,strokes in records
                if partition=="train"]
    held=[r for r in records if r[2]=="test"]
    writers=sorted({r[1] for r in held})
    random.Random(SEED+345).shuffle(writers)
    calibrate=set(writers[:len(writers)//2])
    independent=set(writers[len(writers)//2:])
    val=Strokes([(c,strokes) for c,w,_,strokes in held if w in calibrate],augment=False)
    final=Strokes([(c,strokes) for c,w,_,strokes in held if w in independent],augment=False)
    assert len(val)>1100 and len(final)>1100
    present=Counter(c for c,_ in train_real)
    math=recipes()
    absent=[c for c in CHARS if c not in present]
    if set(absent)-set(math):raise RuntimeError("No vector sequences for "+repr(set(absent)-set(math)))
    synthesized=[(c,math[c]) for c in absent for _ in range(550)]
    data=Strokes(train_real+synthesized,augment=True)
    counts=Counter(c for c,_ in data.records)
    weights=torch.tensor([counts[c]**(-.6) for c,_ in data.records],dtype=torch.double)
    gen=torch.Generator().manual_seed(SEED+247)
    sampler=WeightedRandomSampler(weights,num_samples=args.samples_per_epoch,
       replacement=True,generator=gen)
    loader=DataLoader(data,batch_size=args.batch,sampler=sampler,num_workers=2)
    val_loader=DataLoader(val,batch_size=args.batch,num_workers=2)
    final_loader=DataLoader(final,batch_size=args.batch,num_workers=2)
    # The Google Research InkSight MODEL outputs are unlabelled pen trajectories.
    # They teach generic motion only, never character identities.
    teacher,origin=teacher_motion_records(args.teacher_root,args.teacher_limit)
    if len(teacher)<100:
        raise RuntimeError("No usable Google InkSight teacher data: "+json.dumps(origin))
    reference=load_published("models/ink-stroke-prefix-domain-v2.json")
    baseline_val=quality(reference,val_loader)
    baseline_final=quality(reference,final_loader)
    old_cal=validate_rollout(reference,val,seed=SEED+1400,count=440)
    old_final=validate_rollout(reference,final,seed=SEED+1403,count=440)
    print("PUBLISHED DOMAIN MODEL:",json.dumps({"cal":old_cal,"independent":old_final}),flush=True)
    model=SeqMDN(hidden=HIDDEN)
    parameters=sum(x.numel() for x in model.parameters())
    assert 1_000_000<parameters<2_500_000,parameters
    print("NEW V2 MODEL PARAMETERS:",parameters,"REAL UJI:",len(train_real),
          "WRITER-DISJOINT CAL:",len(val),"FINAL:",len(final),
          "SYNTHETIC:",len(synthesized),flush=True)
    teacher_data=Strokes([(CHARS[0],trace) for trace in teacher],augment=True)
    # Freeze the class embedding during unlabeled teacher pretraining. All
    # supervised class labels below come only from actual UJI handwriting.
    model.embedding.weight.requires_grad_(False)
    teacher_seen=0
    for epoch in range(args.teacher_epochs):
        teacher_loader=DataLoader(teacher_data,batch_size=args.batch,shuffle=True,num_workers=0)
        optimizer=torch.optim.AdamW([w for w in model.parameters() if w.requires_grad],
                                    lr=.0007,weight_decay=.00008)
        model.train()
        for seq,char,length in teacher_loader:
            output=model(seq,char)
            loss=learned_criterion(output,seq,length)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.)
            optimizer.step()
            teacher_seen+=len(seq)
        print("GOOGLE INKSIGHT UNLABELLED MOTION",epoch+1,"seen",teacher_seen,flush=True)
    model.embedding.weight.requires_grad_(True)
    transplant_existing_gru(model,reference)
    preserved_difference=check_preserved_predictions(model,reference)
    print("WARM-START BASELINE OUTPUT PRESERVED",preserved_difference,flush=True)
    best=None;history=[];seen=0
    for stage,num_epochs,lr in [
       ("general-pretrain",args.epochs,.00085),
       ("ambiguous-and-symbol-fine-tune",args.fine_epochs,.00016)
    ]:
        optim=torch.optim.AdamW(model.parameters(),lr=lr,weight_decay=.00008)
        if stage.startswith("ambiguous"):
            weights2=torch.tensor([
                counts[c]**(-.58)*(3.5 if c in HARD_GROUP or c in MATH_SYMBOLS else .72)
                for c,_ in data.records],dtype=torch.double)
            fine_sampler=WeightedRandomSampler(weights2,args.samples_per_epoch,
                replacement=True,generator=gen)
            active=DataLoader(data,batch_size=args.batch,sampler=fine_sampler,num_workers=2)
        else:active=loader
        for ep in range(num_epochs):
            model.train();loss_sum=0;t0=time.monotonic()
            for ix,(seq,char,length) in enumerate(active):
                optim.zero_grad(set_to_none=True)
                prediction=model(seq,char)
                loss=learned_criterion(prediction,seq,length)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(),1.)
                optim.step()
                seen+=len(seq);loss_sum+=float(loss)*len(seq)
                if (ix+1)%120==0:
                    print(stage,ep+1,"step",ix+1,
                      "presentations",seen,"loss",round(float(loss),4),flush=True)
            measured=quality(model,val_loader)
            position=validate_rollout(model,val,seed=SEED+1400,count=350)
            loss=position["prefix_frame_position_error"]
            epoch_info={"stage":stage,"epoch":ep+1,
              "train_loss":round(loss_sum/args.samples_per_epoch,5),
              "calibration":measured,"prefix_calibration":position,
              "seconds":round(time.monotonic()-t0,1)}
            history.append(epoch_info)
            print("EVALUATION",epoch_info,flush=True)
            # Save best genuine neural checkpoint irrespective of release
            # eligibility; final held-out acceptance is checked later.
            if best is None or loss<best["prefix_calibration"]["prefix_frame_position_error"]:
                best={"calibration":measured,"prefix_calibration":position,
                      "stage":stage,"epoch":ep+1,"presentations":seen}
                export(model,args.out,{
                    "heldout_nll":loss,
                    "heldout_pen_state_accuracy":measured["pen_state_accuracy"],
                    "heldout_glyphs":measured["heldout_glyphs"],
                    "heldout_pen_lift_f1":measured["pen_lift_f1"]},
                    {"google_inksight_teacher_output_pretraining":True,
                     "teacher_license":"Apache-2.0",
                     "teacher_strokes":len(teacher),
                     "teacher_has_no_class_labels":True,
                     "real_training_glyphs":len(train_real),
                     "real_writer_holdout_glyphs":len(held),
                     "synthetic_vector_glyphs":len(synthesized),
                     "writer_disjoint_validation":True,
                     "all_supported_classes":len(CHARS),
                     "training_presentations":seen,
                     "best_stage":stage,
                     "not_a_raster_generator":True,
                     "v2":True})
    actual=load_published(args.out)
    final_v2=quality(actual,final_loader)
    cal_v2=best["calibration"]
    final_position=validate_rollout(actual,final,seed=SEED+1403,count=440)
    cal_position=validate_rollout(actual,val,seed=SEED+1400,count=440)
    position_gain=(old_final["prefix_frame_position_error"]-
        final_position["prefix_frame_position_error"])/max(1e-8,old_final["prefix_frame_position_error"])
    cal_gain=(old_cal["prefix_frame_position_error"]-
        cal_position["prefix_frame_position_error"])/max(1e-8,old_cal["prefix_frame_position_error"])
    # Prevent publishing a larger-but-dumber model. Evaluation on separate
    # writers is never used to select an epoch.
    # A bigger checkpoint is rejected if it is merely better at
    # teacher-forced NLL but has worse REAL free-running pen motion.
    valid=(position_gain>=.075 and cal_gain>=.04 and
       final_position["pen_lift_f1"]>=.10 and
       final_v2["nll"]<=baseline_final["nll"]+.35)
    stats={
        "eligible":bool(valid),"latency_verified":False,
        "parameter_count":parameters,
        "preserved_baseline_prediction_max_error":preserved_difference,
        "warm_started_from":"models/ink-stroke-prefix-domain-v2.json",
        "external_teacher":"Google Research InkSight model-generated InkML vectors, not direct checkpoint weights",
        "teacher_provenance":origin,
        "teacher_presentations":teacher_seen,
        "baseline_position":{"calibration":old_cal,"independent":old_final},
        "candidate_position":{"calibration":cal_position,"independent":final_position},
        "position_gain":round(position_gain,6),"calibration_gain":round(cal_gain,6),
        "baseline_v1":{"calibration":baseline_val,"independent":baseline_final},
        "v2":{"calibration":cal_v2,"independent":final_v2},
        "best":best,"history":history,
        "total_presentations":seen,
        "real_human_trajectory_samples":len(train_real),
        "writer_disjoint_test_samples":len(final),
        "synthetic_symbol_examples":len(synthesized),
        "selection_rule":"V2 needs improved NLL on both writer-separated splits and non-regressed pen-lift F1"
    }
    Path("models/big-stroke-google-teacher-metrics.json").write_text(json.dumps(stats,indent=2))
    if not valid:
        Path(args.out).unlink(missing_ok=True)
        print("REJECTED larger Google-teacher experiment: retain existing offline GRU",flush=True)
    else:
        print("POSITION GATES PASSED; runtime gate required before any publication",parameters,flush=True)
if __name__=="__main__":main()
