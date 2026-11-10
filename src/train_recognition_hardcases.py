#!/usr/bin/env python3
"""INK AI hard-case recognizer fine-tuning experiment, V5.

Fine-tunes the OWN published V2 CNN on browser-like rasterizations of *genuine
UJI Pen Characters v2* ONLINE pen trajectories (writer-disjoint train/validation).
Mixed rehearsal on EMNIST + math punctuation prevents catastrophic forgetting.
No outside pretrained model, API, or lookup templates.

UJI license: CC BY 4.0, DOI:10.24432/C5FG8S.
Publishing gate uses an untouched subset of UJI test writers and an EMNIST
holdout, and explicitly reports tradeoffs. Metrics are not fabricated.
"""
import argparse,json,random,math,time,sys
from pathlib import Path
from collections import Counter
import numpy as np
from PIL import Image,ImageDraw
import torch
from torch import nn
from torch.utils.data import DataLoader,Dataset,Subset,ConcatDataset,WeightedRandomSampler
from torchvision.datasets import EMNIST
from torchvision.transforms import functional as TF, RandomAffine, InterpolationMode
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,LOOKUP,RealChars,SyntheticPunctuation,SEED,export
from train_recognition_v2 import restore

HARD_CHARS=('1','I','l','i','j','t')
HARD_IDS={LOOKUP[c] for c in HARD_CHARS}
from train_stroke_sequence import parse_uji,fetch_uji

# Keep glyphs to the 26/32 pixel browser normalization size, rather than
# leaving EMNIST's original 28px black border and mismatched stroke weights.
CANVAS=128
TRAIN_AFFINE=RandomAffine(10,translate=(.055,.055),scale=(.88,1.09),
                         shear=(-8,8),interpolation=InterpolationMode.BILINEAR,fill=0)

def render_pen(strokes,brush=9.0,angle=0.0,dx=0.0,dy=0.0):
    points=[np.asarray(p,dtype=np.float32) for p in strokes if len(p)>1]
    if not points:return torch.zeros(1,32,32)
    all_pts=np.concatenate(points)
    xymin=np.min(all_pts,axis=0);xymax=np.max(all_pts,axis=0)
    center=(xymin+xymax)/2
    scale=26*4/max(1,float(np.max(xymax-xymin)))
    theta=math.radians(angle);ct=math.cos(theta);st=math.sin(theta)
    rot=np.array([[ct,-st],[st,ct]],np.float32)
    result=Image.new("L",(CANVAS,CANVAS),0)
    painter=ImageDraw.Draw(result)
    for s in points:
        xy=np.clip((s-center)@rot.T*scale +
                   np.array([CANVAS/2+dx,CANVAS/2+dy]),-20,CANVAS+20)
        values=[tuple(map(float,p)) for p in xy]
        if len(values)>1:
            painter.line(values,fill=255,width=int(brush),joint="curve")
            radius=brush/2
            for x,y in (values[0],values[-1]):
                painter.ellipse((x-radius,y-radius,x+radius,y+radius),fill=255)
    image=result.resize((32,32),Image.Resampling.LANCZOS)
    return TF.to_tensor(image)

class HumanPen(Dataset):
    def __init__(self,records,augment=False):
        self.records=[(c,s) for c,_,_,s in records if c in LOOKUP]
        self.augment=augment
        if not augment:
            self.fixed=[render_pen(s,brush=10) for c,s in self.records]
        else:self.fixed=None
    def __len__(self):return len(self.records)
    def __getitem__(self,i):
        char,strokes=self.records[i]
        if self.fixed is not None:return self.fixed[i],LOOKUP[char]
        rng=random.Random(SEED+i*1069+random.randint(1,1000000))
        x=render_pen(strokes,brush=rng.uniform(6,15),
             angle=rng.uniform(-10,10),dx=rng.uniform(-5,5),dy=rng.uniform(-5,5))
        if rng.random()<.4:x=TRAIN_AFFINE(x)
        return x,LOOKUP[char]

class BrowserLikeEMNIST(Dataset):
    def __init__(self,subset,augment=False):
        self.base=subset;self.augment=augment
    def __len__(self):return len(self.base)
    def __getitem__(self,i):
        im,label=self.base[i] # Already upright 32x32
        # Re-center and scale the actual glyph ink to 26/32 like browser
        # normalization, while preserving whitespace and aspect ratio.
        data=im.squeeze().numpy()
        pos=np.argwhere(data>.08)
        if len(pos)>6:
            y0,x0=pos.min(axis=0);y1,x1=pos.max(axis=0)
            patch=im[:,max(0,y0-1):min(32,y1+2),max(0,x0-1):min(32,x1+2)]
            h,w=patch.shape[-2:]
            size=max(1,max(w,h))
            r=26/size;nh=max(1,round(h*r));nw=max(1,round(w*r))
            res=torch.nn.functional.interpolate(patch[None],size=(nh,nw),
                mode="bilinear",align_corners=False)[0]
            arr=torch.zeros((1,32,32))
            yy=(32-nh)//2;xx=(32-nw)//2;arr[:,yy:yy+nh,xx:xx+nw]=res
            im=arr
        if self.augment and random.random()<.5:im=TRAIN_AFFINE(im)
        return im,label

