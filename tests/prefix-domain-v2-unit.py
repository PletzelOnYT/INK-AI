"""Real browser prefix-frame normalization must depend only on visible ink."""
import sys
from pathlib import Path
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train_prefix_domain_v2 import prefix_frame
from train_stroke_sequence import SeqMDN,MAX_STEPS
from train_prefix_completion import prefix_rollout_batch

seq=torch.zeros((2,MAX_STEPS,3),dtype=torch.float32)
seq[:,0]=torch.tensor([.19,.22,0.])
for j in range(1,37):
    seq[:,j,0]=.017
    seq[:,j,1]=.014 if j<17 else -.012
    seq[:,j,2]=1.
seq[1,17:37,0]=-0.016
prefix=12
new=prefix_frame(seq,prefix)
assert new.shape==seq.shape
positions=torch.cumsum(new[:,:,:2],dim=1)
visible=positions[:,:prefix]
assert bool((visible.amin(dim=1).values>=.159).all())
assert bool((visible.amax(dim=1).values<=.85).all())
# Future pen data cannot leak into normalization of visible strokes.
mutated=seq.clone()
mutated[:,prefix:,0]+=1.
mutated[:,prefix:,1]-=2.
again=prefix_frame(mutated,prefix)
assert torch.allclose(new[:,:prefix],again[:,:prefix],atol=1e-6)
# Reframe must scale later motion, rather than simply replacing first token.
assert not torch.allclose(new[:,prefix:,:2],seq[:,prefix:,:2])
model=SeqMDN(hidden=32,layers=2)
labels=torch.tensor([35,44])
lengths=torch.tensor([32,34])
loss=prefix_rollout_batch(model,new,labels,lengths,cut=prefix,steps=16,
 teacher_probability=.35,training=True)
assert bool(torch.isfinite(loss))
loss.backward()
assert model.rnn.weight_ih_l0.grad is not None
print("PASS: browser-style prefix-only normalization is causal and prefix-conditioned GRU loss backpropagates",flush=True)
