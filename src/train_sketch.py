#!/usr/bin/env python3
"""Train INK AI's OWN generative stroke-completion GRU from scratch.

Unlike the handwriting classifier, this model actually predicts future
drawing coordinates and pen lifts from a sequence of real human sketch strokes.
Training data: Google's Quick, Draw! Sketch-RNN preprocessed NPZ, CC BY 4.0.
NO pretrained weights are downloaded, imported, or copied.

Usage:
  python -u src/train_sketch.py --examples-per-category 3200 --epochs 3
"""
from __future__ import annotations
import argparse
import base64
import datetime
import json
import math
import random
import urllib.parse
import urllib.request
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.utils.data import DataLoader, TensorDataset

SEED = 214932
MIXTURES = 5
SCALE = 20.0  # Quick Draw vector step offset (in 256px sketch coordinates).
CATEGORIES = ["cat", "dog", "tree", "flower", "house", "car",
              "bird", "fish", "star", "smiley face", "bicycle", "apple"]
BASE = "https://storage.googleapis.com/quickdraw_dataset/sketchrnn/{}.npz"


class SketchGRU(nn.Module):
    """A compact autoregressive neural generator, not a shape extrapolator."""
    def __init__(self, hidden=96):
        super().__init__()
        self.rnn = nn.GRU(input_size=3, hidden_size=hidden, batch_first=True)
        self.head = nn.Linear(hidden, MIXTURES * 5 + 2)

    def forward(self, x):
        h, _ = self.rnn(x)
        return self.head(h)


def load_real_sketches(root: Path, cap: int, max_steps: int):
    root.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(SEED)
    arrays = []
    held_out = []
    per_category = {}
    for category in CATEGORIES:
        url = BASE.format(urllib.parse.quote(category, safe=""))
        file = root / (category.replace(" ", "_") + ".npz")
        if not file.exists():
            print(f"Downloading real human Quick Draw sketches: {category}", flush=True)
            req = urllib.request.Request(url, headers={"User-Agent": "INK-AI/1.0"})
            with urllib.request.urlopen(req, timeout=90) as response, file.open("wb") as dest:
                import shutil
                shutil.copyfileobj(response, dest)
        with np.load(file, allow_pickle=True, encoding="latin1") as data:
            train = data["train"]
            valid = data["valid"]
            chosen = rng.choice(len(train), min(cap, len(train)), replace=False)
            pairs = [(train, chosen, arrays), (valid, np.arange(min(120,len(valid))), held_out)]
            for source, indices, dest in pairs:
                for idx in indices:
                    seq = np.asarray(source[int(idx)], dtype=np.float32)
                    if seq.ndim != 2 or seq.shape[1] != 3 or not 10 <= len(seq) <= max_steps:
                        continue
                    # The source preserves pen-up signals, needed to learn multi-stroke sketches.
                    seq = seq.copy()
                    seq[:, :2] = np.clip(seq[:, :2] / SCALE, -4, 4)
                    seq[:, 2] = (seq[:, 2] > 0.5).astype(np.float32)
                    dest.append(seq)
        per_category[category] = min(cap, len(train))
        print(f"{category}: loaded {per_category[category]} candidates", flush=True)
    print(f"Validated: {len(arrays):,} train drawings, {len(held_out):,} held-out", flush=True)
    if len(arrays) < 1000:
        raise RuntimeError("Insufficient real sketches were collected to train model")
    return arrays, held_out, per_category


def pad_dataset(arrays, max_steps):
    n = len(arrays)
    features = np.zeros((n, max_steps, 3), dtype=np.float32)
    targets = np.zeros((n, max_steps, 3), dtype=np.float32)
    valid = np.zeros((n, max_steps), dtype=np.float32)
    end = np.zeros((n, max_steps), dtype=np.float32)
    for i, sketch in enumerate(arrays):
        sketch = sketch[:max_steps]
        t = len(sketch)
        # A leading zero vector represents the first token.
        features[i, 1:t] = sketch[:-1]
        targets[i, :t] = sketch
        valid[i, :t] = 1
        end[i, t - 1] = 1
    return TensorDataset(
        torch.from_numpy(features), torch.from_numpy(targets),
        torch.from_numpy(valid), torch.from_numpy(end)
    )


def prediction_loss(output, target, valid, end):
    k = MIXTURES
    raw_pi = output[..., :k]
    mx = output[..., k:2*k]
    my = output[..., 2*k:3*k]
    log_sx = output[..., 3*k:4*k].clamp(-4.0, 2.0)
    log_sy = output[..., 4*k:5*k].clamp(-4.0, 2.0)
    pen = output[..., 5*k]
    stop = output[..., 5*k+1]
    dx = target[..., 0].unsqueeze(-1)
    dy = target[..., 1].unsqueeze(-1)
    # Bivariate diagonal Gaussian mixture; unlike MSE this admits multiple futures.
    logp = -math.log(2*math.pi) - log_sx - log_sy
    logp = logp - .5*((dx-mx).square()*torch.exp(-2*log_sx)
                         +(dy-my).square()*torch.exp(-2*log_sy))
    nll = -torch.logsumexp(nn.functional.log_softmax(raw_pi, dim=-1)+logp, dim=-1)
    lift = nn.functional.binary_cross_entropy_with_logits(
        pen, target[..., 2], reduction="none")
    finished = nn.functional.binary_cross_entropy_with_logits(
        stop, end, reduction="none", pos_weight=torch.tensor(9.0))
    denom = valid.sum().clamp(min=1)
    return ((nll + .35*lift + .2*finished)*valid).sum()/denom


