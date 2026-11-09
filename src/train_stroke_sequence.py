#!/usr/bin/env python3
"""Independent autoregressive handwriting vector generator, no template matching.

Dataset: UJI Pen Characters v2, actual ordered online x/y trajectories
(11,640 samples / 60 writers / 97 glyphs), CC BY 4.0.
Supplement only characters absent from UJI with explicitly synthetic vector
trajectories (simple punctuation and math). Train/test UJI split BY WRITER.

Each token is [dx,dy,draw] in a stable normalized glyph frame. A class-
conditioned two-layer GRU learns a five-component Gaussian-mixture distribution
over the NEXT pen movement, pen-up probability and sequence-stop probability.
The browser uses exactly these learned recurrent weights, autoregressively.

No EMNIST raster tracing, nearest neighbor, example matching or outside model.
"""
from __future__ import annotations
import argparse,base64,io,json,math,random,sys,urllib.request,zipfile
from collections import Counter
from pathlib import Path
import numpy as np
import torch
from torch import nn
from torch.utils.data import Dataset,DataLoader
sys.path.insert(0,str(Path(__file__).resolve().parent))
from train import CHARS,LOOKUP,SEED

URLS=[
 "https://archive.ics.uci.edu/static/public/177/uji+pen+characters+version+2.zip",
 "https://archive.ics.uci.edu/ml/machine-learning-databases/uji-penchars/version2/ujipenchars2.txt"
]
MAX_STEPS=88
MIXTURES=5

def fetch_uji(folder):
    dest=Path(folder)/"ujipenchars2.txt"
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and dest.stat().st_size>3000000:
        return dest.read_text(encoding="utf8",errors="replace")
    error=None
    for url in URLS:
        try:
            req=urllib.request.Request(url,headers={"User-Agent":"INK-AI-Research/1.0"})
            with urllib.request.urlopen(req,timeout=120) as response:
                body=response.read()
            if zipfile.is_zipfile(io.BytesIO(body)):
                with zipfile.ZipFile(io.BytesIO(body)) as z:
                    names=[n for n in z.namelist() if n.lower().endswith("ujipenchars2.txt")]
                    if not names:raise ValueError("Archive missing ujipenchars2.txt")
                    body=z.read(names[0])
            text=body.decode("utf8",errors="replace")
            if text.count("WORD ")<10000:raise ValueError("UJI archive has too few character records")
            dest.write_text(text,encoding="utf8")
            return text
        except Exception as exc:
            print("UJI endpoint error:",url,str(exc),flush=True)
            error=exc
    raise RuntimeError(f"Cannot download the authentic UJI pen trajectory dataset: {error}")

def parse_uji(text):
    lines=[x.strip() for x in text.splitlines()]
    samples=[]
    i=0
    while i<len(lines):
        row=lines[i];i+=1
        if not row.startswith("WORD "):continue
        fields=row.split(maxsplit=2)
        if len(fields)!=3:continue
        char,session=fields[1],fields[2]
        if char not in LOOKUP:continue
        while i<len(lines) and (not lines[i] or lines[i].startswith("//")):i+=1
        if i>=len(lines) or not lines[i].startswith("NUMSTROKES "):continue
        try:n=int(lines[i].split()[1])
        except ValueError:continue
        i+=1
        strokes=[]
        for _ in range(n):
            if i>=len(lines):break
            bits=lines[i].split();i+=1
            if len(bits)<4 or bits[0]!="POINTS":break
            count=int(bits[1])
            numbers=[int(k) for k in bits[3:]]
            if len(numbers)!=count*2:continue
            points=np.array(numbers,dtype=np.float32).reshape(-1,2)
            keep=np.concatenate([[True],np.any(points[1:]!=points[:-1],axis=1)])
            points=points[keep]
            if len(points)>1:strokes.append(points)
        if strokes:
            writer=session.rsplit("-",1)[0]
            # UJI explicitly designates 40 training and 20 test writers.
            partition="test" if writer.startswith("tst_") else "train"
            samples.append((char,writer,partition,strokes))
    print("Parsed real recorded pen trajectories:",len(samples),flush=True)
    return samples

