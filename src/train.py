#!/usr/bin/env python3
"""INK AI training. Trains YOUR OWN CNN from scratch; never loads external model weights.

Training inputs: official NIST EMNIST ByClass (real writers); optionally HASYv2
(real mathematical symbols, ODbL). Random affine augmentation creates additional
training presentations; it does not create new independent human writers.
"""
import argparse, csv, hashlib, io, json, os, random, string, tarfile, time, urllib.request
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
import torch
from torch import nn
from torch.utils.data import DataLoader, Dataset
from torchvision.datasets import EMNIST
from torchvision.transforms import RandomAffine, InterpolationMode
from torchvision.transforms import functional as TF

SEED = 24008
CHARS = string.digits + string.ascii_uppercase + string.ascii_lowercase + string.punctuation + "×÷±∞√≠≤≥"
assert len(CHARS) == len(set(CHARS))
LOOKUP = {c:i for i,c in enumerate(CHARS)}
HASY_MAP = {
    r"\times":"×",r"\div":"÷",r"\pm":"±",r"\infty":"∞",
    r"\sqrt{}":"√",r"\neq":"≠",r"\leq":"≤",r"\geq":"≥",
    r"\ast":"*",r"\mid":"|",r"\backslash":"\\",
    r"\#":"#",r"\$":"$",r"\%":"%",r"\&":"&",
    r"\{":"{",r"\}":"}",r"\colon":":",
}
HASY_URL = "https://zenodo.org/records/259444/files/HASYv2.tar.bz2?download=1"
HASY_MD5 = "fddf23f36e24b5236f6b3a0880c778e3"

class InkNet(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1,12,5,padding=2)
        self.c2 = nn.Conv2d(12,24,3,padding=1)
        self.c3 = nn.Conv2d(24,32,3,padding=1)
        self.f1 = nn.Linear(32*4*4,96)
        self.f2 = nn.Linear(96,len(CHARS))
        self.pool = nn.MaxPool2d(2)
    def forward(self,x):
        x = self.pool(torch.relu(self.c1(x)))
        x = self.pool(torch.relu(self.c2(x)))
        x = self.pool(torch.relu(self.c3(x)))
        x = torch.relu(self.f1(torch.flatten(x,1)))
        return self.f2(x)

AUG = RandomAffine(
    degrees=13,translate=(.085,.09),scale=(.82,1.13),shear=(-12,12),
    interpolation=InterpolationMode.BILINEAR,fill=0
)

class RealChars(Dataset):
    def __init__(self, emnist, augment=True):
        # NIST source bytes are transposed. PIL/rendering canvas is upright.
        self.images = emnist.data
        self.labels = emnist.targets.long()
        self.augment=augment
    def __len__(self): return len(self.labels)
    def __getitem__(self,i):
        a = self.images[i].T.contiguous().numpy()
        im = Image.fromarray(a,"L").resize((32,32),Image.Resampling.BILINEAR)
        x=TF.to_tensor(im)
        if self.augment: x=AUG(x)
        return x,int(self.labels[i])

class HandwrittenSymbols(Dataset):
    def __init__(self, root, limit=0):
        root=Path(root);root.mkdir(parents=True,exist_ok=True)
        archive=root/"HASYv2.tar.bz2"
        if not archive.exists():
            print("Downloading HASYv2 from Zenodo; only the training job downloads it.",flush=True)
            urllib.request.urlretrieve(HASY_URL,archive)
        digest=hashlib.md5(archive.read_bytes()).hexdigest()
        if digest != HASY_MD5: raise RuntimeError(f"HASYv2 checksum mismatch: {digest}")
        self.x=[];self.y=[]
        with tarfile.open(archive,"r:bz2") as tar:
            csv_member=next(x for x in tar.getmembers() if x.name.endswith("hasy-data-labels.csv"))
            rows=csv.DictReader(io.TextIOWrapper(tar.extractfile(csv_member),encoding="utf-8"))
            meta={}
            for row in rows:
                sym=row["latex"].strip()
                sym=HASY_MAP.get(sym,sym)
                if sym in LOOKUP: meta[os.path.basename(row["path"])]=LOOKUP[sym]
            for member in tar:
                if not member.isfile() or not member.name.lower().endswith(".png"): continue
                label=meta.get(os.path.basename(member.name))
                if label is None: continue
                data=tar.extractfile(member).read()
                im=Image.open(io.BytesIO(data)).convert("L").resize((32,32))
                a=255-np.asarray(im,dtype=np.uint8)
                self.x.append(a.copy());self.y.append(label)
                if limit and len(self.y)>=limit: break
        self.x=np.array(self.x,dtype=np.uint8);self.y=np.array(self.y,dtype=np.int64)
        print(f"HASYv2 usable real handwritten glyphs: {len(self.y):,}",flush=True)
    def __len__(self):return len(self.y)
    def __getitem__(self,i):
        x=torch.from_numpy(self.x[i].copy()).float().unsqueeze(0)/255
        return AUG(x),int(self.y[i])

