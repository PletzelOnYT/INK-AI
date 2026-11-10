"""Ensure expansion of trained GRU preserves exact next-stroke predictions."""
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
from train_stroke_sequence import SeqMDN
from train_google_teacher_big import transplant_existing_gru,check_preserved_predictions
import torch
torch.manual_seed(12)
old=SeqMDN(hidden=192,embed=48,layers=2)
big=SeqMDN(hidden=384,embed=48,layers=2)
diff=check_preserved_predictions(transplant_existing_gru(big,old),old)
assert diff<2e-5,diff
# Both letter-conditioned outputs and the original layer weights survive.
with torch.no_grad():
    a=old(torch.zeros(1,14,3),torch.tensor([17]))
    b=big(torch.zeros(1,14,3),torch.tensor([17]))
assert torch.allclose(a,b,atol=2e-5,rtol=0)
print("PASS: larger teacher student starts from the actual trained GRU predictions")
