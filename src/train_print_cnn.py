#!/usr/bin/env python3
"""Train INK AI's own printed-character CNN from scratch on locally rendered fonts.
No third-party model weights, external OCR API, or downloaded OCR engine.
Synthetic font holdout evaluates fonts/families not used during training;
this does NOT measure real-world camera OCR accuracy.
"""
import argparse,base64,glob,json,random,string,time
from pathlib import Path
import numpy as np
from PIL import Image,ImageDraw,ImageFont,ImageFilter
import torch
from torch import nn

CHARS=string.digits+string.ascii_uppercase+string.ascii_lowercase
SEED=41173

def available_fonts():
    locations=(
      "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSansCondensed.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf",
      "/usr/share/fonts/truetype/lato/Lato-Regular.ttf",
      "/usr/share/fonts/truetype/lato/Lato-Bold.ttf",
      "/usr/share/fonts/truetype/lato/Lato-Italic.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSerif.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationSerif-Regular.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationSerif-Bold.ttf",
      "/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf",
      "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf",
    )
    found=[f for f in locations if Path(f).is_file()]
    if len(found)<8:
        allfonts=sorted(glob.glob("/usr/share/fonts/**/*.[to]tf",recursive=True))
        found=list(dict.fromkeys(found+allfonts))[:30]
    if len(found)<5:raise RuntimeError("At least 5 system fonts needed for independent evaluation")
    # Hold out whole families, not random images from the same fonts.
    train=[f for f in found if not any(t in f for t in
      ("DejaVuSerif","LiberationSerif","LiberationMono","DejaVuSansMono"))]
    heldout=[f for f in found if f not in train]
    if len(train)<3 or len(heldout)<2:
        rng=random.Random(SEED);rng.shuffle(found)
        train=found[:int(len(found)*.7)];heldout=found[int(len(found)*.7):]
    return train,heldout

def render(char,fontpath,rng,augment):
    size=rng.randrange(35,65) if augment else 54
    font=ImageFont.truetype(fontpath,size)
    image=Image.new("L",(96,96),0)
    draw=ImageDraw.Draw(image)
    bounds=draw.textbbox((0,0),char,font=font,stroke_width=0)
    x=(96-(bounds[2]-bounds[0]))/2-bounds[0]
    y=(96-(bounds[3]-bounds[1]))/2-bounds[1]
    if augment:
        x+=rng.uniform(-2.5,2.5);y+=rng.uniform(-2.5,2.5)
    draw.text((int(x),int(y)),char,fill=255,font=font,
              stroke_width=(rng.choice([0,0,1]) if augment else 0))
    if augment and rng.random()<.65:
        image=image.rotate(rng.uniform(-8,8),resample=Image.Resampling.BICUBIC)
    if augment and rng.random()<.22:
        image=image.filter(ImageFilter.GaussianBlur(rng.uniform(.25,.7)))
    bounds=image.getbbox()
    if not bounds:return np.zeros((32,32),dtype=np.float32)
    im=image.crop(bounds)
    width,height=im.size
    scale=(rng.uniform(23,27) if augment else 26)/max(width,height)
    nw,nh=max(1,round(width*scale)),max(1,round(height*scale))
    im=im.resize((nw,nh),Image.Resampling.BICUBIC)
    x=(32-nw)//2;y=(32-nh)//2
    result=Image.new("L",(32,32),0);result.paste(im,(x,y))
    return (np.asarray(result,dtype=np.float32)/255).copy()

