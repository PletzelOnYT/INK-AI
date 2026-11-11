#!/usr/bin/env python3
"""Train INK AI's own scene-text/background CNN from scratch.

No pretrained model, OCR engine, external image dataset, API or remote weights.
Training uses generated text and hard-negative shapes. Validation holds out
entire font families and independently generated clutter. Synthetic benchmark
accuracy is NOT a real-webcam score.
"""
import argparse,base64,glob,json,math,random,time
from pathlib import Path
import numpy as np
import torch
from torch import nn
from PIL import Image,ImageDraw,ImageFont,ImageFilter

ROOT=Path(__file__).resolve().parents[1]
W,H=64,24
SEED=251910
torch.set_num_threads(min(4,torch.get_num_threads()))
class TextnessCNN(nn.Module):
 def __init__(self):
  super().__init__()
  self.c1=nn.Conv2d(1,8,3,padding=1)
  self.c2=nn.Conv2d(8,16,3,padding=1)
  self.c3=nn.Conv2d(16,24,3,padding=1)
  self.f1=nn.Linear(24*3*8,32)
  self.f2=nn.Linear(32,2)
 def forward(self,x):
  x=nn.functional.max_pool2d(nn.functional.relu(self.c1(x)),2)
  x=nn.functional.max_pool2d(nn.functional.relu(self.c2(x)),2)
  x=nn.functional.max_pool2d(nn.functional.relu(self.c3(x)),2)
  return self.f2(nn.functional.relu(self.f1(x.flatten(1))))

def fonts():
 paths=sorted(set(glob.glob("/usr/share/fonts/truetype/**/*.[ot]tf",recursive=True)))
 paths=[p for p in paths if Path(p).is_file()]
 hold=[p for p in paths if any(s in p for s in ("DejaVuSerif","LiberationSerif","DejaVuSansMono"))]
 train=[p for p in paths if p not in hold]
 if len(train)<4 or len(hold)<2:raise RuntimeError("Need separate training and held-out system font families")
 return train,hold

def render(label,font_paths,words,rng):
 large=Image.new("L",(192,72),0)
 p=ImageDraw.Draw(large)
 darkness=rng.randrange(35,215)
 # Gradient scenes, bright-on-dark as well as dark-on-light.
 background= rng.choice([darkness,255-darkness,20,50,85,130,185,235])
 foreground=255-background if rng.random()<.5 else (0 if background>112 else 255)
 large.paste(background,(0,0,192,72))
 if label:
  txt=rng.choice(words)
  font=rng.choice(font_paths)
  size=rng.randint(28,45)
  f=ImageFont.truetype(font,size)
  bounds=p.textbbox((0,0),txt,font=f)
  tw=bounds[2]-bounds[0];th=bounds[3]-bounds[1]
  if tw>176:
   f=ImageFont.truetype(font,max(12,int(size*175/tw)))
   bounds=p.textbbox((0,0),txt,font=f);tw=bounds[2]-bounds[0];th=bounds[3]-bounds[1]
  x=(192-tw)//2-bounds[0]+rng.randint(-4,4)
  y=(72-th)//2-bounds[1]+rng.randint(-3,3)
  p.text((x,y),txt,fill=foreground,font=f)
  if rng.random()<.50:
   large=large.rotate(rng.uniform(-14,14),resample=Image.Resampling.BILINEAR,fillcolor=background)
 else:
  # Hard negatives model shelf edges, cabinet seams, wires, round objects,
  # specular reflections and fragmented glyph-like shapes.
  for _ in range(rng.randint(4,26)):
   x0,y0=rng.randrange(192),rng.randrange(72)
   x1,y1=rng.randrange(192),rng.randrange(72)
   color=rng.choice([foreground,background,rng.randrange(256)])
   kind=rng.randrange(6);width=rng.randint(1,8)
   if kind==0:p.line((x0,y0,x0+rng.randint(-2,2),y1),fill=color,width=width)
   elif kind==1:p.line((x0,y0,x1,y0+rng.randint(-3,3)),fill=color,width=width)
   elif kind==2:p.line((x0,y0,x1,y1),fill=color,width=width)
   elif kind==3:p.rectangle((min(x0,x1),min(y0,y1),max(x0,x1),max(y0,y1)),outline=color,width=width)
   elif kind==4:p.ellipse((min(x0,x1),min(y0,y1),max(x0,x1),max(y0,y1)),outline=color,width=width)
   else:p.arc((min(x0,x1),min(y0,y1),max(x0,x1),max(y0,y1)),0,230,fill=color,width=width)
  if rng.random()<.6:
   # Dense parallel shelves are a frequent OCR false positive.
   x=rng.randrange(192)
   for i in range(rng.randint(3,9)):
    y=rng.randint(0,72)
    p.line((x,y,max(0,min(191,x+rng.randint(30,160))),y+rng.randint(-3,3)),
           fill=foreground,width=rng.randint(1,3))
 if rng.random()<.20:
  large=large.filter(ImageFilter.GaussianBlur(rng.uniform(.2,1.1)))
 output=large.resize((W,H),Image.Resampling.BILINEAR)
 a=np.asarray(output,dtype=np.float32)/255
 if rng.random()<.60:
  noise=np.random.default_rng(rng.randrange(2**31)).normal(0,rng.uniform(.002,.07),a.shape)
  a=np.clip(a+noise,0,1)
 return a.astype(np.float32)