def path(*points):
    return np.array(points,dtype=np.float32)
def arc(cx,cy,rx,ry,a,b,n=16):
    t=np.linspace(a,b,n,dtype=np.float32)
    return np.stack([cx+rx*np.cos(t),cy+ry*np.sin(t)],axis=1)
def recipes():
    p=path
    return {
     "+":[p((.14,.50),(.86,.50)),p((.50,.13),(.50,.87))],
     "=":[p((.12,.36),(.88,.36)),p((.12,.66),(.88,.66))],
     "^":[p((.11,.73),(.50,.19),(.89,.73))],
     "_":[p((.12,.84),(.88,.84))],
     "*":[p((.5,.13),(.5,.85)),p((.20,.30),(.80,.70)),p((.80,.30),(.20,.70))],
     "/":[p((.18,.88),(.83,.12))],
     "\\":[p((.18,.12),(.83,.88))],
     "|":[p((.5,.09),(.5,.91))],
     "`":[p((.55,.12),(.42,.28),(.53,.38))],
     "~":[p((.08,.55),(.20,.40),(.36,.38),(.56,.61),(.75,.62),(.92,.45))],
     "[":[p((.70,.12),(.30,.12),(.30,.89),(.70,.89))],
     "]":[p((.30,.12),(.70,.12),(.70,.89),(.30,.89))],
     "{":[p((.69,.09),(.43,.20),(.45,.38),(.24,.50),(.45,.60),(.43,.79),(.69,.91))],
     "}":[p((.31,.09),(.57,.20),(.55,.38),(.76,.50),(.55,.60),(.57,.79),(.31,.91))],
     "#":[p((.35,.1),(.25,.9)),p((.70,.1),(.60,.9)),p((.1,.38),(.88,.38)),p((.10,.64),(.88,.64))],
     "&":[p((.80,.81),(.28,.3),(.28,.15),(.5,.1),(.66,.28),(.22,.71),(.4,.9),(.65,.81),(.79,.62))],
     "×":[p((.18,.18),(.82,.82)),p((.82,.18),(.18,.82))],
     "÷":[p((.12,.50),(.88,.50)),p((.50,.21),(.51,.22)),p((.50,.78),(.51,.79))],
     "±":[p((.12,.37),(.88,.37)),p((.5,.10),(.5,.65)),p((.12,.87),(.88,.87))],
     "∞":[arc(.29,.52,.22,.20,0,2*math.pi,19),arc(.71,.52,.22,.20,math.pi,3*math.pi,19)],
     "√":[p((.09,.58),(.30,.81),(.49,.15),(.89,.15))],
     "≠":[p((.15,.38),(.85,.38)),p((.15,.64),(.85,.64)),p((.20,.85),(.79,.17))],
     "≤":[p((.82,.18),(.22,.48),(.82,.76)),p((.20,.88),(.84,.88))],
     "≥":[p((.18,.18),(.78,.48),(.18,.76)),p((.20,.88),(.84,.88))]
    }

def normalized_paths(strokes,rng,augment=False):
    seq=[np.asarray(p,dtype=np.float32) for p in strokes if len(p)>=2]
    if not seq:return None
    all_points=np.concatenate(seq)
    mn=np.min(all_points,axis=0);mx=np.max(all_points,axis=0)
    size=max(float(np.max(mx-mn)),1.0)
    # Stable box: complete glyph spans roughly 0.66 normalized width/height.
    scale=.68/size
    center=(mx+mn)/2
    shift=np.array([.50,.50],np.float32)
    if augment:
        shift+=rng.uniform(-.09,.09,size=2).astype(np.float32)
        angle=rng.uniform(-.12,.12);cs=math.cos(angle);sn=math.sin(angle)
        rot=np.array([[cs,-sn],[sn,cs]],np.float32)
        scale*=rng.uniform(.85,1.12)
    else:rot=np.eye(2,dtype=np.float32)
    return [np.clip((p-center)@rot.T*scale+shift,-.06,1.06) for p in seq]

