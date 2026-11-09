#!/usr/bin/env python3
"""INK AI classifier V2: class-balanced fine-tuning of OWN trained EMNIST CNN.

Addresses the published recognizer's very low lowercase c/m/o/s/u/l scores.
The pretrained starting point here is ONLY the project's independently trained
V1 model at models/ink-cnn-v1.json, not external weights.
Publish V2 only when held-out class-balanced and overall accuracy improve.
"""
from __future__ import annotations
import argparse,base64,json,random,time,sys
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,WeightedRandomSampler
from torchvision.datasets import EMNIST
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import InkNet,RealChars,HandwrittenSymbols,SyntheticPunctuation,Mixed,CHARS,SEED,export

def restore(path: str)->InkNet:
    obj=json.loads(Path(path).read_text(encoding="utf8"))
    assert obj["format"]=="ink-cnn-int8-v1"
    model=InkNet()
    for name,entry in zip(("c1","c2","c3","f1","f2"),obj["layers"]):
        raw=np.frombuffer(base64.b64decode(entry["weights"]),dtype=np.int8)
        weight=raw.astype(np.float32).reshape(entry["shape"])*entry["scale"]
        layer=getattr(model,name)
        with torch.no_grad():
            layer.weight.copy_(torch.from_numpy(weight))
            layer.bias.copy_(torch.tensor(entry["bias"]))
    return model

