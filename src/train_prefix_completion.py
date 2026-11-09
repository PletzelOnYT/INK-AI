#!/usr/bin/env python3
"""Fine-tune REAL online pen-trajectory GRU for completing unfinished glyphs.

Unlike next-token teacher forcing on the full sequence, this curriculum:
- cuts at diverse partial-character positions;
- feeds back the model's OWN predicted strokes for part of the remainder;
- learns to recover from accumulated drift and to terminate appropriately;
- prioritizes lowercase h/n/m/r and other confusable partial characters;
- tests free-running tail displacement on writers excluded from training.
Publishes only if independent writer tests improve. No glyph templates or
externally pretrained AI weights are used.
"""
import argparse,json,math,random,sys,time
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,WeightedRandomSampler
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,SEED
from train_stroke_sequence import (
 Strokes,parse_uji,fetch_uji,recipes,MAX_STEPS,MIXTURES,export
)
from train_stroke_sequence_v2 import load_published,quality

FOCUS=set("hnmrubkfgpdaeiIl1Oo0Q9gqBb6S5Z2")
def mdn_step_loss(logits,target):
    k=MIXTURES
    mix=logits[:,:k]
    mx=logits[:,k:2*k]
    my=logits[:,2*k:3*k]
    sx=logits[:,3*k:4*k].clamp(-5,1)
    sy=logits[:,4*k:5*k].clamp(-5,1)
    dx=target[:,0,None];dy=target[:,1,None]
    logp=-math.log(2*math.pi)-sx-sy-.5*(
      ((dx-mx)*torch.exp(-sx)).square()+
      ((dy-my)*torch.exp(-sy)).square())
    nll=-torch.logsumexp(torch.log_softmax(mix,dim=-1)+logp,dim=-1)
    bce=nn.functional.binary_cross_entropy_with_logits(
        logits[:,5*k],target[:,2],reduction="none")
    weighted_pen=torch.where(target[:,2]<.5,3.0,1.0)*bce
    return nll+.20*weighted_pen

def modal_token(logits):
    k=MIXTURES
    ix=logits[:,:k].argmax(dim=1)
    mx=logits[:,k:2*k].gather(1,ix[:,None]).squeeze(1)
    my=logits[:,2*k:3*k].gather(1,ix[:,None]).squeeze(1)
    draw=(torch.sigmoid(logits[:,5*k])>.5).float()
    return torch.stack([mx.clamp(-.14,.14),my.clamp(-.14,.14),draw],dim=1)

def prefix_rollout_batch(net,seq,labels,length,cut,steps,teacher_probability,training):
    B=len(seq)
    if B==0:return None
    emb=net.embedding(labels)
    conditioned=torch.cat([seq[:,:cut],emb[:,None,:].expand(-1,cut,-1)],dim=-1)
    history,h=net.rnn(conditioned)
    logits=net.head(history[:,-1])
    weighted_loss=torch.tensor(0.0)
    weight=torch.tensor(0.0)
    for idx in range(cut,min(MAX_STEPS,cut+steps)):
        valid=length>idx
        if not valid.any():break
        target=seq[:,idx]
        one=mdn_step_loss(logits,target)
        weighted_loss=weighted_loss+(one*valid).sum()
        weight=weight+valid.sum()
        predicted=modal_token(logits).detach()
        if training:
            teacher=(torch.rand(B)<teacher_probability)[:,None]
            actual=torch.where(teacher,target,predicted)
        else:
            actual=predicted
        inp=torch.cat([actual,emb],dim=1).unsqueeze(1)
        out,h=net.rnn(inp,h)
        logits=net.head(out[:,0])
        end=(idx==length-1)&valid
        eos=nn.functional.binary_cross_entropy_with_logits(
           logits[:,5*MIXTURES+1],end.float(),reduction="none")
        weighted_loss=weighted_loss+.09*(eos*valid).sum()
    return weighted_loss/weight.clamp(min=1)