def resample_paths(strokes,max_steps=MAX_STEPS):
    clean=[]
    for points in strokes:
        distances=np.linalg.norm(np.diff(points,axis=0),axis=1)
        sums=np.r_[0,np.cumsum(distances)]
        total=float(sums[-1])
        if total<.002:continue
        count=int(np.clip(round(total/.025)+1,3,36))
        t=np.linspace(0,total,count,dtype=np.float32)
        pp=np.stack([np.interp(t,sums,points[:,ax]) for ax in (0,1)],axis=-1)
        clean.append(pp.astype(np.float32))
    if not clean:return None
    # Preserve pen-ups. Never merge separate symbol strokes.
    total=sum(len(p) for p in clean)
    if total>max_steps:
        factor=max_steps/total
        clean=[p[np.round(np.linspace(0,len(p)-1,max(2,int(len(p)*factor)))).astype(int)]
               for p in clean]
    return clean

def tokens_from_strokes(strokes):
    result=[];prev=np.array([0.,0.],np.float32)
    for stroke in strokes:
        for j,p in enumerate(stroke):
            delta=p-prev
            result.append([float(delta[0]),float(delta[1]),float(j!=0)])
            prev=p
    return np.array(result[:MAX_STEPS],np.float32)

class Strokes(Dataset):
    def __init__(self,records,augment=True):
        self.records=records;self.augment=augment
    def __len__(self):return len(self.records)
    def __getitem__(self,i):
        label,strokes=self.records[i]
        rng=np.random.default_rng((SEED*157+i*131+self.augment*7919+
                                   random.randrange(999999) if self.augment else SEED+i))
        paths=normalized_paths(strokes,rng,augment=self.augment)
        resampled=resample_paths(paths)
        if resampled is None:raise RuntimeError("Empty stroke trajectory")
        tokens=tokens_from_strokes(resampled)
        values=np.zeros((MAX_STEPS,3),np.float32)
        values[:len(tokens)]=tokens
        return torch.from_numpy(values),LOOKUP[label],len(tokens)

class SeqMDN(nn.Module):
    def __init__(self,hidden=192,embed=48,layers=2):
        super().__init__()
        self.hidden=hidden;self.embed=embed;self.layers=layers
        self.embedding=nn.Embedding(len(CHARS),embed)
        self.rnn=nn.GRU(3+embed,hidden,num_layers=layers,batch_first=True)
        self.head=nn.Linear(hidden,5*MIXTURES+2)
    def forward(self,seq,labels):
        embedding=self.embedding(labels)[:,None,:].expand(-1,seq.shape[1],-1)
        h,_=self.rnn(torch.cat([seq,embedding],dim=-1))
        return self.head(h)

def objective(pred,series,length):
    b,t,_=pred.shape
    target=torch.zeros_like(series)
    target[:,:-1]=series[:,1:]
    idx=torch.arange(t,device=pred.device)[None,:]
    valid=idx<length[:,None]
    continue_mask=idx<length[:,None]-1
    stop=(idx==length[:,None]-1).float()
    k=MIXTURES
    pi=pred[:,:,:k]
    mx=pred[:,:,k:2*k]
    my=pred[:,:,2*k:3*k]
    sx=pred[:,:,3*k:4*k].clamp(-5,1)
    sy=pred[:,:,4*k:5*k].clamp(-5,1)
    dx=target[:,:,0,None];dy=target[:,:,1,None]
    logp=-math.log(2*math.pi)-sx-sy - .5*(
        (dx-mx).square()*torch.exp(-2*sx)+(dy-my).square()*torch.exp(-2*sy))
    nll=-torch.logsumexp(torch.log_softmax(pi,dim=-1)+logp,dim=-1)
    lift=nn.functional.binary_cross_entropy_with_logits(
        pred[:,:,5*k],target[:,:,2],reduction="none")
    eos=nn.functional.binary_cross_entropy_with_logits(
        pred[:,:,5*k+1],stop,reduction="none",pos_weight=torch.tensor(7.))
    denom=continue_mask.sum().clamp(min=1)
    return ((nll+.26*lift)*continue_mask).sum()/denom + .23*(eos*valid).sum()/valid.sum().clamp(min=1)