@torch.no_grad()
def evaluate(model, loader):
    model.eval()
    total = count = 0.
    for features, target, valid, end in loader:
        loss = prediction_loss(model(features), target, valid, end)
        n = valid.sum().item()
        total += float(loss)*n
        count += n
    return total/max(1,count)


def quantize(array):
    a = array.detach().cpu().numpy()
    scale = float(max(1e-9, np.max(np.abs(a)) / 127.0))
    q = np.clip(np.round(a/scale), -127, 127).astype(np.int8)
    return {"shape": list(a.shape), "scale": scale,
            "b64": base64.b64encode(q.tobytes()).decode("ascii")}


def write_model(model, path: Path, metadata: dict, steps: int, val_loss: float):
    sd = model.state_dict()
    payload = {
        "format": "ink-generative-gru-v1",
        "name": "INK AI Sketch Generator — independently trained, no pretrained weights",
        "architecture": {"input": 3, "hidden": model.rnn.hidden_size,
                         "layers": 1, "mixtures": MIXTURES,
                         "scale_px": SCALE, "max_prefix": 72, "max_generate": 34},
        "weights": {
            "weight_ih": quantize(sd["rnn.weight_ih_l0"]),
            "weight_hh": quantize(sd["rnn.weight_hh_l0"]),
            "bias_ih": np.round(sd["rnn.bias_ih_l0"].numpy(),6).tolist(),
            "bias_hh": np.round(sd["rnn.bias_hh_l0"].numpy(),6).tolist(),
            "head_w": quantize(sd["head.weight"]),
            "head_b": np.round(sd["head.bias"].numpy(),6).tolist()
        },
        "training": {
            "dataset":"Google Quick, Draw! Sketch-RNN vector sketches",
            "license":"CC BY 4.0",
            "source":"https://github.com/googlecreativelab/quickdraw-dataset",
            "training_drawings":metadata["train_drawings"],
            "validation_drawings":metadata["val_drawings"],
            "categories":metadata["categories"],
            "training_presentations":steps,
            "validation_nll":round(val_loss,5),
            "trained_from_scratch":True,
            "date":datetime.datetime.now(datetime.timezone.utc).isoformat()
        }
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, separators=(",",":")), encoding="utf8")
    print(f"Exported {path}, {path.stat().st_size:,} bytes, val loss {val_loss:.4f}", flush=True)
    return payload


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--examples-per-category", type=int, default=3200)
    p.add_argument("--epochs", type=int, default=3)
    p.add_argument("--hidden", type=int, default=96)
    p.add_argument("--max-steps", type=int, default=90)
    p.add_argument("--batch", type=int, default=128)
    p.add_argument("--data", default=".data/sketch")
    p.add_argument("--out", default="models/ink-sketch-gru-v1.json")
    a = p.parse_args()
    torch.manual_seed(SEED)
    torch.set_num_threads(4)
    np.random.seed(SEED)
    random.seed(SEED)
    train, valid, counts = load_real_sketches(
        Path(a.data), a.examples_per_category, a.max_steps)
    dataset = pad_dataset(train, a.max_steps)
    valset = pad_dataset(valid, a.max_steps)
    loader = DataLoader(dataset, batch_size=a.batch, shuffle=True)
    val_loader = DataLoader(valset, batch_size=a.batch * 2)
    model = SketchGRU(hidden=a.hidden)
    optimizer = torch.optim.AdamW(model.parameters(), lr=.0018, weight_decay=.00005)
    metadata={"train_drawings":len(train),"val_drawings":len(valid),
              "categories":counts}
    best = float("inf")
    seen=0
    for epoch in range(1,a.epochs+1):
        model.train()
        total_loss=0.
        for bi,(features,target,mask,stop) in enumerate(loader):
            optimizer.zero_grad(set_to_none=True)
            y=model(features)
            loss=prediction_loss(y,target,mask,stop)
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(),1.0)
            optimizer.step()
            total_loss+=float(loss)*len(features)
            seen+=len(features)
            if (bi+1)%80==0:
                print(f"epoch={epoch}/{a.epochs} batch={bi+1}/{len(loader)} "
                      f"seen={seen:,}, loss={float(loss):.4f}",flush=True)
        result=evaluate(model,val_loader)
        print(f"epoch={epoch} loss={total_loss/len(dataset):.4f} "
              f"held-out-loss={result:.4f}",flush=True)
        if result<best and math.isfinite(result):
            best=result
            write_model(model,Path(a.out),metadata,seen,result)
    if not Path(a.out).exists():
        raise RuntimeError("No valid trained generative model produced")
    Path("models/sketch-metrics.json").write_text(json.dumps(
        {"validation_loss":best,"train_drawings":len(train),
         "valid_drawings":len(valid),"presentations":seen,"categories":counts,
         "model":a.out},indent=2),encoding="utf8")
    print("Training complete; publish models/ink-sketch-gru-v1.json",flush=True)


if __name__ == "__main__":
    main()
