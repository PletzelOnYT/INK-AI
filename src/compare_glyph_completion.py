#!/usr/bin/env python3
"""Apples-to-apples held-out comparison: old INK AI V1 vs new 1.1M V2.

Both models receive the SAME character, class label and incomplete-ink mask.
Reports unseen EMNIST test images, missing-ink F1 and weighted reconstruction
error, including classes commonly confused with uppercase I and lowercase l.
"""
from pathlib import Path
import argparse,base64,json,sys
import numpy as np
import torch
from torch.utils.data import DataLoader,Subset
from torchvision.datasets import EMNIST
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import RealChars,SEED,LOOKUP
from train_glyph_completion import GlyphCompletionNet
from train_glyph_completion_v2 import CompletionV2,masks,criterion,HARD_LABELS

def load_model(path,version):
    item=json.loads(Path(path).read_text())
    model=GlyphCompletionNet() if version==1 else CompletionV2()
    if version==1 and item["format"]!="ink-glyph-completion-mlp-v1":
        raise ValueError("Incorrect V1 file")
    if version==2 and item["format"]!="ink-glyph-completion-residual-v2":
        raise ValueError("Incorrect V2 file")
    emb=np.asarray(item["embedding"],dtype=np.float32)
    with torch.no_grad():
        model.embedding.weight.copy_(torch.from_numpy(emb))
        for name,layer in zip(
            ["fc1","fc2","fc3"] if version==1 else ["fc1","fc2","fc3","fc4"],
            item["layers"]):
            raw=np.frombuffer(base64.b64decode(layer["weights"]),dtype=np.int8)
            weights=raw.astype(np.float32).reshape(layer["shape"])*layer["scale"]
            getattr(model,name).weight.copy_(torch.from_numpy(weights))
            getattr(model,name).bias.copy_(torch.tensor(layer["bias"]))
    model.eval()
    return model

def compare():
    parser=argparse.ArgumentParser()
    parser.add_argument("--data",default=".data")
    parser.add_argument("--samples",type=int,default=4000)
    parser.add_argument("--output",default="models/glyph-completion-comparison.json")
    a=parser.parse_args()
    torch.set_num_threads(4)
    old=load_model("models/ink-glyph-completion-v1.json",1)
    new=load_model("models/ink-glyph-completion-v2.json",2)
    ds=EMNIST(a.data,split="byclass",train=False,download=True)
    rng=torch.Generator().manual_seed(SEED+111)
    chosen=torch.randperm(len(ds),generator=rng)[:a.samples].tolist()
    loader=DataLoader(Subset(RealChars(ds,augment=False),chosen),
                      batch_size=128,num_workers=2)
    counters={1:{"tested":0,"loss_sum":0.,"tp":0,"pred":0,"truth":0,
                 "hard_tp":0,"hard_pred":0,"hard_truth":0},
              2:{"tested":0,"loss_sum":0.,"tp":0,"pred":0,"truth":0,
                 "hard_tp":0,"hard_pred":0,"hard_truth":0}}
    torch.manual_seed(SEED+991)
    with torch.inference_mode():
        for x,y in loader:
            full=x.reshape(len(x),1024)
            mask=masks(len(x),x.device)
            true=(full>.40)&(mask<.5)
            difficult=torch.tensor([int(c) in HARD_LABELS for c in y],dtype=torch.bool)
            for version,model in [(1,old),(2,new)]:
                logits=model(full*mask,y)
                probabilities=torch.sigmoid(logits)
                pred=(probabilities>.48)&(mask<.5)
                stats=counters[version]
                stats["tested"]+=len(x)
                stats["loss_sum"]+=float(criterion(logits,full,mask))*len(x)
                stats["tp"]+=int((pred&true).sum())
                stats["pred"]+=int(pred.sum())
                stats["truth"]+=int(true.sum())
                stats["hard_tp"]+=int((pred[difficult]&true[difficult]).sum())
                stats["hard_pred"]+=int(pred[difficult].sum())
                stats["hard_truth"]+=int(true[difficult].sum())
    results={}
    for v,c in counters.items():
        f1=2*c["tp"]/max(1,c["pred"]+c["truth"])
        hard_f1=2*c["hard_tp"]/max(1,c["hard_pred"]+c["hard_truth"])
        results[f"v{v}"]={
            "heldout_characters":c["tested"],
            "same_mask_weighted_loss":round(c["loss_sum"]/c["tested"],6),
            "missing_ink_f1":round(f1,6),
            "hard_glyph_missing_ink_f1":round(hard_f1,6),
            "missing_ink_precision":round(c["tp"]/max(1,c["pred"]),6),
            "missing_ink_recall":round(c["tp"]/max(1,c["truth"]),6)}
    results["v2_vs_v1"]={
        "missing_ink_f1_delta":round(results["v2"]["missing_ink_f1"]-results["v1"]["missing_ink_f1"],6),
        "hard_glyph_f1_delta":round(results["v2"]["hard_glyph_missing_ink_f1"]-results["v1"]["hard_glyph_missing_ink_f1"],6),
        "weighted_loss_delta":round(results["v2"]["same_mask_weighted_loss"]-results["v1"]["same_mask_weighted_loss"],6)}
    results["notes"]="Both models evaluated on exact same held-out EMNIST test images and masks. No user-drawn, cursive, or subjective quality guarantee."
    path=Path(a.output);path.parent.mkdir(exist_ok=True,parents=True)
    path.write_text(json.dumps(results,indent=2))
    print(json.dumps(results,indent=2),flush=True)

if __name__=="__main__":
    compare()
