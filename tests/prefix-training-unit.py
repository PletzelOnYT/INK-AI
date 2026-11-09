"""The prefix-conditioned finetuner must train on free-running predictions."""
import sys,torch
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train_stroke_sequence import SeqMDN,MAX_STEPS
from train_prefix_completion import prefix_rollout_batch,modal_token
torch.set_num_threads(2)
model=SeqMDN(hidden=32,layers=2)
batch=torch.zeros((4,MAX_STEPS,3),dtype=torch.float32)
for j in range(31):
    batch[:,j,0]=.017
    batch[:,j,1]=.015*(1 if j<12 else -1)
    batch[:,j,2]=1.0 if j else 0.0
labels=torch.tensor([12,36,44,59])
length=torch.tensor([29,27,26,30])
torch.manual_seed(88)
loss=prefix_rollout_batch(model,batch,labels,length,cut=10,steps=18,
 teacher_probability=.38,training=True)
assert loss is not None and torch.isfinite(loss)
loss.backward()
assert model.rnn.weight_ih_l0.grad is not None
assert float(model.rnn.weight_ih_l0.grad.abs().sum())>0
assert model.head.weight.grad is not None
pred=modal_token(torch.zeros((4,27)))
assert pred.shape==(4,3)
print("PASS: incomplete character prefixes train differentiable real-pen GRU despite feeding back its own generated motion",flush=True)
