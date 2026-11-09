#!/usr/bin/env python3
"""Publishable early EMNIST checkpoint. No pretrained model weights or inference API.

This intentionally trains faster on a representative random subset. It is a
temporary checkpoint, superseded by the full EMNIST model when that finishes.
"""
import argparse, json, random, time
from pathlib import Path
import numpy as np
import torch
from torch.utils.data import DataLoader, Subset
from torchvision.datasets import EMNIST
from train import InkNet, RealChars, SyntheticPunctuation, Mixed, export, SEED

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--samples",type=int,default=60000)
    p.add_argument("--punctuation",type=int,default=8000)
    p.add_argument("--epochs",type=int,default=2)
    p.add_argument("--data",default=".data")
    a=p.parse_args()
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    np.random.seed(SEED)
    random.seed(SEED)
    print("Downloading EMNIST ByClass (real human handwriting) if not cached...",flush=True)
    train=EMNIST(a.data,split="byclass",train=True,download=True)
    test=EMNIST(a.data,split="byclass",train=False,download=True)
    chosen=torch.randperm(len(train),generator=torch.Generator().manual_seed(SEED))[:a.samples].tolist()
    dataset=Mixed([Subset(RealChars(train),chosen),SyntheticPunctuation(a.punctuation)])
    loader=DataLoader(dataset,batch_size=256,shuffle=True,num_workers=2,persistent_workers=True)
    model=InkNet()
    optimizer=torch.optim.AdamW(model.parameters(),lr=.001)
    # Test only a deterministic 3000-example subset to shorten bootstrap.
    chosen_test=torch.randperm(len(test),generator=torch.Generator().manual_seed(SEED+1))[:3000].tolist()
    val=DataLoader(Subset(RealChars(test,augment=False),chosen_test),batch_size=256,num_workers=2)
    seen=0
    for epoch in range(a.epochs):
        t=time.monotonic();model.train();total_loss=0
        for batch,(x,y) in enumerate(loader):
            optimizer.zero_grad(set_to_none=True)
            prediction=model(x)
            loss=torch.nn.functional.cross_entropy(prediction,y)
            loss.backward();optimizer.step()
            seen+=len(y);total_loss+=float(loss)*len(y)
            if (batch+1)%75==0:print(f"Epoch {epoch+1}, batch {batch+1}/{len(loader)} | training presentations {seen:,}",flush=True)
        model.eval();correct=total=0
        with torch.inference_mode():
            for x,y in val:
                pred=model(x).argmax(1)
                correct+=int((pred==y).sum());total+=len(y)
        accuracy=correct/total
        print(f"Epoch {epoch+1} accuracy {accuracy:.2%} on real held-out EMNIST, elapsed {time.monotonic()-t:.1f}s",flush=True)
        # An initial checkpoint is useful only if it learned a meaningful signal.
        if accuracy<.20:continue
        item=export(model,"models/ink-cnn-v1.json",seen,0,accuracy,epoch+1)
        item["training"]["real_emnist_train"]=len(chosen)
        item["training"]["data"]="Real handwritten EMNIST subset + synthetic punctuation, bootstrap checkpoint"
        Path("models/ink-cnn-v1.json").write_text(json.dumps(item,separators=(",",":")),encoding="utf-8")
        Path("models/metrics.json").write_text(json.dumps({
            "phase":"bootstrap","test_accuracy":accuracy,"training_presentations":seen,
            "real_emnist_train":len(chosen),"notes":"Bootstrap checkpoint; full trainer supersedes it"
        },indent=2),encoding="utf-8")
        print("Checkpoint staged for GitHub publishing",flush=True)
    if not Path("models/ink-cnn-v1.json").exists():
        raise RuntimeError("Bootstrap did not achieve minimum 20% held-out accuracy; keeping existing fallback")

if __name__=="__main__":main()
