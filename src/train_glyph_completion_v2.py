#!/usr/bin/env python3
"""INK AI V2: ~1.1M-parameter class-conditional handwriting completion model.

Trains from random initialization on real handwritten EMNIST characters and
HASYv2 symbols plus explicitly marked synthetic punctuation. No object sketches.
Fine-tunes specifically on visually ambiguous glyph families. Tests with held-out
EMNIST writers (the official test split), saves best validation checkpoint.

Important: the static EMNIST raster dataset has no original pen movement order.
This model learns plausible *missing ink*, not a guarantee about stroke direction.
"""
import argparse,base64,datetime,json,math,random,sys,time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader,Subset
from torchvision.datasets import EMNIST
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import RealChars,HandwrittenSymbols,SyntheticPunctuation,Mixed,CHARS,LOOKUP,SEED

HIDDEN=384
EMBED=48
# Exactly 1,106,848 params with 102 classes, > 1 million trainable parameters.
HARD="Il1iLjJ0OoQ9gqPpBb6GSs5Zz2UuVvWwMnHhryYcCeEaAtTfF"
HARD_LABELS={LOOKUP[c] for c in HARD if c in LOOKUP}

class CompletionV2(nn.Module):
    def __init__(self):
        super().__init__()
        self.embedding=nn.Embedding(len(CHARS),EMBED)
        self.fc1=nn.Linear(1024+EMBED,HIDDEN)
        self.fc2=nn.Linear(HIDDEN,HIDDEN)
        self.fc3=nn.Linear(HIDDEN,HIDDEN)
        self.fc4=nn.Linear(HIDDEN,1024)
    def forward(self,x,labels):
        b=x.shape[0]
        embedding=self.embedding(labels)
        h=torch.relu(self.fc1(torch.cat((x.reshape(b,1024),embedding),dim=-1)))
        h=torch.relu(self.fc2(h)+h)
        h=torch.relu(self.fc3(h)+h)
        return self.fc4(h)

def masks(b,device):
    xx=torch.arange(32,device=device)[None,None,:]
    yy=torch.arange(32,device=device)[None,:,None]
    kind=torch.randint(0,9,(b,),device=device)
    threshold=torch.randint(8,26,(b,),device=device)
    m=torch.ones((b,32,32),device=device,dtype=torch.float32)
    for k in range(4):
        sel=kind==k
        if not sel.any():continue
        t=threshold[sel,None,None]
        if k==0:m[sel]=(xx<=t).float()
        if k==1:m[sel]=(xx>=32-t).float()
        if k==2:m[sel]=(yy<=t).float()
        if k==3:m[sel]=(yy>=32-t).float()
    for k in [4,5]:
        sel=kind==k
        if not sel.any():continue
        a=torch.randn(int(sel.sum()),device=device)*.25
        if k==4:
            plane=(xx/31 + (yy-16)*a[:,None,None]/31)
        else:
            plane=(yy/31 + (xx-16)*a[:,None,None]/31)
        cuts=torch.rand(int(sel.sum()),1,1,device=device)*.45+.25
        m[sel]=(plane<cuts).float()
    sel=kind==6
    if sel.any():
        n=int(sel.sum())
        x0=torch.randint(0,23,(n,1,1),device=device)
        y0=torch.randint(0,23,(n,1,1),device=device)
        m[sel]=((xx<x0)|(xx>x0+torch.randint(5,13,(n,1,1),device=device))|
                (yy<y0)|(yy>y0+torch.randint(5,13,(n,1,1),device=device))).float()
    sel=kind==7
    if sel.any():
        m[sel]=(torch.rand((int(sel.sum()),32,32),device=device)>.35).float()
    sel=kind==8
    if sel.any():
        n=int(sel.sum())
        x0=torch.randint(0,32,(n,1,1),device=device)
        y0=torch.randint(0,32,(n,1,1),device=device)
        radius=torch.randint(7,19,(n,1,1),device=device)
        m[sel]=(((xx-x0)**2+(yy-y0)**2)<=radius**2).float()
    return m.reshape(b,1024)