@torch.no_grad()
def evaluate(net,loader):
    net.eval();loss_sum=0;examples=0;pen_ok=pen_count=0
    for seq,label,length in loader:
        output=net(seq,label)
        loss_sum+=float(objective(output,seq,length))*len(seq);examples+=len(seq)
        target=seq[:,1:,2]
        valid=(torch.arange(MAX_STEPS-1)[None,:]<length[:,None]-1)
        predicted=(torch.sigmoid(output[:,:-1,5*MIXTURES])>.5)
        pen_ok+=int(((predicted==target.bool())&valid).sum())
        pen_count+=int(valid.sum())
    return {"heldout_nll":round(loss_sum/max(1,examples),5),
            "heldout_pen_state_accuracy":round(pen_ok/max(1,pen_count),5),
            "heldout_glyphs":examples}

def export(net,path,metrics,metadata):
    state=net.state_dict()
    def quant(t):
        arr=t.detach().cpu().numpy()
        scale=max(float(np.max(np.abs(arr)))/127,1e-8)
        ints=np.clip(np.rint(arr/scale),-127,127).astype(np.int8)
        return {"shape":list(arr.shape),"scale":scale,
                "weights":base64.b64encode(ints.tobytes()).decode("ascii")}
    layers=[]
    for j in range(net.layers):
        layers.append({
          "ih":quant(state[f"rnn.weight_ih_l{j}"]),
          "hh":quant(state[f"rnn.weight_hh_l{j}"]),
          "bias_ih":np.round(state[f"rnn.bias_ih_l{j}"].numpy(),5).tolist(),
          "bias_hh":np.round(state[f"rnn.bias_hh_l{j}"].numpy(),5).tolist()
        })
    payload={
      "format":"ink-online-stroke-mdn-v1",
      "architecture":{"input":3,"hidden":net.hidden,"embed":net.embed,
          "layers":net.layers,"mixtures":MIXTURES,"max_generate":56,
          "max_prefix":MAX_STEPS},
      "labels":list(CHARS),
      "parameter_count":sum(p.numel() for p in net.parameters()),
      "embedding":np.round(state["embedding.weight"].numpy(),6).tolist(),
      "gru":layers,
      "head_weight":quant(state["head.weight"]),
      "head_bias":np.round(state["head.bias"].numpy(),6).tolist(),
      "training":dict(metadata,metrics=metrics,trained_from_scratch=True,
          dataset_license="UJI Pen Characters v2 CC BY 4.0",
          provenance="UJI online pen trajectories + labeled procedural symbol vectors",
          not_a_raster_generator=True)
    }
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(payload,separators=(",",":"),ensure_ascii=False))
    print("EXPORTED trained autoregressive model",p.stat().st_size,
          "bytes",payload["parameter_count"],"parameters",metrics,flush=True)

