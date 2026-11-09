#!/usr/bin/env python3
"""Train an original class-conditional neural handwriting completion model.

Real human EMNIST letters/digits, optional HASYv2 handwritten math symbols;
font-generated punctuation examples are explicitly marked synthetic.
NO sketch/object examples, borrowed weights, or external inference APIs.
"""
import argparse,base64,datetime,json,math,random,sys
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,Subset
from torchvision.datasets import EMNIST
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import RealChars,HandwrittenSymbols,SyntheticPunctuation,Mixed,CHARS,SEED

HIDDEN,EMBED=256,32
class GlyphCompletionNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding=nn.Embedding(len(CHARS),EMBED)
        self.fc1=nn.Linear(1024+EMBED,HIDDEN)
        self.fc2=nn.Linear(HIDDEN,HIDDEN)
        self.fc3=nn.Linear(HIDDEN,1024)
    def forward(self,partial,labels):
        x=torch.cat([partial.reshape(len(partial),1024),self.embedding(labels)],dim=-1)
        return self.fc3(torch.relu(self.fc2(torch.relu(self.fc1(x)))))

def create_occlusion(batch,device):
    xs=torch.arange(32,device=device)[None,None,:]
    ys=torch.arange(32,device=device)[None,:,None]
    mask=torch.ones((batch,32,32),device=device)
    modes=torch.randint(0,5,(batch,),device=device)
    pos=torch.randint(9,26,(batch,),device=device)
    for kind in range(4):
        take=modes==kind
        if not take.any():continue
        p=pos[take,None,None]
        if kind==0:mask[take]=(xs<=p).float()
        elif kind==1:mask[take]=(xs>=32-p).float()
        elif kind==2:mask[take]=(ys<=p).float()
        else:mask[take]=(ys>=32-p).float()
    take=modes==4
    if take.any():mask[take]=(torch.rand((int(take.sum()),32,32),device=device)>.28).float()
    return mask.reshape(batch,1024)

def loss_fn(logits,full,mask):
    truth=full.reshape(len(full),1024)
    loss=nn.functional.binary_cross_entropy_with_logits(logits,truth,reduction="none")
    return (loss*(1+3.5*truth)*(.35+1.85*(1-mask))).mean()

def pack(layer):
    w=layer.weight.detach().cpu().numpy()
    b=layer.bias.detach().cpu().numpy()
    scale=float(max(1e-8,np.max(np.abs(w))/127))
    q=np.clip(np.rint(w/scale),-127,127).astype(np.int8)
    return {"shape":list(w.shape),"scale":scale,
            "weights":base64.b64encode(q.tobytes()).decode("ascii"),
            "bias":np.round(b,6).tolist()}

def publish(net,out,seen,emnist_count,hasy_count,synthetic_count,metric,epoch):
    item={
      "format":"ink-glyph-completion-mlp-v1",
      "name":"INK AI generative handwritten character completer",
      "labels":list(CHARS),
      "dimensions":{"input":1024,"class_embedding":EMBED,"hidden":HIDDEN,"output":1024},
      "embedding":np.round(net.embedding.weight.detach().cpu().numpy(),5).tolist(),
      "layers":[pack(net.fc1),pack(net.fc2),pack(net.fc3)],
      "training":{"source":"EMNIST ByClass + HASYv2 when available + synthetic punctuation",
       "human_emnist_characters":emnist_count,"human_hasy_symbols":hasy_count,
       "synthetic_punctuation":synthetic_count,"training_presentations":seen,
       "epochs":epoch,"held_out_masked_bce":round(metric,5),
       "trained_from_scratch":True,
       "augmentation":"random incomplete handwritten image regions",
       "note":"AI suggestions are hypotheses; handwriting may be ambiguous.",
       "date":datetime.datetime.now(datetime.timezone.utc).isoformat()}
    }
    p=Path(out);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(item,separators=(",",":"),ensure_ascii=False),encoding="utf8")
    print(f"Published {p}: {p.stat().st_size:,} bytes, held-out BCE {metric:.4f}",flush=True)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--epochs",type=int,default=3)
    p.add_argument("--samples",type=int,default=45000)
    p.add_argument("--hasy",action="store_true")
    p.add_argument("--batch",type=int,default=256)
    p.add_argument("--data",default=".data")
    p.add_argument("--output",default="models/ink-glyph-completion-v1.json")
    a=p.parse_args()
    torch.manual_seed(SEED);torch.set_num_threads(4)
    np.random.seed(SEED);random.seed(SEED)
    original=EMNIST(a.data,split="byclass",train=True,download=True)
    heldout=EMNIST(a.data,split="byclass",train=False,download=True)
    generator=torch.Generator().manual_seed(SEED)
    indices=torch.randperm(len(original),generator=generator)[:a.samples].tolist()
    parts=[Subset(RealChars(original),indices)]
    hasy_count=0
    if a.hasy:
        try:
            hasy=HandwrittenSymbols(a.data)
            hasy_count=len(hasy)
            if hasy_count:parts.append(hasy)
        except Exception as exc:
            print("HASYv2 unavailable; continuing with EMNIST:",exc,flush=True)
    synthetic_count=9000
    parts.append(SyntheticPunctuation(synthetic_count))
    data=Mixed(parts)
    print("Human EMNIST:",len(indices),"human handwritten symbols:",hasy_count,
          "synthetic punctuation:",synthetic_count,flush=True)
    loader=DataLoader(data,batch_size=a.batch,shuffle=True,num_workers=2)
    sample=torch.randperm(len(heldout),generator=generator)[:2500].tolist()
    val=DataLoader(Subset(RealChars(heldout,augment=False),sample),
                   batch_size=256,num_workers=2)
    net=GlyphCompletionNet()
    optimizer=torch.optim.AdamW(net.parameters(),lr=.0016,weight_decay=.0001)
    best=float("inf");seen=0
    for epoch in range(1,a.epochs+1):
        net.train();total=0.
        for step,(x,y) in enumerate(loader):
            full=x.reshape(len(x),1024);mask=create_occlusion(len(x),x.device)
            output=net(full*mask,y);loss=loss_fn(output,full,mask)
            optimizer.zero_grad(set_to_none=True)
            loss.backward();nn.utils.clip_grad_norm_(net.parameters(),1.)
            optimizer.step()
            total+=float(loss)*len(x);seen+=len(x)
            if (step+1)%100==0:
                print(f"epoch={epoch}/{a.epochs} batch={step+1}/{len(loader)} seen={seen:,} loss={float(loss):.4f}",flush=True)
        net.eval();vsum=total_n=0.
        with torch.inference_mode():
            for x,y in val:
                full=x.reshape(len(x),1024);mask=create_occlusion(len(x),x.device)
                score=loss_fn(net(full*mask,y),full,mask)
                vsum+=float(score)*len(x);total_n+=len(x)
        metric=vsum/max(1,total_n)
        print(f"epoch={epoch} train_loss={total/len(data):.4f} val_loss={metric:.4f}",flush=True)
        if metric<best and math.isfinite(metric):
            best=metric
            publish(net,a.output,seen,len(indices),hasy_count,synthetic_count,metric,epoch)
    if not Path(a.output).exists():raise RuntimeError("Completion model not exported")
    Path("models/glyph-completion-metrics.json").write_text(json.dumps(
        {"held_out_masked_bce":best,"human_emnist_characters":len(indices),
         "human_hasy_symbols":hasy_count,"synthetic_punctuation":synthetic_count,
         "training_presentations":seen,"model":a.output},indent=2))
    print("Handwriting-only completion model trained from scratch.",flush=True)
if __name__=="__main__":main()