@torch.inference_mode()
def eval_model(model,loader):
    model.eval();counts=np.zeros(62,np.int64);hits=np.zeros(62,np.int64)
    total=right=0
    for image,label in loader:
        pred=model(image).argmax(dim=1).numpy()
        ys=label.numpy()
        total+=len(ys);right+=int((pred==ys).sum())
        for y in np.unique(ys):
            if y>=62:continue
            counts[y]+=int(np.sum(ys==y))
            hits[y]+=int(np.sum((ys==y)&(pred==ys)))
    pc=hits/np.maximum(1,counts)
    active_hard=[c for c in HARD_CHARS if counts[LOOKUP[c]]>0]
    active=counts>0
    return {"overall":round(right/max(1,total),6),
      "macro":round(float(pc[active].mean()),6),
      "lowercase_macro":round(float(pc[36:62][counts[36:62]>0].mean()),6),
      "hard_macro":round(float(np.mean([pc[LOOKUP[c]] for c in active_hard])),6) if active_hard else 0.0,
      "hard_per_class":{c:round(float(pc[LOOKUP[c]]),5) for c in active_hard},
      "hard_counts":{c:int(counts[LOOKUP[c]]) for c in active_hard},
      "tested":total}

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--data",default=".data")
    a.add_argument("--epochs",type=int,default=9)
    a.add_argument("--batch",type=int,default=192)
    a.add_argument("--samples-per-epoch",type=int,default=96000)
    a.add_argument("--out",default="models/ink-cnn-v5.json")
    args=a.parse_args()
    torch.set_num_threads(4)
    random.seed(SEED+501);np.random.seed(SEED+501);torch.manual_seed(SEED+501)
    print("Loading authentic UJI ordered pen trajectories",flush=True)
    real=parse_uji(fetch_uji(Path(args.data)/"ujipenchars2"))
    train=[r for r in real if r[2]=="train"]
    test=[r for r in real if r[2]=="test"]
    # Test writers disjoint both from training and between the calibration
    # and validation splits. No random images from same writer on both sides.
    writers=sorted({r[1] for r in test})
    random.Random(SEED+902).shuffle(writers)
    val_writers=set(writers[:len(writers)//2])
    evaluation_writers=set(writers[len(writers)//2:])
    penTrain=HumanPen(train,augment=True)
    penVal=HumanPen([r for r in test if r[1] in val_writers])
    penEval=HumanPen([r for r in test if r[1] in evaluation_writers])
    assert len(train)>=6000 and len(penVal)>=1100 and len(penEval)>=1100
    emTr=EMNIST(args.data,split="byclass",train=True,download=True)
    emTe=EMNIST(args.data,split="byclass",train=False,download=True)
    rng=torch.Generator().manual_seed(SEED+302)
    emTrainIds=torch.randperm(len(emTr),generator=rng)[:140000].tolist()
    emEvalIds=torch.randperm(len(emTe),generator=rng)[:14000].tolist()
    emTrain=BrowserLikeEMNIST(Subset(RealChars(emTr,augment=False),emTrainIds),augment=True)
    emEval=BrowserLikeEMNIST(Subset(RealChars(emTe,augment=False),emEvalIds))
    punctuation=SyntheticPunctuation(11000)
    parts=[penTrain,emTrain,punctuation]
    combined=ConcatDataset(parts)
    samples=[];weights=[]
    # About half genuine recorded human pen movements (oversampled by
    # augmentation), 43% normalized handwritten EMNIST and 7% symbols.
    distributions=[.54,.40,.06]
    for dataset,proportion in zip(parts,distributions):
        if isinstance(dataset,HumanPen):
            cls=[LOOKUP[char] for char,_ in dataset.records]
        elif isinstance(dataset,BrowserLikeEMNIST):
            cls=[int(emTr.targets[i]) for i in emTrainIds]
        else:
            cls=[LOOKUP[dataset.symbols[i%len(dataset.symbols)]] for i in range(len(dataset))]
        counts=Counter(cls)
        raw=np.array([counts[v]**(-.42)*(2.6 if v in HARD_IDS else 1.0) for v in cls],np.float64)
        raw=raw/raw.sum()*proportion
        weights.extend(raw.tolist())
    sampler=WeightedRandomSampler(weights,num_samples=args.samples_per_epoch,
        replacement=True,generator=torch.Generator().manual_seed(SEED+304))
    loader=DataLoader(combined,batch_size=args.batch,sampler=sampler,num_workers=2)
    val=DataLoader(penVal,batch_size=256,num_workers=2)
    independent=DataLoader(penEval,batch_size=256,num_workers=2)
    emTest=DataLoader(emEval,batch_size=256,num_workers=2)
    print("TRAIN UJI:",len(penTrain),"CALIBRATION WRITER-HELDOUT:",len(penVal),
          "INDEPENDENT WRITER-HELDOUT:",len(penEval),
          "EMNIST TEST:",len(emEval),flush=True)
    model=restore("models/ink-cnn-v3.json")
    v2pen=eval_model(model,independent)
    v2em=eval_model(model,emTest)
    v2cal=eval_model(model,val)
    print("V3 REAL PEN BASELINE:",v2pen,"EMNIST:",v2em,flush=True)
    best=None;seen=0;history=[]
    for ep in range(1,args.epochs+1):
        model.train();started=time.monotonic();train_loss=0
        optimizer=torch.optim.AdamW(model.parameters(),lr=.000095 if ep<4 else (.000045 if ep<7 else .000018),
                                 weight_decay=.00012)
        for i,(x,y) in enumerate(loader):
            logits=model(x)
            loss_per=nn.functional.cross_entropy(logits,y,label_smoothing=.012,reduction="none")
            hard=torch.zeros_like(y,dtype=torch.bool)
            for h in HARD_IDS:hard|=(y==h)
            loss=(loss_per*(1+.22*hard.float())).mean()
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.5)
            optimizer.step()
            train_loss+=float(loss)*len(x);seen+=len(x)
            if (i+1)%150==0:
                print("epoch",ep,"batch",i+1,"/",len(loader),
                  "presentations",seen,"loss",round(float(loss),4),flush=True)
        # Choose checkpoint on held-out calibration writers only. Keep an
        # independent writer group aside for the final assessment.
        pen=eval_model(model,val)
        em=eval_model(model,emTest)
        # Online handwriting is priority but EMNIST should not collapse.
        weighted=.54*pen["overall"]+.25*pen["hard_macro"]+.21*em["overall"]
        # Reject serious degradation in EMNIST while favoring pen writing.
        eligible=(em["overall"]>=v2em["overall"]-.020 and
           pen["overall"]>=v2cal["overall"]+.004 and
           pen["hard_macro"]>=v2cal["hard_macro"]+.02)
        row={"epoch":ep,"train_loss":round(train_loss/args.samples_per_epoch,5),
             "pen_calibration":pen,"emnist_style":em,
             "eligible":eligible,"objective":round(weighted,6),
             "elapsed_s":round(time.monotonic()-started,1)}
        history.append(row);print("V3 EPOCH RESULTS:",json.dumps(row),flush=True)
        if eligible and (best is None or weighted>best["objective"]):
            export(model,args.out,seen,0,em["overall"],ep)
            item=json.loads(Path(args.out).read_text())
            item["name"]="INK AI V5 — targeted similar-character CNN fine-tuning"
            item["training"]["finetuned_from"]="models/ink-cnn-v3.json"
            item["training"]["hard_characters"]=list(HARD_CHARS)
            item["training"]["domain"]="UJI real pen trajectories rendered with browser-equivalent normalization + EMNIST rehearsal"
            item["training"]["uji_train_real"]=len(penTrain)
            item["training"]["uji_calibration_writers"]=len(val_writers)
            item["training"]["uji_calibration_glyphs"]=len(penVal)
            item["training"]["emnist_style_test_accuracy"]=em["overall"]
            item["training"]["user_pen_calibration_accuracy"]=pen["overall"]
            Path(args.out).write_text(json.dumps(item,separators=(",",":")))
            best={"objective":weighted,"epoch":ep,"calibration":pen,"emnist":em}
    if best:
        # Evaluate the actual selected checkpoint, NOT the model's last epoch.
        upgraded=restore(args.out)
        pen_result=eval_model(upgraded,independent)
        independent_win=pen_result["overall"]-v2pen["overall"]
        em_gain=best["emnist"]["overall"]-v2em["overall"]
        safe=independent_win>=.005 and em_gain>=-.020 and pen_result["hard_macro"]>=v2pen["hard_macro"]+.02
        if not safe:
            Path(args.out).unlink(missing_ok=True)
            best["rejected_independent_writer_test"]=True
        else:
            best["independent_test"]=pen_result
    else:
        pen_result=None;safe=False
    metrics={
       "model":"models/ink-cnn-v5.json" if safe else "models/ink-cnn-v3.json",
       "eligible":bool(safe),"baseline_v2":{"pen_independent":v2pen,
          "pen_calibration":v2cal,"emnist_browser_style":v2em},
       "best":best,"independent_pen_v3":pen_result,
       "history":history,"training_presentations":seen,
       "uji_real_training_glyphs":len(penTrain),
       "uji_independent_glyphs":len(penEval),
       "domain":"real UJI pen strokes, browser-equivalent normalized rasterization; no external pretrained model"}
    metrics["target_accuracy"]=0.90
    metrics["target_reached"]=bool(safe and pen_result["overall"]>=0.90)
    metrics["hard_characters"]=list(HARD_CHARS)
    Path("models/recognition-v5-metrics.json").write_text(json.dumps(metrics,indent=2))
    print("RELEASE DECISION",json.dumps({k:v for k,v in metrics.items()
      if k!="history"}),flush=True)
if __name__=="__main__":main()
