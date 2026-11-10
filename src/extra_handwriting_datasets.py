#!/usr/bin/env python3
"""Additional genuine handwriting sources for INK AI.

HASYv2 (Thoma, 2017, ODbL) contributes real characters/math symbols.
UCI PenDigits (Alpaydin & Alimoglu, 1996, CC BY 4.0) contributes
writer-disjoint sampled pen trajectories for digits 0-9.

No fonts, image-search results, unlicensed scrapes or pretrained models.
Downloads are used only inside training; no dataset is embedded in the app.
"""
from __future__ import annotations
import csv
import hashlib
import io
import os
from pathlib import Path
import random
import tarfile
import urllib.request
import zipfile

import numpy as np
from PIL import Image
import torch
from torch.utils.data import Dataset
from torchvision.transforms import RandomAffine, InterpolationMode
from torchvision.transforms import functional as TF

from train import CHARS, LOOKUP, HASY_MAP, HASY_URL, HASY_MD5, SEED
from train_recognition_v3 import render_pen

PENDIGITS_URL = (
 "https://archive.ics.uci.edu/static/public/81/"
 "pen%2Bbased%2Brecognition%2Bof%2Bhandwritten%2Bdigits.zip"
)
PENDIGITS_TRAIN = 7494
PENDIGITS_TEST = 3498
HASY_MIN_REAL = 1500

def fetch_archive(url, path, expected_md5=None):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    if not path.exists():
        part=path.with_suffix(path.suffix+".partial")
        try:
            with urllib.request.urlopen(url,timeout=90) as response, part.open("wb") as out:
                while True:
                    chunk=response.read(1<<20)
                    if not chunk:break
                    out.write(chunk)
            part.replace(path)
        finally:part.unlink(missing_ok=True)
    if expected_md5:
        h=hashlib.md5()
        with path.open("rb") as source:
            for chunk in iter(lambda:source.read(1<<20),b""):h.update(chunk)
        if h.hexdigest()!=expected_md5:
            raise ValueError("Dataset checksum mismatch for "+str(path))
    return path

def heldout_writer(user_id):
    # Split by *user*, never by image; stable across Python processes.
    # Blank / anonymous IDs are excluded to avoid accidental leakage.
    ident=str(user_id).strip()
    if ident in ("","nan","None","-1"):return None
    digest=hashlib.sha256(("INK-AI-HASY-V4/"+ident).encode()).digest()
    return digest[0]<51

class HASYLetters(Dataset):
    """Subset of actual HASY images with user-separated train/validation."""
    def __init__(self,root,split="train",augment=False):
        if split not in ("train","validation"):raise ValueError(split)
        path=fetch_archive(HASY_URL,Path(root)/"HASYv2.tar.bz2",HASY_MD5)
        self.augment=augment
        labels={}
        with tarfile.open(path,"r:bz2") as tar:
            members=tar.getmembers()
            csv_info=next((m for m in members if m.isfile()
                 and m.name.endswith("hasy-data-labels.csv")),None)
            if csv_info is None:raise ValueError("HASY labels CSV missing")
            reader=csv.DictReader(io.TextIOWrapper(tar.extractfile(csv_info),
                                            encoding="utf-8-sig"))
            for row in reader:
                ch=HASY_MAP.get(row["latex"].strip(),row["latex"].strip())
                if ch not in LOOKUP:continue
                heldout=heldout_writer(row.get("user_id",""))
                if heldout is None:continue
                if (split=="validation")!=heldout:continue
                labels[os.path.basename(row["path"])]=LOOKUP[ch]
            images=[];targets=[]
            for member in members:
                if not member.isfile() or not member.name.endswith(".png"):continue
                label=labels.get(os.path.basename(member.name))
                if label is None:continue
                data=tar.extractfile(member).read()
                im=Image.open(io.BytesIO(data)).convert("L").resize((32,32))
                images.append(255-np.asarray(im,dtype=np.uint8))
                targets.append(label)
        if not images:
            raise RuntimeError("HASY contains no matched "+split+" glyphs")
        self.images=np.stack(images,axis=0).astype(np.uint8)
        self.targets=np.asarray(targets,dtype=np.int64)
        print("HASY",split,len(self.targets),"classes",
              len(set(self.targets.tolist())),flush=True)
    def __len__(self):return len(self.targets)
    def __getitem__(self,i):
        x=torch.from_numpy(self.images[i].copy()).float().unsqueeze(0)/255.
        if self.augment:
            # Small pen-width perturbation; no synthetic font generation.
            if random.random()<.25:
                x=torch.nn.functional.max_pool2d(
                    x.unsqueeze(0),kernel_size=3,stride=1,padding=1)[0]
            if random.random()<.60:
                x=RandomAffine(9,translate=(.06,.06),scale=(.90,1.09),
                    shear=(-5,5),interpolation=InterpolationMode.BILINEAR,
                    fill=0)(x)
        return x,int(self.targets[i])

class PenDigits(Dataset):
    """Official UCI train/test split contains disjoint handwriting writers."""
    def __init__(self,root,split="train",augment=False):
        if split not in ("train","test"):raise ValueError(split)
        path=fetch_archive(PENDIGITS_URL,Path(root)/"pendigits-uci.zip")
        name="pendigits.tra" if split=="train" else "pendigits.tes"
        with zipfile.ZipFile(path) as archive:
            found=[p for p in archive.namelist() if Path(p).name==name]
            if len(found)!=1:raise ValueError("Missing UCI "+name)
            records=list(csv.reader(io.TextIOWrapper(
                archive.open(found[0]),encoding="ascii")))
        expected=PENDIGITS_TRAIN if split=="train" else PENDIGITS_TEST
        if len(records)!=expected:
            raise ValueError("UCI writer split size changed: "+
                 str(len(records))+" expected "+str(expected))
        coordinates=[];targets=[]
        for row in records:
            if len(row)!=17:raise ValueError("Expected 16 coordinates and label")
            nums=[int(s.strip()) for s in row]
            if not all(0<=x<=100 for x in nums[:16]) or nums[-1] not in range(10):
                raise ValueError("Invalid PenDigits row")
            coordinates.append(np.asarray(nums[:16],dtype=np.float32).reshape(8,2))
            targets.append(LOOKUP[str(nums[-1])])
        self.coords=np.stack(coordinates)
        self.targets=np.asarray(targets,dtype=np.int64)
        self.augment=augment
        self.fixed=None if augment else [render_pen([points],brush=10)
                                        for points in self.coords]
        print("UCI PenDigits",split,len(self.targets),"writer-independent split",
              flush=True)
    def __len__(self):return len(self.targets)
    def __getitem__(self,i):
        if self.fixed is not None:return self.fixed[i],int(self.targets[i])
        points=self.coords[i]
        return render_pen([points],
             brush=random.uniform(7.5,13.5),
             angle=random.uniform(-7,7),
             dx=random.uniform(-4,4),dy=random.uniform(-4,4)),int(self.targets[i])
