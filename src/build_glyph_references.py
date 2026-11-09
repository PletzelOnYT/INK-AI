#!/usr/bin/env python3
"""Build INK AI's own compact library of authentic handwritten glyph shapes.

These are real, individual EMNIST/HASYv2 characters, not blurred averages.
Neural character predictions can be snapped to a similar real handwriting
example, then traced into smooth lines. All sources credited in README.

Only non-pretrained source examples are used. Browser only fetches user's GitHub.
"""
import base64,json,random,sys,datetime
from pathlib import Path
import numpy as np
from PIL import Image
from torchvision.datasets import EMNIST
from train import CHARS,LOOKUP,HandwrittenSymbols,SyntheticPunctuation,SEED

def pack(arr):
    return base64.b64encode(np.packbits(arr.flatten()>90).tobytes()).decode("ascii")

def add(store,char,arr):
    if char not in store:return
    if len(store[char])>=170:return
    image=Image.fromarray(np.asarray(arr,dtype=np.uint8),"L").resize((32,32),Image.Resampling.BILINEAR)
    packed=pack(np.asarray(image,dtype=np.uint8))
    if packed not in store[char]:store[char].append(packed)

def main():
    rng=np.random.default_rng(SEED+317)
    store={c:[] for c in CHARS}
    emnist=EMNIST(".data",split="byclass",train=True,download=True)
    labels=emnist.targets.numpy()
    for i,char in enumerate(CHARS[:62]):
        choices=np.flatnonzero(labels==i)
        selected=rng.choice(choices,min(145,len(choices)),replace=False)
        for n in selected:
            # EMNIST official orientation needs x/y transpose.
            add(store,char,emnist.data[int(n)].T.numpy())
        print(char,len(store[char]),flush=True)
    # Diverse genuinely handwritten math and punctuation, HASYv2 ODbL.
    hasy_count=0
    try:
        h=HandwrittenSymbols(".data")
        for idx in range(len(h.y)):
            label=int(h.y[idx]);char=CHARS[label]
            if len(store[char])<170:
                add(store,char,h.x[idx]);hasy_count+=1
        print("Real HASYv2 handwritten examples incorporated:",hasy_count,flush=True)
    except Exception as e:
        print("HASYv2 missing, retaining EMNIST+synthetic punctuation:",e,flush=True)
    synthetic=SyntheticPunctuation(5000)
    for i in range(len(synthetic)):
        image,label=synthetic[i]
        char=CHARS[label]
        if len(store[char])>=100:continue
        x=(image.squeeze().numpy()*255).astype(np.uint8)
        add(store,char,x)
    out=Path("models/ink-human-glyph-references.json")
    out.parent.mkdir(parents=True,exist_ok=True)
    payload={
        "format":"ink-human-glyph-examples-v1",
        "source":"Genuine EMNIST writer examples, optional HASYv2 handwritten symbols, font punctuation where no real sample",
        "license_attribution":"EMNIST NIST; HASYv2 ODbL 1.0; see README",
        "shape":[32,32],
        "binary_threshold":90,
        "per_class":{k:v for k,v in store.items() if v},
        "total_examples":sum(map(len,store.values())),
        "generated_at":datetime.datetime.now(datetime.timezone.utc).isoformat()
    }
    out.write_text(json.dumps(payload,separators=(",",":"),ensure_ascii=False),encoding="utf8")
    print("Exported",payload["total_examples"],"human/synthetic individual glyph references",out.stat().st_size,"bytes",flush=True)

if __name__=="__main__":main()
