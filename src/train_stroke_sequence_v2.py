#!/usr/bin/env python3
"""Train a larger original sequence-to-sequence handwriting completion V2.

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

HIDDEN=336
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
    p.add_argument("--epochs",type=int,default=9)
    p.add_argument("--fine-epochs",type=int,default=3)
    p.add_argument("--samples-per-epoch",type=int,default=18500)
    p.add_argument("--batch",type=int,default=128)
    p.add_argument("--real-data",default=".data/ujipenchars2")
    p.add_argument("--out",default="models/ink-stroke-sequence-v2.json")
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
    reference=load_published("models/ink-stroke-sequence-v1.json")
    baseline_val=quality(reference,val_loader)
    baseline_final=quality(reference,final_loader)
    print("V1 BASELINE calibration",baseline_val,"INDEPENDENT",baseline_final,flush=True)
    model=SeqMDN(hidden=HIDDEN)
    parameters=sum(x.numel() for x in model.parameters())
    assert 1_000_000<parameters<1_300_000,parameters
    print("NEW V2 MODEL PARAMETERS:",parameters,"REAL UJI:",len(train_real),
          "WRITER-DISJOINT CAL:",len(val),"FINAL:",len(final),
          "SYNTHETIC:",len(synthesized),flush=True)
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
            loss=measured["nll"]
            epoch_info={"stage":stage,"epoch":ep+1,
              "train_loss":round(loss_sum/args.samples_per_epoch,5),
              "calibration":measured,
              "seconds":round(time.monotonic()-t0,1)}
            history.append(epoch_info)
            print("EVALUATION",epoch_info,flush=True)
            # Save best genuine neural checkpoint irrespective of release
            # eligibility; final held-out acceptance is checked later.
            if best is None or loss<best["calibration"]["nll"]:
                best={"calibration":measured,"stage":stage,"epoch":ep+1,
                      "presentations":seen}
                export(model,args.out,{
                    "heldout_nll":loss,
                    "heldout_pen_state_accuracy":measured["pen_state_accuracy"],
                    "heldout_glyphs":measured["heldout_glyphs"],
                    "heldout_pen_lift_f1":measured["pen_lift_f1"]},
                    {"real_training_glyphs":len(train_real),
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
    # Prevent publishing a larger-but-dumber model. Evaluation on separate
    # writers is never used to select an epoch.
    valid=(cal_v2["nll"]<=baseline_val["nll"]-.025 and
       final_v2["nll"]<=baseline_final["nll"]-.025 and
       final_v2["pen_lift_f1"]>=baseline_final["pen_lift_f1"]-.02)
    stats={
        "eligible":bool(valid),"parameter_count":parameters,
        "baseline_v1":{"calibration":baseline_val,"independent":baseline_final},
        "v2":{"calibration":cal_v2,"independent":final_v2},
        "best":best,"history":history,
        "total_presentations":seen,
        "real_human_trajectory_samples":len(train_real),
        "writer_disjoint_test_samples":len(final),
        "synthetic_symbol_examples":len(synthesized),
        "selection_rule":"V2 needs improved NLL on both writer-separated splits and non-regressed pen-lift F1"
    }
    Path("models/stroke-sequence-v2-metrics.json").write_text(json.dumps(stats,indent=2))
    if not valid:
        Path(args.out).unlink(missing_ok=True)
        print("V2 DID NOT IMPROVE ENOUGH: retain original V1 generation",flush=True)
    else:
        print("RELEASE ACCEPTED",parameters,"parameters",stats["v2"],flush=True)
if __name__=="__main__":main()