class SyntheticPunctuation(Dataset):
    """Supplement symbols missing from NIST/HASY. Synthetic != real handwriting."""
    def __init__(self,n=25000):
        self.n=n
        self.symbols=string.punctuation+"×÷±∞√≠≤≥"
        self.fonts=[p for p in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
            "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
        ) if Path(p).exists()]
        if not self.fonts: raise RuntimeError("System truetype fonts not found")
    def __len__(self):return self.n
    def __getitem__(self,i):
        rng=random.Random(i+SEED)
        char=self.symbols[i%len(self.symbols)]
        font=ImageFont.truetype(rng.choice(self.fonts),rng.randrange(32,50))
        im=Image.new("L",(64,64),0)
        d=ImageDraw.Draw(im)
        bb=d.textbbox((0,0),char,font=font)
        x=(64-(bb[2]-bb[0]))/2-bb[0]
        y=(64-(bb[3]-bb[1]))/2-bb[1]
        d.text((x,y),char,font=font,fill=255,stroke_width=rng.randrange(2))
        box=im.getbbox()
        if box:
            cropped=im.crop(box)
            w,h=cropped.size
            scale=25/max(w,h);w=max(1,round(w*scale));h=max(1,round(h*scale))
            im=Image.new("L",(32,32),0)
            im.paste(cropped.resize((w,h),Image.Resampling.BICUBIC),((32-w)//2,(32-h)//2))
        x=TF.to_tensor(im)
        return AUG(x),LOOKUP[char]

class Mixed(Dataset):
    def __init__(self, parts):
        self.parts=parts
        self.lens=[len(p) for p in parts]
        self.cum=np.cumsum(self.lens)
    def __len__(self):return int(self.cum[-1])
    def __getitem__(self,i):
        ix=int(np.searchsorted(self.cum,i,side="right"))
        off=0 if ix==0 else int(self.cum[ix-1])
        return self.parts[ix][i-off]

def compressed_layer(layer):
    w=layer.weight.detach().cpu().numpy()
    b=layer.bias.detach().cpu().numpy()
    scale=float(max(1e-8,np.max(np.abs(w))/127))
    q=np.clip(np.round(w/scale),-127,127).astype(np.int8)
    import base64
    return {"shape":list(w.shape),"scale":scale,
            "weights":base64.b64encode(q.tobytes()).decode("ascii"),
            "bias":np.round(b,6).tolist()}

def export(model,output,train_seen,hasy_count,accuracy,epochs):
    import datetime
    obj={
      "format":"ink-cnn-int8-v1","name":"INK AI independently trained CNN",
      "labels":list(CHARS),"input":[1,32,32],
      "layers":[compressed_layer(getattr(model,x)) for x in ("c1","c2","c3","f1","f2")],
      "training":{"real_emnist_train":697932,"real_hasy_selected":hasy_count,
          "synthetic_punctuation_per_epoch":25000,
          "training_presentations":train_seen,"epochs":epochs,
          "emnist_test_accuracy":round(accuracy,5),
          "data":"EMNIST ByClass and optionally HASYv2; no pretrained model",
          "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
    }
    p=Path(output);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(obj,separators=(",",":")),encoding="utf8")
    print(f"Published {p} ({p.stat().st_size:,} bytes), test accuracy {accuracy:.3%}",flush=True)
    return obj

def main():
    a=argparse.ArgumentParser()
    a.add_argument("--epochs",type=int,default=4)
    a.add_argument("--batch",type=int,default=256)
    a.add_argument("--output",default="models/ink-cnn-v1.json")
    a.add_argument("--data",default=".data")
    a.add_argument("--hasy",action="store_true")
    a.add_argument("--quick",action="store_true",help="Smoke test using small subsets; not release quality")
    a=a.parse_args()
    random.seed(SEED);np.random.seed(SEED);torch.manual_seed(SEED);torch.set_num_threads(4)
    print("Training FROM SCRATCH, labels:",CHARS,flush=True)
    train=EMNIST(a.data,split="byclass",train=True,download=True)
    test=EMNIST(a.data,split="byclass",train=False,download=True)
    em=RealChars(train)
    if a.quick: em=torch.utils.data.Subset(em,range(6000))
    parts=[em];hasy_count=0
    if a.hasy:
        try:
            h=HandwrittenSymbols(a.data)
            hasy_count=len(h)
            if hasy_count:parts.append(h)
        except Exception as e:
            print(f"WARNING: HASY unavailable; training without it: {e}",flush=True)
    parts.append(SyntheticPunctuation(25000 if not a.quick else 2000))
    dataset=Mixed(parts)
    loader=DataLoader(dataset,batch_size=a.batch,shuffle=True,num_workers=2,pin_memory=False)
    model=InkNet()
    optim=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.0001)
    best=-1.;seen=0
    testdata=RealChars(test,augment=False)
    if a.quick: testdata=torch.utils.data.Subset(testdata,range(1000))
    val=DataLoader(testdata,batch_size=512,num_workers=2)
    for epoch in range(a.epochs):
        start=time.monotonic();model.train();loss_total=0.
        for bi,(x,y) in enumerate(loader):
            optim.zero_grad(set_to_none=True)
            out=model(x)
            loss=nn.functional.cross_entropy(out,y)
            loss.backward()
            optim.step()
            loss_total+=float(loss)*len(y);seen+=len(y)
            if (bi+1)%500==0:print(f"epoch={epoch+1} batches={bi+1}/{len(loader)} seen={seen:,}",flush=True)
        model.eval();correct=total=0
        with torch.inference_mode():
            for x,y in val:
                p=model(x).argmax(1);correct+=int((p==y).sum());total+=len(y)
        acc=correct/max(1,total)
        print(f"epoch {epoch+1}/{a.epochs} loss {loss_total/len(dataset):.4f} EMNIST accuracy {acc:.3%}, {time.monotonic()-start:.1f}s",flush=True)
        if acc>best:
            best=acc
            export(model,a.output,seen,hasy_count,acc,epoch+1)
    # Save metrics to repository. Raw images intentionally aren't committed.
    Path("models").mkdir(exist_ok=True)
    Path("models/metrics.json").write_text(json.dumps(
        {"test_accuracy":best,"training_presentations":seen,
         "emnist_training_images":len(em),"hasy_selected":hasy_count,
         "model":"models/ink-cnn-v1.json"},indent=2),encoding="utf8")
    print("Completed",seen,"training presentations.",flush=True)

if __name__=="__main__": main()
