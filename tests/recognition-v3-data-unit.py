"""Fast no-network test of browser-domain rasterization and genuine labels."""
import sys
from pathlib import Path
import numpy as np
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train import CHARS,LOOKUP
from train_recognition_v3 import render_pen,HumanPen
strokes=[
 np.array([[100,110],[101,155],[102,203],[102,244]],np.float32),
 np.array([[102,170],[137,161],[166,157]],np.float32)
]
image=render_pen(strokes,brush=10)
assert image.shape==(1,32,32)
assert float(image.min())>=0 and float(image.max())<=1
assert float(image.sum())>15
coords=np.argwhere(image.numpy()[0]>.1)
assert len(coords)>15
box=coords.max(axis=0)-coords.min(axis=0)
assert max(box)<32 and min(box)>2,box
records=[("F","trn_UJI_W03","train",strokes),("I","tst_UPV_W01","test",[strokes[0]])]
ds=HumanPen(records,augment=False)
for i in range(2):
    x,label=ds[i]
    assert x.shape==(1,32,32)
    assert label==LOOKUP[records[i][0]]
assert len(CHARS)==102
print("PASS: real human pen trajectories are rasterized into canvas-normalized grayscale glyphs",flush=True)
