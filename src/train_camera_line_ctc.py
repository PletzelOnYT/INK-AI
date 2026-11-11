#!/usr/bin/env python3
"""INK AI native printed-line OCR (CNN+bidirectional GRU+CTC).
Training from scratch on locally rendered fonts, never third-party checkpoints.
Evaluation uses font families withheld entirely from training.
This is a synthetic benchmark, NOT a real-camera accuracy estimate.
"""
import argparse
import base64
import glob
import json
import math
import random
import string
import time
from pathlib import Path

import numpy as np
import torch
from torch import nn
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parents[1]
SEED = 20871
CHARS = " " + string.ascii_uppercase + string.ascii_lowercase + string.digits + ".,:-/'"
LABELS = [""] + list(CHARS)
TOKEN = {c: i + 1 for i, c in enumerate(CHARS)}
W, H = 256, 32

class LineOCR(nn.Module):
    def __init__(self):
        super().__init__()
        self.c1 = nn.Conv2d(1, 12, 3, stride=(2, 2), padding=1)
        self.c2 = nn.Conv2d(12, 24, 3, stride=(2, 2), padding=1)
        self.c3 = nn.Conv2d(24, 40, 3, stride=(2, 1), padding=1)
        self.c4 = nn.Conv2d(40, 64, 3, stride=(2, 1), padding=1)
        self.gru = nn.GRU(64, 64, bidirectional=True, batch_first=True)
        self.out = nn.Linear(128, len(LABELS))

    def forward(self, x):
        for layer in (self.c1, self.c2, self.c3, self.c4):
            x = torch.relu(layer(x))
        x = x.mean(2).transpose(1, 2)
        x, _ = self.gru(x)
        return self.out(x).log_softmax(-1).transpose(0, 1)

def fonts():
    candidates = sorted(set(glob.glob("/usr/share/fonts/**/*.[to]tf", recursive=True)))
    fonts = [f for f in candidates if Path(f).is_file()]
    held = [f for f in fonts if any(z in f for z in (
        "DejaVuSerif", "LiberationSerif", "LiberationMono", "DejaVuSansMono"))]
    train = [f for f in fonts if f not in held]
    if len(train) < 4 or len(held) < 2:
        raise RuntimeError("Separate font families are required for evaluation")
    return train, held

def words():
    raw = (ROOT / "data/english-words.txt").read_text(encoding="utf8").splitlines()
    collection = [s.strip() for s in raw if s.strip().isalpha() and 2 <= len(s.strip()) <= 13]
    collection.extend(["NY", "THREADS", "Chromebook", "Torrey", "Pines", "High",
      "School", "San", "Diego", "November", "RECEIVED", "FROM", "Printed"])
    return collection

def label(rng, corpus):
    if rng.random() < .045:
        return ""
    parts = []
    for _ in range(rng.choices([1,2,3], weights=[50,36,14])[0]):
        if rng.random() < .18:
            p = ''.join(rng.choices(string.ascii_uppercase + string.digits,
                                    k=rng.randint(2, 9)))
        else:
            p = rng.choice(corpus)
            mode = rng.randrange(6)
            if mode == 0:
                p = p.upper()
            elif mode == 1:
                p = p.title()
            elif mode == 2:
                p = p.lower()
        parts.append(p)
    return ' '.join(parts)[:28].strip()

