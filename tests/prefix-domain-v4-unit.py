"""Real differentiable long-horizon prefix-trajectory learning and EOS/lift labels."""
import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
import torch
from train_stroke_sequence import SeqMDN,MAX_STEPS
from train_prefix_domain_v4 import human_trajectory_loss,prefix_frame
torch.manual_seed(123)
model=SeqMDN(hidden=24,layers=2)
data=torch.zeros(6,MAX_STEPS,3)
data[:,0,:]=torch.tensor([.25,.20,0.])
for i in range(1,36):
    data[:,i,0]=.008
    data[:,i,1]=.014 if i<15 else -.007
    data[:,i,2]=1.
data[0,15,2]=0
data[1,23,2]=0
length=torch.tensor([34,33,31,32,35,34])
f=prefix_frame(data,8)
loss=human_trajectory_loss(model,f,torch.tensor([4,8,12,24,33,45]),
                           length,cut=8,steps=18,teacher_probability=.45)
assert torch.isfinite(loss),loss
loss.backward()
assert torch.isfinite(model.head.weight.grad).all()
assert model.head.weight.grad[0:5].abs().sum()>0,"No motion head gradients"
assert model.head.weight.grad[25].abs().sum()>0,"No real pen lift gradients"
assert model.head.weight.grad[26].abs().sum()>0,"No EOS stop gradients"
assert model.rnn.weight_ih_l0.grad.abs().sum()>0
# Prefix normalization causality preserved: future points do not shift the
# visible prefix's frame even though they contribute motion learning targets.
future=data.clone();future[:,12:,0]+=.12
assert torch.allclose(prefix_frame(data,8)[:,:8],prefix_frame(future,8)[:,:8])
print("PASS: focus-optimized causal geometry training backpropagates learned trajectories, lifts, and EOS")
