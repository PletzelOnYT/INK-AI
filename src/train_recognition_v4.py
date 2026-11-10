#!/usr/bin/env python3
"""INK AI V4 experimental recognition training on FOUR real handwriting sources.

Starts from the project's own V3 CNN. Adds HASYv2 real labeled pen symbols
and UCI PenDigits writer-independent digit trajectories to EMNIST + UJI.
Evaluates on writer-disjoint UJI independent writers withheld from selection.
Only exports a candidate if it improves without sacrificing existing recognition.
Synthetic punctuation is a separate small rehearsal input, not a dataset
of human writers. Nothing in this script downloads pretrained weights.
"""
from __future__ import annotations
import argparse, json, random, sys, time
from collections import Counter
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import ConcatDataset, DataLoader, Subset, WeightedRandomSampler
from torchvision.datasets import EMNIST

sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS, LOOKUP, RealChars, SyntheticPunctuation, SEED, export
from train_recognition_v2 import restore
from train_recognition_v3 import HumanPen, BrowserLikeEMNIST
from train_stroke_sequence import parse_uji,fetch_uji
from extra_handwriting_datasets import HASYLetters, PenDigits

TARGET_LETTERS="cioxyhIXYO"
def evaluations(model,loader):
    model.eval()
    totals=np.zeros(len(CHARS),np.int64)
    hits=np.zeros(len(CHARS),np.int64)
    confusions=Counter()
    with torch.inference_mode():
        for images,labels in loader:
            pred=model(images).argmax(1).numpy()
            truth=labels.numpy()
            for label in np.unique(truth):
                mask=truth==label
                totals[label]+=int(mask.sum())
                hits[label]+=int((pred[mask]==label).sum())
            for a,b in zip(truth,pred):
                if a!=b and CHARS[int(a)] in TARGET_LETTERS:
                    confusions[(CHARS[int(a)],CHARS[int(b)])]+=1
    active=totals>0
    lower=totals[36:62]>0
    pc=hits/np.maximum(1,totals)
    return {
      "overall":round(float(hits.sum()/max(1,totals.sum())),6),
      "macro":round(float(pc[active].mean()),6) if active.any() else 0.,
      "lowercase_macro":round(float(pc[36:62][lower].mean()),6) if lower.any() else 0.,
      "tested":int(totals.sum()),
      "target_letters":{c:{"count":int(totals[LOOKUP[c]]),
           "accuracy":round(float(pc[LOOKUP[c]]),4)}
            for c in TARGET_LETTERS if c in LOOKUP},
      "hard_confusions":[{"truth":a,"predicted":b,"count":n}
           for (a,b),n in confusions.most_common(12)]
    }