def draw(text, font_files, rng, augment):
    picture = Image.new("L", (520, 100), 0)
    if text:
        fontpath = rng.choice(font_files)
        size = rng.randint(30, 52) if augment else 42
        font = ImageFont.truetype(fontpath, size)
        d = ImageDraw.Draw(picture)
        box = d.textbbox((0, 0), text, font=font)
        tw, th = box[2]-box[0], box[3]-box[1]
        if tw > 490:
            size = max(14, round(size*490/tw))
            font = ImageFont.truetype(fontpath, size)
            box = d.textbbox((0, 0), text, font=font)
            tw, th = box[2]-box[0], box[3]-box[1]
        d.text(((520-tw)//2-box[0], (100-th)//2-box[1]),
               text, font=font, fill=255)
        if augment and rng.random() < .55:
            picture = picture.rotate(rng.uniform(-10,10),
                          resample=Image.Resampling.BICUBIC, fillcolor=0)
        bounds = picture.getbbox()
        if bounds:
            picture = picture.crop(bounds)
    else:
        picture = Image.new("L", (100, 40), 0)
        # Blank or geometric clutter is a legitimate CTC blank target.
        d = ImageDraw.Draw(picture)
        for _ in range(rng.randrange(0, 5)):
            x0, y0 = rng.randrange(100), rng.randrange(40)
            x1, y1 = rng.randrange(100), rng.randrange(40)
            d.line((x0, y0, x1, y1), fill=rng.randint(80,170),
                   width=rng.randint(1, 3))
    iw, ih = picture.size
    scale = min(247/max(1,iw), 26/max(1,ih))
    if augment:
        scale *= rng.uniform(.78, 1.0)
    nw = max(1, min(252, round(iw*scale)))
    nh = max(1, min(30, round(ih*scale)))
    picture = picture.resize((nw,nh), Image.Resampling.BICUBIC)
    canvas = Image.new("L", (W,H),0)
    x = (W-nw)//2
    y = (H-nh)//2
    if augment:
        x = max(0, min(W-nw, x+rng.randint(-5,5)))
        y = max(0, min(H-nh, y+rng.randint(-2,2)))
    canvas.paste(picture, (x,y))
    if augment and rng.random() < .34:
        canvas = canvas.filter(ImageFilter.GaussianBlur(rng.uniform(.15,.65)))
    pixels = np.asarray(canvas, dtype=np.float32)/255.0
    if augment and rng.random() < .38:
        noise = np.random.default_rng(rng.randrange(2**31)).normal(
            0, rng.uniform(.003,.045), pixels.shape)
        pixels = np.clip(pixels + noise, 0, 1)
    return pixels.astype(np.float32)

def create_batch(fonts, corpus, count, rng, augment):
    images = np.zeros((count,1,H,W), dtype=np.float32)
    tokens = []
    target_lengths = []
    labels = []
    for i in range(count):
        text = label(rng, corpus)
        images[i,0] = draw(text,fonts,rng,augment)
        labels.append(text)
        tokens.extend(TOKEN[ch] for ch in text)
        target_lengths.append(len(text))
    target = torch.tensor(tokens, dtype=torch.long)
    return (torch.from_numpy(images), target,
            torch.tensor(target_lengths,dtype=torch.long),labels)

def unpack_ctc(logits):
    result=[]
    for item in logits.argmax(-1).transpose(0,1).tolist():
        previous=0
        chars=[]
        for cls in item:
            if cls != previous and cls > 0:
                chars.append(LABELS[cls])
            previous=cls
        result.append("".join(chars).strip())
    return result

def edit_distance(a,b):
    prev=list(range(len(b)+1))
    for i,ca in enumerate(a,1):
        cur=[i]+[0]*len(b)
        for j,cb in enumerate(b,1):
            cur[j]=min(cur[j-1]+1,prev[j]+1,prev[j-1]+(ca!=cb))
        prev=cur
    return prev[-1]

def evaluate(net,fonts,corpus,count,seed):
    net.eval()
    rng=random.Random(seed)
    errors,total,exact=0,0,0
    # Count using a distinct sample counter so character length cannot skew it.
    samples=0
    with torch.no_grad():
        while samples<count:
            n=min(64,count-samples)
            x,_,_,labels=create_batch(fonts,corpus,n,rng,False)
            results=unpack_ctc(net(x))
            for pred,truth in zip(results,labels):
                errors+=edit_distance(pred,truth)
                total+=max(1,len(truth))
                exact+=int(pred==truth)
            samples+=n
    return {"heldout_character_error_rate":round(errors/max(1,total),6),
            "heldout_exact_line_accuracy":round(exact/count,6),
            "validation_lines":count}

def pack(layer):
    values=layer.detach().cpu().numpy()
    scale=float(max(1e-8,np.max(np.abs(values))/127))
    quant=np.clip(np.round(values/scale),-127,127).astype(np.int8)
    return {"shape":list(values.shape),"scale":scale,
            "weights":base64.b64encode(quant.tobytes()).decode("ascii")}

def layer_pair(layer):
    return {"weight":pack(layer.weight), "bias":layer.bias.detach().tolist()}

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--epochs",type=int,default=9)
    ap.add_argument("--samples",type=int,default=14000)
    args=ap.parse_args()
    torch.manual_seed(SEED);np.random.seed(SEED);random.seed(SEED)
    torch.set_num_threads(min(4,torch.get_num_threads()))
    train,held=fonts()
    corpus=words()
    net=LineOCR()
    optimizer=torch.optim.AdamW(net.parameters(),lr=.0012,weight_decay=.00002)
    ctc=nn.CTCLoss(blank=0,zero_infinity=True)
    history=[]
    for epoch in range(1,args.epochs+1):
        started=time.monotonic()
        net.train()
        rng=random.Random(SEED+epoch)
        total_loss=0
        for position in range(0,args.samples,64):
            n=min(64,args.samples-position)
            x,y,lengths,_=create_batch(train,corpus,n,rng,True)
            logits=net(x)
            loss=ctc(logits,y,
                     torch.full((n,),logits.shape[0],dtype=torch.long),lengths)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(net.parameters(),5.0)
            optimizer.step()
            total_loss+=float(loss.detach())*n
        if epoch in (4,7,args.epochs):
            val=evaluate(net,held,corpus,800,SEED+200)
        else:
            val={}
        row={"epoch":epoch,"loss":round(total_loss/args.samples,5),
             "seconds":round(time.monotonic()-started,1),**val}
        history.append(row)
        print("EPOCH",row,flush=True)
    metrics=evaluate(net,held,corpus,1200,SEED+300)
    eligible=(metrics["heldout_character_error_rate"]<.48 and
              metrics["heldout_exact_line_accuracy"]>.16)
    metrics.update({"model":"ink-native-line-ctc-v1",
     "trained_from_scratch":True,"dataset":"synthetic printed lines from system fonts",
     "train_font_count":len(train),"heldout_font_count":len(held),
     "real_camera_word_accuracy":None,"trained_lines":args.epochs*args.samples,
     "eligible":eligible,"epochs":history})
    payload={"format":"ink-line-ctc-v1","input":[1,H,W],
     "labels":LABELS,"convolutions":[layer_pair(getattr(net,k))
                                   for k in ("c1","c2","c3","c4")],
     "rnn":{k:pack(v) for k,v in net.gru.named_parameters()},
     "out":layer_pair(net.out),
     "training":{"eligible":eligible,"heldout_font_count":len(held),
     "heldout_cer":metrics["heldout_character_error_rate"],
     "heldout_exact":metrics["heldout_exact_line_accuracy"],
     "real_camera_word_accuracy":None}}
    for path,data in ((ROOT/"models/ink-native-line-ctc-v1.json",payload),
                      (ROOT/"models/native-line-ctc-v1-metrics.json",metrics)):
        path.write_text(json.dumps(data,separators=(",",":")),encoding="utf8")
        print("SAVED",path,path.stat().st_size,flush=True)
    if not eligible:
        raise SystemExit("Independent synthetic line OCR benchmark did not pass")

if __name__=="__main__":
    main()
