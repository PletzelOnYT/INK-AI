#!/usr/bin/env python3
"""Repair the rare pen-lift prediction head of INK AI's online stroke model.

A separate writer-heldout evaluation showed zero pen-lift F1 for the existing
GRU (argmax kept the pen down nearly always). Train ONLY the pen-state output
row against recorded human pen lifts plus explicit procedural multistroke
symbols. Preserve all mixture trajectories, class embeddings and GRU weights.
Publish only when rare pen lifts improve on independent writers and free-run
position accuracy is not materially degraded.
"""
from __future__ import annotations
import argparse,json,random,sys
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,WeightedRandomSampler
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,SEED
from train_stroke_sequence import (
 Strokes,fetch_uji,parse_uji,recipes,MAX_STEPS,MIXTURES,export
)
from train_stroke_sequence_v2 import load_published
from train_prefix_domain_v2 import validate_rollout

PEN_ROW=5*MIXTURES

@torch.inference_mode()
def evaluate_pen_lifts(model,data,limit=None):
    model.eval()
    if limit is not None:
        data=torch.utils.data.Subset(data,list(range(min(limit,len(data)))))
    loader=DataLoader(data,batch_size=96,num_workers=2)
    tp=fp=fn=tn=0
    for seq,labels,length in loader:
        emb=model.embedding(labels)
        h,_=model.rnn(torch.cat([seq,
            emb[:,None,:].expand(-1,MAX_STEPS,-1)],dim=2))
        out=model.head(h[:,:-1])
        valid=torch.arange(MAX_STEPS-1)[None,:]<length[:,None]-1
        truth=(seq[:,1:,2]<.5)&valid
        guess=(out[:,:,PEN_ROW]<0)&valid
        tp+=int((truth&guess).sum())
        fp+=int((~truth&guess&valid).sum())
        fn+=int((truth&~guess).sum())
        tn+=int((~truth&~guess&valid).sum())
    prec=tp/max(1,tp+fp);rec=tp/max(1,tp+fn)
    return {
      "pen_lift_f1":round(2*prec*rec/max(prec+rec,1e-9),6),
      "pen_lift_precision":round(prec,6),
      "pen_lift_recall":round(rec,6),
      "true_lifts":tp+fn,"predicted_lifts":tp+fp,
      "true_positive":tp,"false_positive":fp,
      "normal_pen_down_accuracy":round(tn/max(1,tn+fp),6)
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",default="models/ink-stroke-prefix-domain-v2.json")
    p.add_argument("--output",default="models/ink-stroke-penlift-v3.json")
    p.add_argument("--epochs",type=int,default=5)
    p.add_argument("--per-epoch",type=int,default=21000)
    p.add_argument("--batch",type=int,default=96)
    p.add_argument("--data",default=".data/ujipenchars2")
    a=p.parse_args()
    torch.manual_seed(SEED+2601);np.random.seed(SEED+2601)
    random.seed(SEED+2601);torch.set_num_threads(4)
    if not Path(a.source).exists():raise RuntimeError("No trained domain model")
    records=parse_uji(fetch_uji(a.data))
    train=[(c,ps) for c,_,split,ps in records if split=="train"]
    held=[(c,w,ps) for c,w,split,ps in records if split=="test"]
    writers=sorted({w for _,w,_ in held})
    random.Random(SEED+1784).shuffle(writers)
    calwriters=set(writers[:len(writers)//2])
    testwriters=set(writers[len(writers)//2:])
    calibration=Strokes([(c,ps) for c,w,ps in held if w in calwriters],augment=False)
    independent=Strokes([(c,ps) for c,w,ps in held if w in testwriters],augment=False)
    assert len(calibration)>1100 and len(independent)>1100
    counts=Counter(c for c,_ in train)
    symbols=recipes()
    missing=[c for c in CHARS if c not in counts]
    assert set(missing)<=set(symbols)
    examples=[(c,symbols[c]) for c in missing for _ in range(330)]
    dataset=Strokes(train+examples,augment=True)
    weights=torch.tensor([
      (2.6 if len(paths)>=2 else .6)*counts.get(c,330)**(-.50)
      for c,paths in dataset.records],dtype=torch.double)
    model=load_published(a.source)
    for q in model.parameters():q.requires_grad_(False)
    # Separate trainable parameters for exactly one output head row.
    lift_w=nn.Parameter(model.head.weight[PEN_ROW].detach().clone())
    lift_b=nn.Parameter(model.head.bias[PEN_ROW].detach().clone())
    baseline_cal=evaluate_pen_lifts(model,calibration)
    baseline_final=evaluate_pen_lifts(model,independent)
    baseline_position=validate_rollout(model,independent,seed=SEED+1403,count=380)
    print("PEN-LIFT BASELINE:",baseline_cal,baseline_final,
          "PREFIX POSITION:",baseline_position,flush=True)
    best=None;history=[];seen=0
    for epoch in range(1,a.epochs+1):
        model.train()
        optim=torch.optim.AdamW([lift_w,lift_b],lr=.003 if epoch<=3 else .001,
                                  weight_decay=.00002)
        loader=DataLoader(dataset,batch_size=a.batch,num_workers=2,
             sampler=WeightedRandomSampler(weights,a.per_epoch,replacement=True,
                generator=torch.Generator().manual_seed(SEED+2602+epoch)))
        loss_total=0;num=0
        for seq,labels,length in loader:
            with torch.no_grad():
                emb=model.embedding(labels)
                out,_=model.rnn(torch.cat([seq,
                  emb[:,None,:].expand(-1,MAX_STEPS,-1)],dim=2))
            h=out[:,:-1]
            pred=torch.matmul(h,lift_w)+lift_b
            truth=seq[:,1:,2]
            valid=(torch.arange(MAX_STEPS-1)[None,:]<length[:,None]-1)
            bce=nn.functional.binary_cross_entropy_with_logits(
                 pred,truth,reduction="none")
            reweight=torch.where(truth<.5,11.0,1.0)
            loss=(bce*reweight*valid).sum()/valid.sum().clamp(min=1)
            optim.zero_grad(set_to_none=True);loss.backward()
            torch.nn.utils.clip_grad_norm_([lift_w,lift_b],2.)
            optim.step()
            loss_total+=float(loss)*len(seq);num+=len(seq);seen+=len(seq)
        with torch.no_grad():
            model.head.weight[PEN_ROW].copy_(lift_w)
            model.head.bias[PEN_ROW].copy_(lift_b)
        cal=evaluate_pen_lifts(model,calibration)
        row={"epoch":epoch,"train_loss":round(loss_total/max(num,1),6),
             "calibration":cal,"seen":seen}
        history.append(row)
        print("PEN LIFT EPOCH:",json.dumps(row),flush=True)
        # Select using calibration writers; independent writers remain unseen.
        objective=cal["pen_lift_f1"]+.03*cal["normal_pen_down_accuracy"]
        if best is None or objective>best["objective"]:
            best={"epoch":epoch,"objective":objective,"calibration":cal}
            export(model,a.output,{
               "heldout_pen_lift_f1":cal["pen_lift_f1"],
               "heldout_glyphs":len(calibration)},{
               "fine_tuned_own_model":a.source,
               "penlift_calibrated_v3":True,
               "prefix_tuned":True,"prefix_domain_v2":True,
               "real_training_glyphs":len(train),
               "real_writer_holdout_glyphs":len(held),
               "writer_disjoint_validation":True,
               "all_supported_classes":len(CHARS),
               "training_presentations":seen,
               "not_a_raster_generator":True})
    candidate=load_published(a.output)
    final=evaluate_pen_lifts(candidate,independent)
    position=validate_rollout(candidate,independent,seed=SEED+1403,count=380)
    allowable=baseline_position["prefix_frame_position_error"]*1.06
    accepted=(final["pen_lift_f1"]>=max(.20,baseline_final["pen_lift_f1"]+.12)
              and final["pen_lift_precision"]>=.20
              and final["pen_lift_recall"]>=.20
              and final["normal_pen_down_accuracy"]>=.97
              and position["prefix_frame_position_error"]<=allowable)
    report={
       "eligible":bool(accepted),"source":a.source,
       "baseline":{"calibration":baseline_cal,"independent":baseline_final,
                   "prefix_position":baseline_position},
       "candidate":{"calibration":best["calibration"],"independent":final,
                   "prefix_position":position},
       "train_glyphs":len(train),"test_glyphs":len(independent),
       "best_epoch":best["epoch"],"seen":seen,"epochs":history,
       "criterion":"Pen-up F1 precision and recall on writers excluded from training and epoch selection, with prefix trajectory position error <= 106% of baseline"
    }
    Path("models/penlift-v3-metrics.json").write_text(json.dumps(report,indent=2))
    if not accepted:
        Path(a.output).unlink(missing_ok=True)
        print("REJECT: pen-lift head does not preserve shape and lift accuracy",flush=True)
    else:print("ACCEPT: neural pen-lift completion improved",json.dumps(final),flush=True)

if __name__=="__main__":main()