def batch(fonts,words,count,seed):
 rng=random.Random(seed)
 x=np.empty((count,1,H,W),dtype=np.float32)
 y=np.empty(count,dtype=np.int64)
 for i in range(count):
  label=i%2;y[i]=label;x[i,0]=render(label,fonts,words,rng)
 perm=np.random.default_rng(seed).permutation(count)
 return torch.from_numpy(x[perm]),torch.from_numpy(y[perm])

def pack(layer):
 weights=layer.weight.detach().numpy()
 bias=layer.bias.detach().numpy()
 scale=float(max(1e-8,np.max(np.abs(weights))/127))
 quant=np.clip(np.round(weights/scale),-127,127).astype(np.int8)
 return {"shape":list(weights.shape),"scale":scale,
         "weights":base64.b64encode(quant.tobytes()).decode(),
         "bias":np.round(bias,6).tolist()}

def evaluate(model,x,y):
 model.eval();pred=[]
 with torch.no_grad():
  for a in range(0,len(y),192):
   pred.append(model(x[a:a+192]).softmax(-1)[:,1])
 p=torch.cat(pred)
 recall=float((p[y==1]>.88).float().mean())
 false_rate=float((p[y==0]>.88).float().mean())
 accuracy=float(((p>.88)==(y==1)).float().mean())
 return {"heldout_text_recall":round(recall,5),
         "heldout_clutter_false_positive_rate":round(false_rate,5),
         "heldout_accuracy":round(accuracy,5),
         "decision_threshold":.88}

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--epochs",type=int,default=6)
 parser.add_argument("--samples",type=int,default=10000)
 args=parser.parse_args()
 torch.manual_seed(SEED);np.random.seed(SEED);random.seed(SEED)
 train,hold=fonts()
 words=[s.strip().lower() for s in (ROOT/"data/english-words.txt").read_text().splitlines()]
 words=[w for w in words if w.isalpha() and 3<=len(w)<=12]
 words+=["chromebook","november","thank","sunday","tuesday","laptop"]
 xv,yv=batch(hold,words,3000,SEED+40)
 net=TextnessCNN();opt=torch.optim.AdamW(net.parameters(),lr=.001)
 history=[]
 for ep in range(args.epochs):
  start=time.monotonic()
  x,y=batch(train,words,args.samples,SEED+ep)
  net.train()
  for inds in torch.randperm(len(y)).split(128):
   logits=net(x[inds]);loss=nn.functional.cross_entropy(logits,y[inds])
   opt.zero_grad(set_to_none=True);loss.backward();opt.step()
  result=evaluate(net,xv,yv)
  result["epoch"]=ep+1;result["seconds"]=round(time.monotonic()-start,1)
  history.append(result);print(result,flush=True)
 metric=evaluate(net,xv,yv)
 # Publication gate measures SYNTHETIC behavior only. Real camera FPR is unknown.
 eligible=metric["heldout_text_recall"]>=.88 and metric["heldout_clutter_false_positive_rate"]<=.035
 metric.update({"format":"ink-textness-benchmark-v1",
   "dataset":"generated font regions + generated hard negatives",
   "trained_from_scratch":True,"heldout_font_count":len(hold),
   "real_camera_accuracy":None,"real_camera_false_positive_rate":None,
   "training_examples":args.epochs*args.samples,"validation_examples":len(yv),
   "publishable_synthetic":eligible,"epochs":history})
 payload={"format":"ink-textness-cnn-int8-v1","input":[1,H,W],
  "layers":[pack(getattr(net,k)) for k in ("c1","c2","c3","f1","f2")],
  "training":{"synthetic_text_recall":metric["heldout_text_recall"],
    "synthetic_clutter_fpr":metric["heldout_clutter_false_positive_rate"],
    "heldout_font_count":len(hold),"eligible":eligible,"real_camera_accuracy":None}}
 for path,data in ((ROOT/"models/ink-camera-textness-v1.json",payload),
                   (ROOT/"models/camera-textness-v1-metrics.json",metric)):
  path.parent.mkdir(exist_ok=True)
  path.write_text(json.dumps(data,separators=(",",":")),encoding="utf8")
  print("WROTE",path,path.stat().st_size,flush=True)
 if not eligible:raise SystemExit("Synthetic textness acceptance gate did not pass")

if __name__=="__main__":main()