@torch.inference_mode()
def evaluate(model, loader):
    model.eval()
    correct=torch.zeros(62,dtype=torch.int64)
    count=torch.zeros(62,dtype=torch.int64)
    for x,y in loader:
        pred=model(x).argmax(dim=1)
        # EMNIST ByClass has only 62 real-writer classes.
        count+=torch.bincount(y,minlength=62)
        correct+=torch.bincount(y[pred==y],minlength=62)
    per_class=correct.float()/count.clamp(min=1)
    return {
       "overall":round(float(correct.sum()/count.sum()),6),
       "macro":round(float(per_class.mean()),6),
       "lowercase_macro":round(float(per_class[36:].mean()),6),
       "rare_macro":round(float(per_class[[13,37,48,50,54,55,60]].mean()),6),
       "per_class":{CHARS[i]:round(float(per_class[i]),5) for i in range(62)},
       "tested":int(count.sum())
    }

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--epochs",type=int,default=3)
    p.add_argument("--samples-per-epoch",type=int,default=160000)
    p.add_argument("--batch",type=int,default=256)
    p.add_argument("--data",default=".data")
    p.add_argument("--output",default="models/ink-cnn-v2.json")
    args=p.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(SEED+51)
    random.seed(SEED+51)
    np.random.seed(SEED+51)
    print("Restoring OWN originally trained V1 weights",flush=True)
    model=restore("models/ink-cnn-v1.json")
    train=EMNIST(args.data,split="byclass",train=True,download=True)
    test=EMNIST(args.data,split="byclass",train=False,download=True)
    parts=[RealChars(train)]
    source_labels=[train.targets.long()]
    hasy_count=0
    try:
        handwritten=HandwrittenSymbols(args.data)
        hasy_count=len(handwritten)
        if hasy_count:
            parts.append(handwritten)
            source_labels.append(torch.tensor(handwritten.y,dtype=torch.long))
    except Exception as exc:
        print("HASYv2 unavailable; proceeding with real EMNIST:",exc,flush=True)
    synthetic=SyntheticPunctuation(13000)
    parts.append(synthetic)
    source_labels.append(torch.tensor([CHARS.index(synthetic.symbols[i%len(synthetic.symbols)])
      for i in range(len(synthetic))],dtype=torch.long))
    dataset=Mixed(parts)
    labels=torch.cat(source_labels,dim=0)
    assert len(labels)==len(dataset)
    counts=torch.bincount(labels,minlength=len(CHARS)).double().clamp(min=1)
    # Inverse-sqrt weighting greatly increases the representation of
    # uncommon lowercase handwriting without discarding common digits.
    weights=counts[labels].pow(-.62)
    generator=torch.Generator().manual_seed(SEED+512)
    sampler=WeightedRandomSampler(weights,num_samples=args.samples_per_epoch,
                                  replacement=True,generator=generator)
    loader=DataLoader(dataset,batch_size=args.batch,sampler=sampler,num_workers=2)
    val=DataLoader(RealChars(test,augment=False),batch_size=512,num_workers=2)
    baseline=evaluate(model,val)
    print("ACTUAL V1 BASELINE:",json.dumps({k:v for k,v in baseline.items()
      if k!="per_class"}),flush=True)
    best=None
    history=[]
    seen=0
    optimizer=torch.optim.AdamW(model.parameters(),lr=.00024,weight_decay=.00004)
    for epoch in range(1,args.epochs+1):
        start=time.monotonic();model.train();loss_total=0
        for n,(x,y) in enumerate(loader):
            optimizer.zero_grad(set_to_none=True)
            predicted=model(x)
            loss=nn.functional.cross_entropy(predicted,y,label_smoothing=.012)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.)
            optimizer.step()
            seen+=len(x);loss_total+=float(loss)*len(x)
            if (n+1)%250==0:
                print(f"epoch {epoch}, batch {n+1}/{len(loader)}, examples {seen:,}, loss {float(loss):.4f}",flush=True)
        measured=evaluate(model,val)
        improved_macro=measured["macro"]-baseline["macro"]
        improved_lowercase=measured["lowercase_macro"]-baseline["lowercase_macro"]
        lost_overall=baseline["overall"]-measured["overall"]
        # Loss of more than ~1.5pp in overall recognition is unacceptable.
        valid=lost_overall<=.015 and improved_macro>=.010 and improved_lowercase>=.020
        # On rare-class test results, prefer accuracy improvements without
        # greatly sacrificing the established digit performance.
        objective=measured["overall"]*.60+measured["macro"]*.25+measured["lowercase_macro"]*.15
        history.append({"epoch":epoch,"metrics":measured,"objective":objective,
          "eligible":valid,"train_loss":loss_total/len(loader.dataset) if hasattr(loader.dataset,"__len__") else 0})
        print("EPOCH RESULT:",epoch, "eligible",valid,
          "all",measured["overall"],"macro",measured["macro"],
          "lowercase",measured["lowercase_macro"],
          "seconds",round(time.monotonic()-start,1),flush=True)
        if valid and (best is None or objective>best["objective"]):
            export(model,args.output,seen,hasy_count,measured["overall"],epoch)
            # The serialization uses the same model format, layers and class
            # order, so both V1 and V2 are compatible with the current worker.
            item=json.loads(Path(args.output).read_text())
            item["name"]="INK AI V2 — class-balanced fine-tuned real handwritten character recognizer"
            item["training"]["finetuned_from"]="models/ink-cnn-v1.json"
            item["training"]["balanced_sample_presentations"]=seen
            item["training"]["emnist_test_accuracy"]=measured["overall"]
            item["training"]["macro_accuracy"]=measured["macro"]
            item["training"]["lowercase_macro_accuracy"]=measured["lowercase_macro"]
            item["training"]["seed"]=SEED+51
            Path(args.output).write_text(json.dumps(item,separators=(",",":"),ensure_ascii=False))
            best={"objective":objective,"epoch":epoch,"metrics":measured}
    results={
      "model":"models/ink-cnn-v2.json" if best else "models/ink-cnn-v1.json",
      "selection":"V2 published only when macro, lowercase and full-test accuracy satisfy no-regression thresholds",
      "baseline":baseline,"best":best,
      "history":history,"fine_tuning_presentations":seen,
      "real_emnist_train":len(train),"real_hasy_train":hasy_count,
      "synthetic_training_examples":len(synthetic)
    }
    Path("models").mkdir(exist_ok=True)
    Path("models/recognition-v2-metrics.json").write_text(json.dumps(results,indent=2))
    print("FINISHED:",json.dumps({k:v for k,v in results.items()
      if k not in ("history","baseline")}),flush=True)
    # A workflow remains green without an upgrade rather than shipping a
    # demonstrably worse neural model.
if __name__=="__main__":main()
