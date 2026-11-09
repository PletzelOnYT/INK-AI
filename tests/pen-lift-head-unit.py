"""Pen-lift training must update one output row, not destroy geometry logits."""
import sys,torch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train_stroke_sequence import SeqMDN,MIXTURES,MAX_STEPS
from train_pen_lift_head_v3 import PEN_ROW
assert PEN_ROW==5*MIXTURES==25
model=SeqMDN(hidden=32)
base=model.head.weight.detach().clone()
for p in model.parameters():p.requires_grad_(False)
row=torch.nn.Parameter(model.head.weight[PEN_ROW].detach().clone())
bias=torch.nn.Parameter(model.head.bias[PEN_ROW].detach().clone())
inputs=torch.randn((3,MAX_STEPS,3))*.02
inputs[:,:,2]=1
inputs[:,14,2]=0
labels=torch.tensor([10,34,46])
with torch.no_grad():
    emb=model.embedding(labels)
    hidden,_=model.rnn(torch.cat([inputs,emb[:,None,:].expand(-1,MAX_STEPS,-1)],dim=2))
scores=hidden[:,:-1]@row+bias
target=inputs[:,1:,2]
mask=torch.arange(MAX_STEPS-1)[None,:]<30
weight=torch.where(target<.5,11.,1.)
loss=(torch.nn.functional.binary_cross_entropy_with_logits(
    scores,target,reduction="none")*mask*weight).sum()/mask.sum()
loss.backward()
assert row.grad is not None and float(row.grad.abs().sum())>0
assert bias.grad is not None
assert torch.allclose(model.head.weight.detach(),base)
print("PASS: pen-lift calibration has gradients and cannot modify learned position/mix weights",flush=True)