def load_data(args):
    real=parse_uji(fetch_uji(Path(args.data)/"ujipenchars2"))
    train=[r for r in real if r[2]=="train"]
    test=[r for r in real if r[2]=="test"]
    writers=sorted({r[1] for r in test})
    random.Random(SEED+902).shuffle(writers)
    calibration=set(writers[:len(writers)//2])
    independent=set(writers[len(writers)//2:])
    pen_train=HumanPen(train,augment=True)
    pen_cal=HumanPen([r for r in test if r[1] in calibration])
    pen_independent=HumanPen([r for r in test if r[1] in independent])
    assert len(pen_train)>=6000 and len(pen_cal)>=1100 and len(pen_independent)>=1100
    emTr=EMNIST(args.data,split="byclass",train=True,download=True)
    emTe=EMNIST(args.data,split="byclass",train=False,download=True)
    emIds=torch.randperm(len(emTr),generator=torch.Generator().manual_seed(SEED+302))[:70000].tolist()
    emEvalIds=torch.randperm(len(emTe),generator=torch.Generator().manual_seed(SEED+302))[:12000].tolist()
    em_train=BrowserLikeEMNIST(Subset(RealChars(emTr,augment=False),emIds),augment=True)
    em_val=BrowserLikeEMNIST(Subset(RealChars(emTe,augment=False),emEvalIds))
    hasy_train=HASYLetters(args.data,"train",augment=True)
    hasy_val=HASYLetters(args.data,"validation",augment=False)
    digit_train=PenDigits(args.data,"train",augment=True)
    digit_val=PenDigits(args.data,"test",augment=False)
    symbols=SyntheticPunctuation(6500)
    if len(hasy_train)<1500 or len(hasy_val)<300 or len(digit_train)!=7494 or len(digit_val)!=3498:
        raise RuntimeError("New datasets missing expected real handwriting samples")
    train_parts=[pen_train,em_train,hasy_train,digit_train,symbols]
    source_classes=[
      [LOOKUP[char] for char,_ in pen_train.records],
      [int(emTr.targets[i]) for i in emIds],
      hasy_train.targets.tolist(),
      digit_train.targets.tolist(),
      [LOOKUP[symbols.symbols[i%len(symbols.symbols)]] for i in range(len(symbols))]
    ]
    assert all(len(x)==len(d) for x,d in zip(source_classes,train_parts))
    print("V4 REAL TRAIN SOURCES",{
        "uji":len(pen_train),"emnist":len(em_train),
        "hasy":len(hasy_train),"uci_pendigits":len(digit_train),
        "synthetic_punctuation":len(symbols)},flush=True)
    return {
       "train_parts":train_parts,
       "source_classes":source_classes,
       "pen_cal":pen_cal,"pen_independent":pen_independent,
       "em_val":em_val,"hasy_val":hasy_val,"digit_val":digit_val,
       "counts":{"uji_pen_train":len(pen_train),
         "uji_calibration":len(pen_cal),"uji_independent":len(pen_independent),
         "emnist_training":len(em_train),"emnist_validation":len(em_val),
         "hasy_training":len(hasy_train),"hasy_writer_heldout":len(hasy_val),
         "pendigits_training":len(digit_train),
         "pendigits_unseen_writers":len(digit_val),
         "synthetic_symbols":len(symbols)}
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--data",default=".data")
    parser.add_argument("--epochs",type=int,default=5)
    parser.add_argument("--samples-per-epoch",type=int,default=90000)
    parser.add_argument("--batch",type=int,default=192)
    parser.add_argument("--out",default="models/ink-cnn-v4.json")
    a=parser.parse_args()
    torch.set_num_threads(4)
    random.seed(SEED+401);np.random.seed(SEED+401);torch.manual_seed(SEED+401)
    data=load_data(a)
    parts=data["train_parts"]
    proportions=[.48,.27,.14,.06,.05] # 95% actual handwriting; preserve UJI letters
    assert abs(sum(proportions)-1)<1e-8
    weights=[]
    for labels,portion in zip(data["source_classes"],proportions):
        frequency=Counter(labels)
        raw=np.asarray([frequency[k]**(-.50) for k in labels],np.float64)
        weights.extend((raw/raw.sum()*portion).tolist())
    assert len(weights)==len(ConcatDataset(parts))
    sampler=WeightedRandomSampler(weights,num_samples=a.samples_per_epoch,
       replacement=True,generator=torch.Generator().manual_seed(SEED+404))
    loader=DataLoader(ConcatDataset(parts),batch_size=a.batch,
                     sampler=sampler,num_workers=2)
    loaders={k:DataLoader(data[k],batch_size=256,num_workers=2)
             for k in ("pen_cal","pen_independent","em_val","hasy_val","digit_val")}
    model=restore("models/ink-cnn-v3.json")
    # Freeze the proven V3 teacher. Distillation anchors class boundaries
    # for Latin letters while newly labeled data can still improve the CNN.
    # Digits and symbols are exempt so a poor old PenDigits score cannot
    # prevent learning genuine stylus-written numerals.
    teacher=restore("models/ink-cnn-v3.json").eval()
    for p in teacher.parameters():p.requires_grad_(False)
    baseline={k:evaluations(model,loaders[k]) for k in loaders}
    for key,item in baseline.items():
        print("V3 BASELINE",key,item["overall"],item["lowercase_macro"],flush=True)
    Path(a.out).unlink(missing_ok=True)
    best=None;history=[];seen=0
    for epoch in range(1,a.epochs+1):
        model.train()
        t0=time.monotonic()
        optimizer=torch.optim.AdamW(model.parameters(),
             lr=.000048 if epoch<=3 else .000018,weight_decay=.00013)
        loss_sum=0.
        for step,(images,labels) in enumerate(loader,1):
            prediction=model(images)
            loss_each=nn.functional.cross_entropy(
                prediction,labels,label_smoothing=.012,reduction="none")
            # Class-balanced hard examples: c/o/x/y should not be eclipsed
            # by similarly shaped uppercase letters, zeros and math signs.
            confusing=torch.zeros_like(labels,dtype=torch.bool)
            for symbol in "cioxy":
                confusing|=labels==LOOKUP[symbol]
            loss=(loss_each*(1.+.40*confusing.float())).mean()
            letters=(labels>=10)&(labels<62)
            if letters.any():
                with torch.no_grad():
                    old_probs=torch.softmax(teacher(images)/1.5,dim=1)
                log_probs=torch.log_softmax(prediction/1.5,dim=1)
                per_item=nn.functional.kl_div(
                    log_probs,old_probs,reduction="none").sum(1)*2.25
                loss=loss+.32*per_item[letters].mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.3)
            optimizer.step()
            loss_sum+=float(loss)*len(labels);seen+=len(labels)
            if step%200==0:
                print("V4 epoch",epoch,"batch",step,"presentations",seen,
                     "loss",round(float(loss),4),flush=True)
        measured={k:evaluations(model,loaders[k])
             for k in ("pen_cal","em_val","hasy_val","digit_val")}
        b=baseline
        pen=measured["pen_cal"];em=measured["em_val"]
        hasy=measured["hasy_val"];digit=measured["digit_val"]
        eligible=(
          pen["overall"]>=b["pen_cal"]["overall"]-.012
          and pen["lowercase_macro"]>=b["pen_cal"]["lowercase_macro"]-.020
          and em["overall"]>=b["em_val"]["overall"]-.020
          and digit["overall"]>=b["digit_val"]["overall"]-.018
          and (hasy["overall"]>=b["hasy_val"]["overall"]+.01
               or pen["overall"]>=b["pen_cal"]["overall"]+.012)
        )
        obj=(.50*pen["overall"]+.14*pen["lowercase_macro"]
          +.16*em["overall"]+.14*hasy["overall"]+.06*digit["overall"])
        row={"epoch":epoch,"eligible_calibration":bool(eligible),
             "objective":round(obj,6),
             "train_loss":round(loss_sum/a.samples_per_epoch,5),
             "validation":measured,
             "elapsed_s":round(time.monotonic()-t0,1)}
        history.append(row)
        print("V4 EPOCH METRICS",json.dumps({
            "epoch":epoch,"eligible":eligible,"objective":row["objective"],
            "uji_pen":pen["overall"],"lowercase":pen["lowercase_macro"],
            "emnist":em["overall"],"hasy":hasy["overall"],
            "digits":digit["overall"]}),flush=True)
        if eligible and (best is None or obj>best["objective"]):
            export(model,a.out,seen,len(data["train_parts"][2]),em["overall"],epoch)
            saved=json.loads(Path(a.out).read_text())
            saved["name"]="INK AI V4 multi-dataset handwritten character recognizer"
            saved["training"].update({
                "finetuned_from":"models/ink-cnn-v3.json",
                "real_sources":["UJI Pen Characters v2","EMNIST ByClass",
                                "HASYv2","UCI PenDigits"],
                "real_source_samples":data["counts"],
                "selection":"writer-separated UJI+HASY calibration and official PenDigits split"
            })
            Path(a.out).write_text(json.dumps(saved,separators=(",",":")))
            best={"epoch":epoch,"objective":obj,"validation":measured}
    independent=None
    if best is not None:
        quantized=restore(a.out)
        independent=evaluations(quantized,loaders["pen_independent"])
        checks={
           "uji_independent_gain":
              independent["overall"]>=baseline["pen_independent"]["overall"]+.008,
           "uji_lowercase_not_worse":
              independent["lowercase_macro"]>=baseline["pen_independent"]["lowercase_macro"]-.012,
           "emnist_not_worse":
              best["validation"]["em_val"]["overall"]>=baseline["em_val"]["overall"]-.018,
           "pen_digits_not_worse":
              best["validation"]["digit_val"]["overall"]>=baseline["digit_val"]["overall"]-.018,
           "hasy_or_uji_calibration_gain":
              best["validation"]["hasy_val"]["overall"]>=baseline["hasy_val"]["overall"]+.01
              or best["validation"]["pen_cal"]["overall"]>=baseline["pen_cal"]["overall"]+.012
        }
        eligible=all(checks.values())
        if not eligible:Path(a.out).unlink(missing_ok=True)
    else:
        checks={"calibration_checkpoint":False};eligible=False
    metrics={"candidate":"models/ink-cnn-v4.json","eligible":bool(eligible),
       "source_counts":data["counts"],"baseline_v3":baseline,
       "selected":best,"independent_uji_v4":independent,
       "quality_gates":checks,"training_presentations":seen,
       "history":history,
       "notes":"Only the UJI writer-independent split is untouched during model selection. HASY and PenDigits writer-disjoint splits are validation data, not final untouched tests; augmentations do not create new writers. V4 uses V3 teacher consistency on alphabet images and priority CE for c/i/o/x/y."}
    Path("models").mkdir(exist_ok=True)
    Path("models/recognition-v4-metrics.json").write_text(json.dumps(metrics,indent=2))
    print("V4 RELEASE DECISION",json.dumps({"eligible":eligible,"checks":checks,
          "independent_uji_baseline":baseline["pen_independent"]["overall"],
          "independent_uji_candidate":independent["overall"] if independent else None,
          "presentations":seen,"counts":data["counts"]}),flush=True)

if __name__=="__main__":main()
