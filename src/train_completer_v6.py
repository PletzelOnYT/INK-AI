#!/usr/bin/env python3
"""Train a V6 handwriting trajectory GRU with prefix-centered coordinates and balanced lifts.

The original stroke GRU was teacher-forced with coordinates normalized to the
whole completed glyph. During live use the completed bounding box is unknown;
the browser can only normalize the strokes drawn so far. These two frames are
different, particularly during early prefixes. This script removes that
train/inference mismatch, then fine-tunes with scheduled sampling.

Training: real ordered UJI writer-disjoint pen traces and separately labeled
procedural symbol trajectories. No external model or template lookup.
Evaluation: unseen writers, real prefix-only frame, free-running trajectory
error and lifted-pen recall. A checkpoint is only published if this improves.
"""
from __future__ import annotations
import argparse
import json
import math
import random
import sys
import time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch.utils.data import DataLoader, WeightedRandomSampler

sys.path.insert(0, str(Path(__file__).resolve().parent))
from train import CHARS, SEED
from train_stroke_sequence import Strokes, fetch_uji, parse_uji, recipes, MAX_STEPS, export
from train_stroke_sequence_v2 import load_published
from train_prefix_completion import prefix_rollout_batch, modal_token, mdn_step_loss
from train_stroke_sequence import MIXTURES
from torch import nn

HARD = set("hnbmrukapgqofeIil1jJ0OoQ9B6Ss5zZ2+≠÷=:")
FOCUS = set("hnbmrukapgqofe")
CUTS = (5,6,6,8,8,10,10,12,12,16,20,24)
FOCUS_WEIGHTS = {"h":9.0,"n":5.0,"m":5.0,"b":4.0,"r":4.0,
                 "u":3.5,"k":6.0,"a":3.5,"p":3.5,"g":3.5,
                 "q":3.5,"o":3.0,"f":3.0,"e":3.0,
                 "x":8.0,"i":7.0,"j":7.0,"t":6.0,"A":4.0,"H":5.0,"X":6.0}

def human_trajectory_loss(model,seq,labels,length,cut,steps,teacher_probability):
    """Gradients for real next strokes AND long-horizon position drift.

    The existing GRU is trained autoregressively in the same prefix-only frame
    the browser uses. No font, script-specific template, or fake outline.
    The predicted position remains differentiable while the recurrent input
    uses scheduled sampling. Balanced lift / EOS terms discourage endless tails.
    """
    emb=model.embedding(labels)
    bsz=len(seq)
    out,hidden=model.rnn(torch.cat([
        seq[:,:cut],emb[:,None,:].expand(-1,cut,-1)],dim=2))
    logits=model.head(out[:,-1])
    predicted_position=seq[:,:cut,:2].sum(dim=1)
    actual_position=predicted_position.detach().clone()
    sum_loss=logits.sum()*0.
    mass=logits.sum()*0.
    for idx in range(cut,min(MAX_STEPS,cut+steps)):
        active=(length>idx).float()
        if not bool(active.any()):break
        expected=seq[:,idx]
        proposed=modal_token(logits)
        actual_position=actual_position+expected[:,:2]
        predicted_position=predicted_position+proposed[:,:2]
        local_nll=mdn_step_loss(logits,expected)
        # Absolute endpoint behavior in the *visible-prefix* coordinate frame.
        drift=nn.functional.smooth_l1_loss(
            predicted_position,actual_position,beta=.13,reduction="none").sum(dim=1)
        # Learn actual next-token lift and stop labels, including stroke ends.
        up=expected[:,2]<.5
        lift=nn.functional.binary_cross_entropy_with_logits(
            logits[:,5*MIXTURES],expected[:,2],reduction="none")
        lift_weight=torch.where(up,9.0,1.0)
        ending=((length-1)==idx).float()
        stop=nn.functional.binary_cross_entropy_with_logits(
            logits[:,5*MIXTURES+1],ending,reduction="none",
            pos_weight=expected.new_tensor(7.0))
        weight=1.+.45*(idx-cut)/max(1,steps-1)
        step_loss=local_nll+.27*drift+.25*lift*lift_weight+.27*stop
        sum_loss=sum_loss+(step_loss*active*weight).sum()
        mass=mass+(active*weight).sum()
        # Mix teacher and actual generated token, without backpropagating
        # through the discrete mixture component sampling choices.
        next_token=proposed.detach()
        mask=(torch.rand(bsz,device=seq.device)<teacher_probability)[:,None]
        recurrent=torch.where(mask,expected,next_token)
        out,hidden=model.rnn(torch.cat([recurrent,emb],dim=1)[:,None,:],hidden)
        logits=model.head(out[:,0])
    return sum_loss/mass.clamp(min=1)