def criterion(logits,target,mask):
    truth=target.reshape(target.shape[0],1024)
    probs=torch.sigmoid(logits)
    missing=(1-mask)
    # Heavier missing-ink emphasis, less reward for guessing pale background.
    bce=nn.functional.binary_cross_entropy_with_logits(logits,truth,reduction="none")
    weights=(.45+3.3*truth)*(.35+2.3*missing)
    reconstruction=(bce*weights).mean()
    # Suppress the gray haze produced by earlier BCE-only training.
    missing_true=truth*missing
    missing_pred=probs*missing
    dice=1-((2*(missing_true*missing_pred).sum(dim=1)+1)/
             (missing_true.sum(dim=1)+missing_pred.sum(dim=1)+1)).mean()
    ink_constraint=(torch.relu(.40-probs)*truth*mask).mean()
    return reconstruction+.34*dice+.3*ink_constraint

@torch.inference_mode()
def metrics(model,loader,seed):
    torch.manual_seed(seed)
    model.eval()
    total=0.;seen=0
    intersection=pred_total=true_total=0.
    for x,y in loader:
        observed=masks(len(x),x.device)
        t=x.reshape(len(x),1024)
        out=model(t*observed,y)
        loss=criterion(out,t,observed)
        total+=float(loss)*len(x);seen+=len(x)
        missing=(observed<.5)
        pred=(torch.sigmoid(out)>.48)&missing
        truth=(t>.40)&missing
        intersection+=(pred&truth).sum().item()
        pred_total+=pred.sum().item()
        true_total+=truth.sum().item()
    f1=2*intersection/max(1,pred_total+true_total)
    return {"validation_loss":total/max(1,seen),"missing_ink_f1":f1,"tested":seen}

def encode(layer):
    w=layer.weight.detach().cpu().numpy()
    b=layer.bias.detach().cpu().numpy()
    scale=float(max(1.e-8,np.max(np.abs(w))/127))
    q=np.clip(np.rint(w/scale),-127,127).astype(np.int8)
    return {"shape":list(w.shape),"scale":scale,
            "weights":base64.b64encode(q.tobytes()).decode("ascii"),
            "bias":np.round(b,6).tolist()}

def export(model,path,stats,meta):
    model.cpu()
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    item={"format":"ink-glyph-completion-residual-v2",
          "name":"INK AI trained 1.1M parameter glyph completion",
          "labels":list(CHARS),
          "dimensions":{"input":1024,"class_embedding":EMBED,"hidden":HIDDEN,"output":1024},
          "parameter_count":sum(p.numel() for p in model.parameters()),
          "embedding":np.round(model.embedding.weight.detach().numpy(),6).tolist(),
          "layers":[encode(getattr(model,k)) for k in ("fc1","fc2","fc3","fc4")],
          "training":dict(meta,validation_loss=round(stats["validation_loss"],6),
             missing_ink_f1=round(stats["missing_ink_f1"],6),
             note="Real handwritten image completion; not stroke-order inference",
             trained_from_scratch=True,
             date=datetime.datetime.now(datetime.timezone.utc).isoformat())}
    p.write_text(json.dumps(item,separators=(",",":"),ensure_ascii=False),encoding="utf8")
    print("MODEL SAVED:",p,"bytes",p.stat().st_size,"parameters",item["parameter_count"],
          "loss",stats["validation_loss"],"missing F1",stats["missing_ink_f1"],flush=True)

