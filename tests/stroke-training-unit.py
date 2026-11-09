"""No-download assertions for the real-trajectory trainer and format."""
from pathlib import Path
import sys
import numpy as np
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train import CHARS
from train_stroke_sequence import (
    parse_uji,recipes,normalized_paths,resample_paths,tokens_from_strokes,
    SeqMDN,objective,MAX_STEPS
)
import torch

fixture="""
// ASCII char: A
WORD A trn_UJI_W03-01
NUMSTROKES 2
POINTS 4 # 10 90 20 50 30 10 35 10
POINTS 3 # 19 61 27 61 40 61
WORD + tst_UPV_W45-01
NUMSTROKES 2
POINTS 2 # 25 50 75 50
POINTS 2 # 50 20 50 80
"""
rows=parse_uji(fixture)
assert len(rows)==2,rows
assert rows[0][0]=="A" and rows[0][2]=="train"
assert rows[1][0]=="+" and rows[1][2]=="test"
assert len(rows[0][3])==2
assert len(rows[1][3])==2
assert set(recipes())>={"^","+","=","×","÷","±","∞","√","≠","≤","≥"}
# Source-data UJI includes digits, 52 ASCII letters and these 16 punctuation.
uji=set("0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz.,;:?!'\"()%-@$<>")
missing=set(CHARS)-uji
assert missing<=set(recipes()),"No real or synthetic vector trajectories for "+repr(missing-set(recipes()))
for char,_,_,parts in rows:
    p=normalized_paths(parts,np.random.default_rng(10))
    resampled=resample_paths(p)
    token=tokens_from_strokes(resampled)
    assert token.shape[1]==3
    assert np.isfinite(token).all()
    assert len(token)<=MAX_STEPS
    assert int((token[:,2]==0).sum())==len(parts)
model=SeqMDN(hidden=32,layers=2)
seq=torch.zeros((2,MAX_STEPS,3))
lengths=torch.tensor([5,8])
labels=torch.tensor([0,1])
out=model(seq,labels)
assert out.shape==(2,MAX_STEPS,27)
loss=objective(out,seq,lengths)
assert torch.isfinite(loss),loss
loss.backward()
assert model.rnn.weight_ih_l0.grad is not None
print("PASS: real UJI multi-stroke parser, writer split, 102-class coverage, RNN backprop",flush=True)
