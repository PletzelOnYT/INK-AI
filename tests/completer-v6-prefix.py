#!/usr/bin/env python3
"""V6 online-pen training: framing and independent-writer gate regressions."""
import sys
from pathlib import Path
import torch
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"src"))
import train_completer_v6 as v6

def main():
    # Synthetic true pen-prefix, no future positions used to select the frame.
    seq=torch.zeros((2,56,3),dtype=torch.float32)
    seq[0,0]=torch.tensor([.30,.35,0.])
    seq[0,1]=torch.tensor([.06,.10,1.])
    seq[0,2]=torch.tensor([.07,.09,1.])
    seq[0,3]=torch.tensor([.05,.06,1.])
    seq[1,:4]=seq[0,:4]
    seq[0,4]=torch.tensor([.5,.5,1.])
    seq[1,4]=torch.tensor([-.5,-.5,1.])
    x=v6.prefix_frame(seq,4)
    assert torch.allclose(x[0,:4],x[1,:4]),\
        "Future ink is not allowed to leak into the prefix frame"
    positions=torch.cumsum(x[0,:4,:2],dim=0)
    center=(positions.amin(dim=0)+positions.amax(dim=0))/2
    assert torch.allclose(center,torch.tensor([.5,.5]),atol=.0001),center
    assert x.shape==seq.shape
    # Require strict independent writer lifting and motion gates before
    # allowing a new generative model into the user's downloaded HTML.
    script=Path("src/train_completer_v6.py").read_text()
    for token in ('"deployable":False','new_final["pen_lift_f1"]>=.12',
                  'new_final["pen_lift_precision"]>=.10',
                  '"requires_browser_integration":True'):
        assert token in script,token
    print("PASS: trainable V6 centered causal prefix, unseen-writer gates and safe deployment")

if __name__=="__main__":
    main()
