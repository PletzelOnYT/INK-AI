#!/usr/bin/env python3
"""Select a restrained V1+V2 classifier ensemble on one held-out split,
then verify on a disjoint validation split of the EMNIST ByClass test set.

Only own original/fine-tuned weights from this GitHub repository are used.
Group-level blending avoids overfitting every individual character's weight.
"""
import json,math,sys
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader
from torchvision.datasets import EMNIST
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import RealChars,SEED,CHARS
from train_recognition_v2 import restore

def measure(pred,truth):
    correct=(pred==truth)
    counts=np.bincount(truth,minlength=62)
    right=np.bincount(truth[correct],minlength=62)
    pc=right/np.maximum(1,counts)
    return {"overall":float(correct.mean()),
      "macro":float(pc.mean()),
      "lowercase_macro":float(pc[36:62].mean()),
      "uppercase_macro":float(pc[10:36].mean()),
      "digit_macro":float(pc[:10].mean()),
      "tested":len(truth)}

def main():
    torch.set_num_threads(4)
    if not Path("models/ink-cnn-v2.json").exists():
        raise RuntimeError("Recognition V2 must already have passed quality gates")
    models=[
      restore("models/ink-cnn-v1.json").eval(),
      restore("models/ink-cnn-v2.json").eval()
    ]
    dataset=RealChars(EMNIST(".data",split="byclass",train=False,download=True),augment=False)
    loader=DataLoader(dataset,batch_size=384,num_workers=2)
    p1=[],p2=[],labels=[]
    with torch.inference_mode():
      for bi,(x,y) in enumerate(loader):
        a=torch.softmax(models[0](x)/1.25,dim=1)
        b=torch.softmax(models[1](x)/1.25,dim=1)
        p1.append(a.numpy());p2.append(b.numpy());labels.append(y.numpy())
        if (bi+1)%100==0:
          print("EMNIST test images evaluated:",(bi+1)*384,flush=True)
    a=np.concatenate(p1).astype(np.float32)
    b=np.concatenate(p2).astype(np.float32)
    truth=np.concatenate(labels).astype(np.int64)
    n=len(truth)
    rng=np.random.default_rng(SEED+947)
    order=rng.permutation(n)
    cal=order[:n//2]
    hold=order[n//2:]
    group=np.array([0]*10+[1]*26+[2]*26+[3]*(a.shape[1]-62),np.int32)
    weights=np.array([.4,.4,.6,.5],np.float32)  # digit, upper, lower, symbols
    # For each combination, combine class posteriors, not model logit scales.
    def probs(idx,w):
       coeff=w[group][None,:]
       return a[idx]*(1-coeff)+b[idx]*coeff
    def metric(idx,w):
       guesses=probs(idx,w).argmax(axis=1)
       return measure(guesses,truth[idx])
    def objective(m):
       return .58*m["overall"]+.20*m["macro"]+.22*m["lowercase_macro"]
    best=objective(metric(cal,weights))
    for step in range(3):
      for group_id in [2,1,0]:
        winner=weights.copy()
        for value in [0,.15,.30,.45,.60,.75,.90,1]:
          test=weights.copy()
          test[group_id]=value
          result=objective(metric(cal,test))
          if result>best+1e-7:
             best=result;winner=test
        weights=winner
      print("Calibration pass",step+1,"weights",weights.tolist(),"score",best,flush=True)
    old=metric(hold,np.zeros(4,np.float32))
    new=metric(hold,np.ones(4,np.float32))
    combo=metric(hold,weights)
    safe=(combo["overall"] >= max(old["overall"],new["overall"])-.005
          and combo["macro"]>=old["macro"]+.015
          and combo["lowercase_macro"]>=old["lowercase_macro"]+.03)
    result={
      "format":"ink-recognition-ensemble-v1",
      "algorithm":"Group-calibrated posterior interpolation of own V1 and V2 CNN",
      "temperature":1.25,
      "models":["models/ink-cnn-v1.json","models/ink-cnn-v2.json"],
      "group_weights":{"digits":float(weights[0]),
         "uppercase":float(weights[1]),"lowercase":float(weights[2]),
         "symbols":float(weights[3])},
      "evaluation":{
        "method":"Weights selected on first half of EMNIST ByClass test set; evaluated on disjoint second half",
        "selection_samples":len(cal),
        "untouched_validation_samples":len(hold),
        "old":old,"new":new,"ensemble":combo,
        "accepted":bool(safe)},
      "constraints":"No external pretrained model, no third-party browser inference. Character strokes remain local."
    }
    Path("models/recognition-ensemble-evaluation.json").write_text(json.dumps(result,indent=2))
    print("ENSEMBLE OUTCOME:",json.dumps(result,indent=2),flush=True)
    if safe:
      Path("models/recognition-ensemble.json").write_text(json.dumps(
        {k:v for k,v in result.items() if k!="constraints"},separators=(",",":")))
      print("ACCEPT: Ensemble improves minority-case accuracy while protecting overall",flush=True)
    else:
      print("REJECT: No safe group-level ensemble beats standalone models",flush=True)

if __name__=="__main__":main()