def run_stage(model,optimizer,loader,validation,stage,start_epoch,epochs,seen,best,path,meta):
    for epoch in range(start_epoch,start_epoch+epochs):
        model.train();start=time.monotonic();loss_sum=0.
        for bi,(x,y) in enumerate(loader):
            target=x.reshape(len(x),1024)
            seen+=len(x)
            obs=masks(len(x),x.device)
            optimizer.zero_grad(set_to_none=True)
            pred=model(target*obs,y)
            loss=criterion(pred,target,obs)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.0)
            optimizer.step()
            loss_sum+=float(loss)*len(x)
            if (bi+1)%200==0:
                print(stage,"epoch",epoch+1,"batch",bi+1,"/",len(loader),
                      "presentations",seen,"loss",float(loss),flush=True)
        result=metrics(model,validation,SEED+991)
        print(stage,"epoch",epoch+1,"train loss",round(loss_sum/len(loader.dataset),4),
              "val",result,"elapsed",round(time.monotonic()-start,1),flush=True)
        if result["validation_loss"]<best["validation_loss"]-.0001:
            best=dict(result,stage=stage,epoch=epoch+1)
            export(model,path,result,dict(meta,training_presentations=seen,
                  best_stage=stage,best_epoch=epoch+1))
    return seen,best

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--samples",type=int,default=100000)
    p.add_argument("--epochs",type=int,default=4)
    p.add_argument("--finetune-epochs",type=int,default=1)
    p.add_argument("--batch",type=int,default=256)
    p.add_argument("--hasy",action="store_true")
    p.add_argument("--data",default=".data")
    p.add_argument("--out",default="models/ink-glyph-completion-v2.json")
    a=p.parse_args()
    torch.manual_seed(SEED);torch.set_num_threads(4)
    np.random.seed(SEED);random.seed(SEED)
    print("Loading genuine handwritten digits/letters (EMNIST) + symbols (HASYv2)",flush=True)
    original=EMNIST(a.data,split="byclass",train=True,download=True)
    heldout=EMNIST(a.data,split="byclass",train=False,download=True)
    rng=torch.Generator().manual_seed(SEED+11)
    indices=torch.randperm(len(original),generator=rng)[:a.samples].tolist()
    emnist=RealChars(original)
    parts=[Subset(emnist,indices)]
    hasy_count=0
    if a.hasy:
        try:
            hasy=HandwrittenSymbols(a.data)
            hasy_count=len(hasy)
            if hasy_count:parts.append(hasy)
        except Exception as e:print("HASYv2 unavailable:",e,flush=True)
    synthetic=12000
    parts.append(SyntheticPunctuation(synthetic))
    dataset=Mixed(parts)
    loader=DataLoader(dataset,batch_size=a.batch,shuffle=True,num_workers=2)
    val_indices=torch.randperm(len(heldout),generator=rng)[:3500].tolist()
    val=DataLoader(Subset(RealChars(heldout,augment=False),val_indices),
                   batch_size=256,num_workers=2)
    net=CompletionV2()
    parameter_count=sum(p.numel() for p in net.parameters())
    print("PARAMETERS:",parameter_count,flush=True)
    assert 1_000_000 <= parameter_count <= 2_000_000
    meta={"real_emnist_characters":len(indices),"real_hasy_symbols":hasy_count,
          "synthetic_punctuation_examples":synthetic,
          "dataset":"EMNIST ByClass + HASYv2 + synthetic punctuation",
          "train_mask_types":9,
          "training_method":"class-conditioned denoising + masked Dice; hard-class finetune",
          "fine_tuned_labels":HARD}
    optim=torch.optim.AdamW(net.parameters(),lr=.00125,weight_decay=.00008)
    seen=0;best={"validation_loss":float("inf")}
    seen,best=run_stage(net,optim,loader,val,"pretrain",0,a.epochs,seen,best,a.out,meta)
    # FINE-TUNE difficult letters, uppercase/lowercase ambiguity and digits:
    # use actual EMNIST labels, not generic sketch/object images.
    confusion_indices=[i for i in indices if int(original.targets[i]) in HARD_LABELS]
    if not confusion_indices:raise RuntimeError("No ambiguous handwriting examples")
    fine=DataLoader(Subset(emnist,confusion_indices),
                    batch_size=a.batch,shuffle=True,num_workers=2)
    fine_optim=torch.optim.AdamW(net.parameters(),lr=.00024,weight_decay=.00008)
    seen,best=run_stage(net,fine_optim,fine,val,"hard-class-fine-tune",
                        a.epochs,a.finetune_epochs,seen,best,a.out,meta)
    print("BEST VALIDATED MODEL:",best,flush=True)
    Path("models/glyph-completion-v2-metrics.json").write_text(json.dumps({
      "parameter_count":parameter_count,"best":best,
      "training_presentations":seen,"ambiguous_finetune_samples":len(confusion_indices),
      "emnist_train":len(indices),"hasy_train":hasy_count,"synthetic_train":synthetic,
      "model":a.out},indent=2),encoding="utf8")
    assert Path(a.out).exists(),"Model export missing"
if __name__=="__main__":main()