def prefix_frame(batch, cut, floor=0.32, growth=1/.68):
    """Vectorized prefix-only frame centered like released glyph training.

    Input and output are [batch, MAX_STEPS, dx,dy,pen_state] tensors.
    The frame uses ONLY the first 'cut' available pen positions. Future
    positions play no role in determining the coordinate system.
    """
    if batch.ndim != 3 or batch.shape[2] != 3 or cut < 2:
        raise ValueError("Expected [B,T,3] strokes with visible prefix")
    positions = torch.cumsum(batch[:, :, :2], dim=1)
    visible = positions[:, :cut]
    low = visible.amin(dim=1)
    high = visible.amax(dim=1)
    span = (high-low).amax(dim=1, keepdim=True)
    size = torch.clamp(span * growth, min=floor, max=1.35)
    origin = (low + high - size) / 2  # centered: matches camera/pen UI V6
    reframed = batch.clone()
    reframed[:, 0, :2] = (positions[:, 0] - origin)/size
    reframed[:, 1:, :2] = batch[:, 1:, :2]/size[:, None, :]
    return reframed

@torch.inference_mode()
def validate_rollout(model, dataset, seed, count=640, cut_points=(8, 13, 21)):
    """Evaluate future motion WITHOUT using future ink to normalize input.

    Report position error in the model's prefix-derived coordinate system;
    compare both models on the exact same samples / cutpoints.
    """
    model.eval()
    gen = random.Random(seed)
    indices = list(range(len(dataset)))
    gen.shuffle(indices)
    selected = torch.utils.data.Subset(dataset, indices[:min(count,len(indices))])
    loader = DataLoader(selected, batch_size=64, num_workers=0)
    total_err=0.0
    weight_sum=0.0
    lift_tp=lift_fp=lift_fn=0
    nsteps=0
    per_cut={}
    for cut in cut_points:
        err=weight=0.0
        for samples,labels,lengths in loader:
            relevant=lengths>=cut+11
            if not bool(relevant.any()):continue
            samples=samples[relevant]
            labels=labels[relevant]
            actual=prefix_frame(samples,cut)
            emb=model.embedding(labels)
            history=torch.cat([actual[:,:cut],
                emb[:,None,:].expand(-1,cut,-1)],dim=2)
            state,h=model.rnn(history)
            output=model.head(state[:,-1])
            last=actual[:,:cut,:2].sum(dim=1)
            ground=last.clone()
            for offset in range(12):
                idx=cut+offset
                generated=modal_token(output)
                ground=ground+actual[:,idx,:2]
                last=last+generated[:,:2]
                difference=torch.linalg.vector_norm(last-ground,dim=1)
                factor=.6+.4*offset/11
                err+=float(difference.sum())*factor
                weight+=len(samples)*factor
                nsteps+=len(samples)
                lifted=actual[:,idx,2]<.5
                predicted=generated[:,2]<.5
                lift_tp+=int((lifted&predicted).sum())
                lift_fp+=int(((~lifted)&predicted).sum())
                lift_fn+=int((lifted&(~predicted)).sum())
                output,h=model.rnn(torch.cat([generated,emb],dim=1)[:,None,:],h)
                output=model.head(output[:,0])
        per_cut[str(cut)]=round(err/max(weight,1.),6)
        total_err+=err
        weight_sum+=weight
    precision=lift_tp/max(1,lift_tp+lift_fp)
    recall=lift_tp/max(1,lift_tp+lift_fn)
    f1=2*precision*recall/max(1e-8,precision+recall)
    return {"prefix_frame_position_error":round(total_err/max(weight_sum,1.),6),
            "pen_lift_f1":round(f1,6),
            "pen_lift_precision":round(precision,6),
            "pen_lift_recall":round(recall,6),
            "eval_steps":nsteps,
            "cut_errors":per_cut}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--data",default=".data/ujipenchars2")
    ap.add_argument("--source",default="models/ink-stroke-prefix-domain-v2.json")
    ap.add_argument("--output",default="models/ink-stroke-prefix-domain-v6.json")
    ap.add_argument("--epochs",type=int,default=10)
    ap.add_argument("--samples-per-epoch",type=int,default=24000)
    ap.add_argument("--batch",type=int,default=96)
    ap.add_argument("--tail-steps",type=int,default=20)
    args=ap.parse_args()
    torch.set_num_threads(4)
    random.seed(SEED+3841);np.random.seed(SEED+3841);torch.manual_seed(SEED+3841)
    raw=parse_uji(fetch_uji(args.data))
    train=[(c,strokes) for c,writer,split,strokes in raw if split=="train"]
    test=[(c,writer,strokes) for c,writer,split,strokes in raw if split=="test"]
    writers=sorted({w for _,w,_ in test})
    random.Random(SEED+1784).shuffle(writers)
    selection=set(writers[:len(writers)//2])
    independent=set(writers[len(writers)//2:])
    cal=Strokes([(c,p) for c,w,p in test if w in selection],augment=False)
    final=Strokes([(c,p) for c,w,p in test if w in independent],augment=False)
    assert len(cal)>1100 and len(final)>1100
    coverage=Counter(c for c,_ in train)
    symbols=recipes()
    missing=[c for c in CHARS if c not in coverage]
    if set(missing)-set(symbols):raise ValueError("Missing glyph trajectory examples")
    synthetic=[(c,symbols[c]) for c in missing for _ in range(240)]
    training=Strokes(train+synthetic,augment=True)
    counts=Counter(c for c,_ in training.records)
    weights=torch.tensor([counts[c]**(-.62)*(FOCUS_WEIGHTS.get(c,1.4 if c in HARD else .72))
       for c,_ in training.records],dtype=torch.double)
    base=load_published(args.source)
    old_cal=validate_rollout(base,cal,seed=SEED+1400,count=640)
    old_final=validate_rollout(base,final,seed=SEED+1403,count=640)
    focus_cal=Strokes([(c,p) for c,w,p in test if w in selection and c in FOCUS],
                      augment=False)
    focus_final=Strokes([(c,p) for c,w,p in test if w in independent and c in FOCUS],
                        augment=False)
    assert len(focus_cal)>90 and len(focus_final)>90
    focus_baseline=validate_rollout(base,focus_final,seed=SEED+1603,
                                   count=500,cut_points=(8,13,21))
    print("BASE PREFIX-ONLY FRAME:",json.dumps({"cal":old_cal,"independent":old_final}),flush=True)
    trained=load_published(args.source)
    seen=0;best=None;history=[]
    for epoch in range(args.epochs):
        started=time.monotonic()
        model_loader=DataLoader(training,batch_size=args.batch,num_workers=2,
            sampler=WeightedRandomSampler(weights,args.samples_per_epoch,
              replacement=True,generator=torch.Generator().manual_seed(SEED+epoch+3847)))
        optim=torch.optim.AdamW(trained.parameters(),
             lr=.000072 if epoch<3 else (.000035 if epoch<6 else .000015),weight_decay=.00008)
        trained.train()
        loss_sum=0.0;observed=0
        for step,(seq,labels,lengths) in enumerate(model_loader):
            cut=random.choice(CUTS)
            active=lengths>=cut+4
            if not bool(active.any()):continue
            seq=prefix_frame(seq[active],cut,
                floor=random.uniform(.29,.38),growth=random.uniform(1.4,1.54))
            labels=labels[active];lengths=lengths[active]
            # Learn to recover from the GRU's own movement predictions,
            # not only from perfect recorded handwriting coordinates.
            loss=human_trajectory_loss(trained,seq,labels,lengths,
                cut=cut,steps=args.tail_steps,
                teacher_probability=max(.40,.70-.052*epoch))
            optim.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(trained.parameters(),1.)
            optim.step()
            num=len(seq);observed+=num;seen+=num;loss_sum+=float(loss)*num
        score=validate_rollout(trained,cal,seed=SEED+1400,count=480)
        hard_score=validate_rollout(trained,focus_cal,seed=SEED+1603,
                                    count=500,cut_points=(8,13,21))
        selection_score=.67*score["prefix_frame_position_error"] + (
                         .33*hard_score["prefix_frame_position_error"])
        row={"epoch":epoch+1,"loss":round(loss_sum/max(observed,1),5),
             "calibration":score,"focus_calibration":hard_score,
             "selection_score":round(selection_score,6),"samples_seen":seen,
             "seconds":round(time.monotonic()-started,1)}
        history.append(row)
        print("DOMAIN PREFIX EPOCH:",json.dumps(row),flush=True)
        if best is None or row["selection_score"]<best["selection_score"]:
            best=row
            export(trained,args.output,{
                "heldout_nll":score["prefix_frame_position_error"],
                "heldout_pen_state_accuracy":score["pen_lift_f1"],
                "heldout_glyphs":len(cal)},{
                "prefix_tuned":True,
                "prefix_domain_v2":True,
                "prefix_domain_v6":True,
                "fine_tuned_own_model":args.source,
                "causal_long_horizon_geometry_loss":True,
                "real_training_glyphs":len(train),
                "real_writer_holdout_glyphs":len(test),
                "writer_disjoint_validation":True,
                "all_supported_classes":len(CHARS),
                "training_presentations":seen,
                "not_a_raster_generator":True})
    best_model=load_published(args.output)
    new_cal=validate_rollout(best_model,cal,seed=SEED+1400,count=640)
    new_final=validate_rollout(best_model,final,seed=SEED+1403,count=640)
    focus_candidate=validate_rollout(best_model,focus_final,seed=SEED+1603,
                                    count=500,cut_points=(8,13,21))
    old=old_final["prefix_frame_position_error"]
    new=new_final["prefix_frame_position_error"]
    gain=(old-new)/max(old,1e-9)
    # Pen-lift F1 may be 0 for a model that never lifts the pen. Avoid
    # accepting a candidate that significantly worsens this separate metric.
    lift_gate=new_final["pen_lift_f1"]>=old_final["pen_lift_f1"]-.025
    focus_gain=(focus_baseline["prefix_frame_position_error"]-
                focus_candidate["prefix_frame_position_error"])/max(
                focus_baseline["prefix_frame_position_error"],1e-9)
    cal_gain=(old_cal["prefix_frame_position_error"]-
              new_cal["prefix_frame_position_error"])/max(
              old_cal["prefix_frame_position_error"],1e-9)
    accepted=(gain>=.025 and cal_gain>=.012 and
        focus_gain>=.025 and lift_gate and
        new_final["pen_lift_f1"]>=.12 and
        new_final["pen_lift_precision"]>=.10 and
        new_final["cut_errors"]["8"]<=old_final["cut_errors"]["8"]*1.01)
    stats={
      "eligible":bool(accepted),
      "source":args.source,"parameters":sum(p.numel() for p in trained.parameters()),
      "candidate_version":6,"deployable":False,
      "focus_chars":"".join(sorted(FOCUS)),
      "focus":{"baseline":focus_baseline,"candidate":focus_candidate,
               "gain":round(focus_gain,6)},
      "calibration_gain":round(cal_gain,6),
      "real_training_glyphs":len(train),"real_independent_glyphs":len(final),
      "synthetic_symbols":len(synthetic),"seen":seen,
      "baseline":{"calibration":old_cal,"independent":old_final},
      "candidate":{"calibration":new_cal,"independent":new_final},
      "gain":round(gain,6),"best":best,"epochs":history,
      "metric_description":"Free-running twelve-step displacement with centered prefix-only frames, independent unseen-writer lift F1, not whole-character accuracy.",
      "requires_browser_integration":True
    }
    Path("models/stroke-prefix-domain-v6-metrics.json").write_text(json.dumps(stats,indent=2))
    if not accepted:
        Path(args.output).unlink(missing_ok=True)
        print("REJECT: V6 centered-prefix motion did not improve unseen-writer paths",flush=True)
    else:print("CANDIDATE: V6 passed initial writer-disjoint gates; needs browser validation",stats["gain"],flush=True)

if __name__=="__main__":
    main()