@torch.no_grad()
def evaluate_free_rollout(net,data,limit=500,seed=SEED):
    rng=random.Random(seed)
    indices=list(range(len(data)))
    rng.shuffle(indices)
    subset=torch.utils.data.Subset(data,indices[:min(limit,len(indices))])
    loader=DataLoader(subset,batch_size=64,num_workers=0)
    net.eval()
    sums=0.;count=0;pen_total=pen_right=0
    for seq,labels,lengths in loader:
        cut=15
        eligible=lengths>cut+14
        if not eligible.any():continue
        seq=seq[eligible];labels=labels[eligible];lengths=lengths[eligible]
        emb=net.embedding(labels)
        input0=torch.cat([seq[:,:cut],emb[:,None,:].expand(-1,cut,-1)],dim=2)
        output,h=net.rnn(input0)
        logits=net.head(output[:,-1])
        pred_pos=seq[:,:cut,:2].sum(dim=1)
        # Fixed 14 pen-motion steps avoids comparing models with an
        # unequal number of sampled EOS decisions.
        for j in range(cut,cut+14):
            pred=modal_token(logits)
            pred_pos=pred_pos+pred[:,:2]
            target=seq[:,j]
            true_pos=seq[:,:j+1,:2].sum(dim=1)
            errors=torch.linalg.vector_norm(pred_pos-true_pos,dim=1)
            # Deeper tail steps matter more than near-trivial first steps.
            scale=.5+.5*(j-cut)/13
            sums+=float(errors.sum())*scale
            count+=len(seq)*scale
            pen_total+=len(seq)
            pen_right+=int(((pred[:,2]>.5)==(target[:,2]>.5)).sum())
            out,h=net.rnn(torch.cat([pred,emb],dim=1)[:,None,:],h)
            logits=net.head(out[:,0])
    return {"free_rollout_position_error":round(sums/max(1,count),6),
      "free_rollout_pen_accuracy":round(pen_right/max(1,pen_total),6),
      "evaluated_steps":pen_total}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--source",default="models/ink-stroke-sequence-v1.json")
    p.add_argument("--output",default="models/ink-stroke-prefix-v1.json")
    p.add_argument("--epochs",type=int,default=3)
    p.add_argument("--per-epoch",type=int,default=13000)
    p.add_argument("--batch",type=int,default=96)
    p.add_argument("--tail-steps",type=int,default=22)
    p.add_argument("--data",default=".data/ujipenchars2")
    a=p.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(SEED+811);np.random.seed(SEED+811);random.seed(SEED+811)
    if not Path(a.source).is_file():raise RuntimeError("Base real neural model missing")
    rows=parse_uji(fetch_uji(a.data))
    train=[(ch,paths) for ch,writer,partition,paths in rows if partition=="train"]
    test=[r for r in rows if r[2]=="test"]
    writers=sorted({r[1] for r in test})
    random.Random(SEED+1784).shuffle(writers)
    selection=set(writers[:len(writers)//2]);independent=set(writers[len(writers)//2:])
    cal=Strokes([(c,paths) for c,w,_,paths in test if w in selection],augment=False)
    hold=Strokes([(c,paths) for c,w,_,paths in test if w in independent],augment=False)
    present=Counter(c for c,_ in train)
    recipes_bank=recipes()
    missing=[c for c in CHARS if c not in present]
    assert set(missing)<=set(recipes_bank)
    supplemental=[(c,recipes_bank[c]) for c in missing for _ in range(250)]
    data=Strokes(train+supplemental,augment=True)
    counts=Counter(c for c,_ in data.records)
    weights=torch.tensor([
      counts[c]**(-.62)*(2.9 if c in FOCUS else 1.)
      for c,_ in data.records],dtype=torch.double)
    sampler=WeightedRandomSampler(weights,a.per_epoch,replacement=True,
        generator=torch.Generator().manual_seed(SEED+813))
    loader=DataLoader(data,batch_size=a.batch,sampler=sampler,num_workers=2)
    origin=load_published(a.source)
    base_cal=evaluate_free_rollout(origin,cal,limit=500,seed=SEED+4)
    base_hold=evaluate_free_rollout(origin,hold,limit=500,seed=SEED+8)
    print("BASE PREFIX ROLLOUT",base_cal,"INDEPENDENT",base_hold,flush=True)
    model=load_published(a.source)
    seen=0;best=None;history=[]
    for epoch in range(a.epochs):
        model.train();t0=time.monotonic()
        optim=torch.optim.AdamW(model.parameters(),lr=.00015 if epoch<2 else .00006,
                                weight_decay=.00009)
        loss_sum=0.;n=0
        for bi,(seq,labels,lengths) in enumerate(loader):
            cut=random.randint(6,22)
            keep=lengths>=cut+8
            if not keep.any():continue
            seq=seq[keep];labels=labels[keep];lengths=lengths[keep]
            probability=max(.42,.78-epoch*.16)
            loss=prefix_rollout_batch(model,seq,labels,lengths,
              cut=cut,steps=a.tail_steps,teacher_probability=probability,training=True)
            optim.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.)
            optim.step()
            seen+=len(seq);loss_sum+=float(loss)*len(seq);n+=len(seq)
            if (bi+1)%110==0:
                print("PREFIX EPOCH",epoch+1,"batch",bi+1,
                    "presentations",seen,"loss",round(float(loss),5),flush=True)
        val=evaluate_free_rollout(model,cal,limit=500,seed=SEED+4)
        row={"epoch":epoch+1,"train_loss":round(loss_sum/max(1,n),5),
             "calibration":val,"seconds":round(time.monotonic()-t0,1)}
        history.append(row)
        print("PREFIX CHECKPOINT",json.dumps(row),flush=True)
        # Select solely on writer-disjoint calibration set.
        if best is None or val["free_rollout_position_error"]<best["calibration"]["free_rollout_position_error"]:
            best={"epoch":epoch+1,"calibration":val,"presentations":seen}
            export(model,a.output,
               {"heldout_nll":val["free_rollout_position_error"],
                "heldout_pen_state_accuracy":val["free_rollout_pen_accuracy"],
                "heldout_glyphs":len(cal)},
               {"real_training_glyphs":len(train),
                "real_writer_holdout_glyphs":len(test),
                "writer_disjoint_validation":True,
                "trained_from_scratch":False,
                "fine_tuned_own_model":a.source,
                "prefix_tuned":True,
                "all_supported_classes":len(CHARS),
                "training_presentations":seen,
                "not_a_raster_generator":True})
    restored=load_published(a.output)
    final=evaluate_free_rollout(restored,hold,limit=500,seed=SEED+8)
    before=base_hold["free_rollout_position_error"]
    after=final["free_rollout_position_error"]
    improvement=(before-after)/max(1e-8,before)
    penDiff=final["free_rollout_pen_accuracy"]-base_hold["free_rollout_pen_accuracy"]
    accepted=improvement>=.025 and penDiff>=-.035
    metrics={
     "eligible":bool(accepted),"source":a.source,
     "trained_parameters":sum(p.numel() for p in model.parameters()),
     "train_real_characters":len(train),"synthetic_symbols":len(supplemental),
     "writer_disjoint_calibration_glyphs":len(cal),
     "writer_disjoint_independent_glyphs":len(hold),
     "base":{"calibration":base_cal,"independent":base_hold},
     "best":best,"independent":final,"improvement_fraction":improvement,
     "pen_accuracy_delta":penDiff,"history":history,
     "presentations":seen,
     "note":"Validation measures free-running 14-step pen-path deviation, not subjective rendered character correctness"
    }
    Path("models/stroke-prefix-metrics.json").write_text(json.dumps(metrics,indent=2))
    if not accepted:
        Path(a.output).unlink(missing_ok=True)
        print("REJECTED prefix-trained model: no writer-independent free-run improvement",flush=True)
    else:
        print("PUBLISHED ELIGIBLE prefix-tuned model",improvement,"trajectory improvement",flush=True)
if __name__=="__main__":main()
