#!/usr/bin/env python3
"""V5 handwriting motion: jointly train recurrent pen-up features with frozen
geometric output rows, distilling the released GRU's actual trajectory model.

The older pen-lift attempt only trained ONE output row. That cannot recover
from recurrent states that never encode imminent multi-stroke pen lifts.
V5 updates recurrent motion features while using the baseline's trajectory
outputs as a teacher so strokes do not drift or turn into linear artifacts.

Training uses UJI real pen (x,y) trajectories and labeled synthetic punctuation
separately; independent test writers are not used for optimization or bias
calibration. This is NOT a user-facing success-rate benchmark.
"""
from __future__ import annotations
import argparse,copy,json,random,sys,time
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,WeightedRandomSampler
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,SEED
from train_stroke_sequence import Strokes,fetch_uji,parse_uji,recipes,MAX_STEPS,MIXTURES,export
from train_stroke_sequence_v2 import load_published
from train_prefix_domain_v2 import validate_rollout
from train_pen_lift_head_v3 import collect_pen_logits,pen_lift_metrics,choose_pen_bias

PEN_ROW=5*MIXTURES
def block_geometry_row_gradients(grad):
    mask=torch.zeros_like(grad)
    mask[PEN_ROW]=1
    return grad*mask

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--epochs",type=int,default=8)
    ap.add_argument("--per-epoch",type=int,default=17500)
    ap.add_argument("--batch",type=int,default=96)
    ap.add_argument("--source",default="models/ink-stroke-prefix-domain-v2.json")
    ap.add_argument("--output",default="models/ink-stroke-lift-aware-v5.json")
    ap.add_argument("--data",default=".data/ujipenchars2")
    a=ap.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(SEED+5093);random.seed(SEED+5093);np.random.seed(SEED+5093)
    records=parse_uji(fetch_uji(a.data))
    train=[(c,ps) for c,_,partition,ps in records if partition=="train"]
    test=[(c,w,ps) for c,w,partition,ps in records if partition=="test"]
    writers=sorted({w for _,w,_ in test})
    random.Random(SEED+1784).shuffle(writers)
    calwriters=set(writers[:len(writers)//2]);testwriters=set(writers[len(writers)//2:])
    cal=Strokes([(c,p) for c,w,p in test if w in calwriters],augment=False)
    final=Strokes([(c,p) for c,w,p in test if w in testwriters],augment=False)
    assert len(cal)>1000 and len(final)>1000
    count=Counter(c for c,_ in train)
    symbols=recipes();missing=[c for c in CHARS if c not in count]
    if set(missing)-set(symbols):raise RuntimeError("Unknown classes absent from UJI")
    synthetic=[(c,symbols[c]) for c in missing for _ in range(180)]
    samples=Strokes(train+synthetic,augment=True)
    weights=torch.tensor([
      count.get(c,180)**(-.55)*(8 if len(paths)>1 else .35)
      for c,paths in samples.records],dtype=torch.double)
    teacher=load_published(a.source).eval()
    student=load_published(a.source)
    for v in teacher.parameters():v.requires_grad_(False)
    student.head.weight.register_hook(block_geometry_row_gradients)
    student.head.bias.register_hook(block_geometry_row_gradients)
    base_cal=pen_lift_metrics(*collect_pen_logits(teacher,cal))
    base_final=pen_lift_metrics(*collect_pen_logits(teacher,final))
    base_pos=validate_rollout(teacher,final,seed=SEED+1403,count=420)
    history=[];best=None;seen=0
    for epoch in range(1,a.epochs+1):
        t0=time.monotonic();student.train()
        optim=torch.optim.AdamW(student.parameters(),
            lr=.00010 if epoch<=3 else (.000055 if epoch<=6 else .000025),
            weight_decay=.00003)
        loader=DataLoader(samples,batch_size=a.batch,num_workers=0,
           sampler=WeightedRandomSampler(weights,a.per_epoch,replacement=True,
            generator=torch.Generator().manual_seed(SEED+5094+epoch)))
        acc=0.;n=0
        for seq,label,length in loader:
            with torch.no_grad():original=teacher(seq,label)
            pred=student(seq,label)
            truth=seq[:,1:,2]<.5
            valid=(torch.arange(MAX_STEPS-1)[None,:]<(length-1)[:,None])
            bce=nn.functional.binary_cross_entropy_with_logits(
                -pred[:,:-1,PEN_ROW],truth.float(),reduction="none")
            factor=torch.where(truth,12.,1.)
            lift_loss=(bce*factor*valid).sum()/valid.sum().clamp(min=1)
            # The motion decoder remains a real model; prevent its recurrent
            # state update from moving human-pen geometry away from baseline.
            geom=(pred[:,:-1,:PEN_ROW]-original[:,:-1,:PEN_ROW]).square().mean(dim=2)
            stop=(pred[:,:-1,PEN_ROW+1]-original[:,:-1,PEN_ROW+1]).square()
            geometry=((geom+.25*stop)*valid).sum()/valid.sum().clamp(min=1)
            loss=lift_loss+.42*geometry
            optim.zero_grad(set_to_none=True);loss.backward()
            nn.utils.clip_grad_norm_(student.parameters(),.9);optim.step()
            seen+=len(seq);acc+=float(loss)*len(seq);n+=len(seq)
        student.eval()
        logits,labels=collect_pen_logits(student,cal,limit=1200)
        offset,cal_metrics=choose_pen_bias(logits,labels,min_down_accuracy=.965)
        row={"epoch":epoch,"train_loss":round(acc/max(1,n),6),
             "calibration":cal_metrics,"offset":offset,
             "seen":seen,"seconds":round(time.monotonic()-t0,1)}
        history.append(row)
        print("RECURRENT PEN LIFT EPOCH:",json.dumps(row),flush=True)
        score=cal_metrics["pen_lift_f1"]+.015*cal_metrics["normal_pen_down_accuracy"]
        if best is None or score>best["score"]:
            best={**row,"score":score}
            ready=copy.deepcopy(student)
            with torch.no_grad():ready.head.bias[PEN_ROW].add_(offset)
            export(ready,a.output,{"heldout_pen_lift_f1":cal_metrics["pen_lift_f1"],
                 "heldout_glyphs":len(cal)},{
                   "recurrent_lift_v5":True,"prefix_domain_v2":True,
                   "fine_tuned_own_model":a.source,
                   "real_training_glyphs":len(train),
                   "writer_disjoint_validation":True,
                   "training_presentations":seen,
                   "geometry_teacher_distillation":True,
                   "no_font_templates":True})
    candidate=load_published(a.output)
    final_metrics=pen_lift_metrics(*collect_pen_logits(candidate,final))
    final_position=validate_rollout(candidate,final,seed=SEED+1403,count=420)
    valid=(final_metrics["pen_lift_f1"]>=.15 and
       final_metrics["pen_lift_precision"]>=.15 and
       final_metrics["pen_lift_recall"]>=.20 and
       final_metrics["normal_pen_down_accuracy"]>=.965 and
       final_position["prefix_frame_position_error"]<=
          base_pos["prefix_frame_position_error"]*1.05)
    report={
     "eligible":bool(valid),"candidate_version":5,
     "source":a.source,"calibration_glyphs":len(cal),
     "independent_writer_glyphs":len(final),
     "real_training_glyphs":len(train),"seen":seen,
     "baseline":{"calibration":base_cal,"independent":base_final,
                  "position":base_pos},
     "candidate":{"calibration":best["calibration"],
                   "independent":final_metrics,"position":final_position},
     "best":best,"history":history,
     "evaluation":"Independent human writers; pen-up F1, precision, recall, false-up specificity and natural vector trajectory drift",
    }
    Path("models/recurrent-lift-v5-metrics.json").write_text(json.dumps(report,indent=2))
    if not valid:
        Path(a.output).unlink(missing_ok=True)
        print("REJECT: V5 recurrent lift did not pass human-writer and shape gates",flush=True)
    else:print("PASS V5 recurrent pen-lift and trajectory quality gates",flush=True)

if __name__=="__main__":main()