def main():
    pa=argparse.ArgumentParser()
    pa.add_argument("--epochs",type=int,default=6)
    pa.add_argument("--fine-epochs",type=int,default=2)
    pa.add_argument("--batch",type=int,default=128)
    pa.add_argument("--hidden",type=int,default=192)
    pa.add_argument("--real-data",default=".data/ujipenchars2")
    pa.add_argument("--out",default="models/ink-stroke-sequence-v1.json")
    a=pa.parse_args()
    torch.manual_seed(SEED+101);torch.set_num_threads(4)
    random.seed(SEED+101);np.random.seed(SEED+101)
    samples=parse_uji(fetch_uji(a.real_data))
    train_real=[(char,stroke) for char,writer,split,stroke in samples if split=="train"]
    test_real=[(char,stroke) for char,writer,split,stroke in samples if split=="test"]
    if len(train_real)<6000 or len(test_real)<1800:
        raise RuntimeError(f"Invalid writer-disjoint UJI split: {len(train_real)} train {len(test_real)} test")
    labels=Counter(x[0] for x in train_real)
    templates=recipes()
    # Procedural stroke examples ONLY for classes not present in recorded UJI.
    omitted=[c for c in CHARS if c not in labels]
    if missing:=set(omitted)-set(templates):
        raise RuntimeError("No source stroke trajectories for: "+repr(sorted(missing)))
    synthetic=[]
    for char in omitted:
        for _ in range(320):
            synthetic.append((char,templates[char]))
    print("REAL TRAIN:",len(train_real),"REAL WRITER-HELDOUT:",len(test_real),
          "SYNTHETIC STROKE EXAMPLES:",len(synthetic),
          "MISSING FROM UJI:",repr(omitted),flush=True)
    training=Strokes(train_real+synthetic,augment=True)
    validation=Strokes(test_real,augment=False)
    # Training class balancing: repetitions by WeightedRandomSampler.
    class_counts=Counter(c for c,_ in training.records)
    weights=torch.tensor([class_counts[c]**(-.58) for c,_ in training.records],dtype=torch.double)
    length=max(len(training),13000)
    sampler=torch.utils.data.WeightedRandomSampler(weights,length,replacement=True)
    loader=DataLoader(training,batch_size=a.batch,sampler=sampler,num_workers=2)
    val=DataLoader(validation,batch_size=a.batch,num_workers=2)
    model=SeqMDN(hidden=a.hidden)
    print("TRAINABLE PARAMS:",sum(p.numel() for p in model.parameters()),flush=True)
    metadata={
      "real_training_glyphs":len(train_real),
      "real_writer_holdout_glyphs":len(test_real),
      "synthetic_vector_glyphs":len(synthetic),
      "real_supported_classes":"".join(sorted(set(labels))),
      "synthetic_only_classes":"".join(sorted(omitted)),
      "all_supported_classes":len(CHARS),
      "training_presentations":0,
      "writer_disjoint_validation":True
    }
    best=float("inf");seen=0;history=[]
    for stage,epochs,rate in [("train",a.epochs,.0012),("fine-tune",a.fine_epochs,.00023)]:
        optimizer=torch.optim.AdamW(model.parameters(),lr=rate,weight_decay=.00008)
        for epoch in range(epochs):
            model.train();acc=0;num=0
            for bi,(seq,char,steps) in enumerate(loader):
                prediction=model(seq,char)
                loss=objective(prediction,seq,steps)
                optimizer.zero_grad(set_to_none=True)
                loss.backward()
                nn.utils.clip_grad_norm_(model.parameters(),1.)
                optimizer.step()
                seen+=len(seq);acc+=float(loss)*len(seq);num+=len(seq)
                if (bi+1)%85==0:
                    print(stage,"epoch",epoch+1,"batch",bi+1,"/",len(loader),
                          "seen",seen,"loss",round(float(loss),4),flush=True)
            metrics=evaluate(model,val)
            history.append({"stage":stage,"epoch":epoch+1,
                "train_loss":round(acc/max(1,num),5),**metrics})
            print("EVAL",history[-1],flush=True)
            if math.isfinite(metrics["heldout_nll"]) and metrics["heldout_nll"]<best:
                best=metrics["heldout_nll"]
                metadata["training_presentations"]=seen
                metadata["best_stage"]=stage
                export(model,a.out,metrics,metadata)
    if not Path(a.out).exists():
        raise RuntimeError("No trained generative model checkpoint saved")
    Path("models/stroke-sequence-metrics.json").write_text(json.dumps({
       "history":history,"best":best,"training_presentations":seen,
       "dataset":"UJI Pen Characters v2 writer-disjoint with labeled synthetic math symbols",
       "model":a.out},indent=2))
    print("FINISHED generative stroke sequence training",flush=True)
if __name__=="__main__":main()