class PrintCNN(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1=nn.Conv2d(1,12,5,padding=2)
        self.c2=nn.Conv2d(12,24,3,padding=1)
        self.c3=nn.Conv2d(24,32,3,padding=1)
        self.f1=nn.Linear(32*4*4,96)
        self.f2=nn.Linear(96,len(CHARS))
    def forward(self,x):
        x=nn.functional.max_pool2d(nn.functional.relu(self.c1(x)),2)
        x=nn.functional.max_pool2d(nn.functional.relu(self.c2(x)),2)
        x=nn.functional.max_pool2d(nn.functional.relu(self.c3(x)),2)
        return self.f2(nn.functional.relu(self.f1(x.flatten(1))))

def sample(fonts,count,augment,seed):
    rng=random.Random(seed)
    x=np.empty((count,1,32,32),dtype=np.float32)
    y=np.empty((count,),dtype=np.int64)
    for i in range(count):
        cls=i%len(CHARS)
        f=fonts[rng.randrange(len(fonts))]
        x[i,0]=render(CHARS[cls],f,rng,augment)
        y[i]=cls
    p=np.random.default_rng(seed).permutation(count)
    return torch.from_numpy(x[p]),torch.from_numpy(y[p])

def pack(layer):
    w=layer.weight.detach().cpu().numpy()
    b=layer.bias.detach().cpu().numpy()
    scale=float(max(1e-8,np.max(np.abs(w))/127))
    q=np.clip(np.round(w/scale),-127,127).astype(np.int8)
    return {"shape":list(w.shape),"scale":scale,
            "weights":base64.b64encode(q.tobytes()).decode(),
            "bias":np.round(b,6).tolist()}

def evaluate(model,x,y):
    model.eval();hit=0
    with torch.no_grad():
        for i in range(0,len(y),256):
            hit+=int((model(x[i:i+256]).argmax(1)==y[i:i+256]).sum())
    return hit/len(y)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--epochs",type=int,default=5)
    ap.add_argument("--samples",type=int,default=24000)
    ap.add_argument("--output",default="models/ink-print-cnn-v1.json")
    ap.add_argument("--metrics",default="models/print-cnn-v1-metrics.json")
    args=ap.parse_args()
    torch.manual_seed(SEED);np.random.seed(SEED);random.seed(SEED)
    torch.set_num_threads(min(4,torch.get_num_threads()))
    train,holdout=available_fonts()
    print("TRAIN FONTS:",*[Path(f).name for f in train],sep="\n  ",flush=True)
    print("HELDOUT FONTS:",*[Path(f).name for f in holdout],sep="\n  ",flush=True)
    xval,yval=sample(holdout,len(CHARS)*max(8,18),False,SEED+100)
    model=PrintCNN()
    opt=torch.optim.AdamW(model.parameters(),lr=.001,weight_decay=.00005)
    history=[]
    for ep in range(1,args.epochs+1):
        tick=time.monotonic()
        x,y=sample(train,args.samples,True,SEED+ep)
        model.train()
        perm=torch.randperm(len(y))
        total=0
        for batch in perm.split(192):
            pred=model(x[batch])
            loss=nn.functional.cross_entropy(pred,y[batch])
            opt.zero_grad(set_to_none=True);loss.backward();opt.step()
            total+=float(loss.detach())*len(batch)
        accuracy=evaluate(model,xval,yval)
        record={"epoch":ep,"synthetic_heldout_font_accuracy":round(accuracy,6),
                "train_loss":round(total/len(y),5),"training_samples":len(y),
                "seconds":round(time.monotonic()-tick,1)}
        history.append(record)
        print("EPOCH",ep,record,flush=True)
    value=evaluate(model,xval,yval)
    metrics={"format":"ink-print-synthetic-benchmark-v1","seed":SEED,
             "trained_from_scratch":True,
             "dataset":"synthetic font renders (NOT real camera photos)",
             "train_font_count":len(train),"heldout_font_count":len(holdout),
             "heldout_characters":len(yval),"heldout_accuracy":round(value,6),
             "real_camera_word_accuracy":None,"real_camera_false_positive_rate":None,
             "epochs":history,"training_samples":args.epochs*args.samples}
    output={"format":"ink-cnn-int8-v1","name":"INK AI printed text CNN V1",
            "labels":list(CHARS),"input":[1,32,32],
            "layers":[pack(getattr(model,k)) for k in ("c1","c2","c3","f1","f2")],
            "training":{"type":"synthetic-font-from-scratch",
              "heldout_accuracy":metrics["heldout_accuracy"],
              "heldout_font_count":len(holdout),
              "real_camera_word_accuracy":None}}
    for path,data in ((args.output,output),(args.metrics,metrics)):
        file=Path(path);file.parent.mkdir(parents=True,exist_ok=True)
        file.write_text(json.dumps(data,separators=(",",":")),encoding="utf8")
        print("WROTE",file,file.stat().st_size,flush=True)

if __name__=="__main__":main()
