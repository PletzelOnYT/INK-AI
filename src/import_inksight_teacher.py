#!/usr/bin/env python3
"""Read Google Research InkSight's published vector outputs for experimental motion pretraining.

These are MODEL-GENERATED word/line traces, NOT human-labelled UJI characters.
Never assign their word content to an individual character or use them as an
independent handwriting test set. License: Apache-2.0 (dataset card).
Source: https://huggingface.co/datasets/Derendering/InkSight-Derenderings
"""
from pathlib import Path
import re
import xml.etree.ElementTree as ET
import numpy as np

INKML = "{http://www.w3.org/2003/InkML}"
NUM = re.compile(r"[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?")

def parse_inkml(path):
    root=ET.parse(path).getroot()
    if root.tag not in (INKML+"ink","ink"):
        raise ValueError("Not InkML")
    annotation={}
    for item in root.findall(INKML+"annotation")+root.findall("annotation"):
        annotation[item.attrib.get("type","")]=(item.text or "").strip()
    if annotation.get("application")!="InkSight":
        raise ValueError("Not verified InkSight model output")
    strokes=[]
    for node in root.findall(INKML+"trace")+root.findall("trace"):
        tokens=NUM.findall(node.text or "")
        if len(tokens)<6 or len(tokens)%2:continue
        pts=np.asarray([float(t) for t in tokens],dtype=np.float32).reshape(-1,2)
        if not np.isfinite(pts).all():continue
        pts=pts[np.r_[True,np.any(np.diff(pts,axis=0)!=0,axis=1)]]
        if len(pts)>=3 and np.ptp(pts,axis=0).max()>2:
            strokes.append(pts)
    return annotation,strokes

def teacher_motion_records(root,limit=3000):
    """Return unlabelled motion fragments; no fake per-character supervision."""
    root=Path(root)
    paths=sorted(root.glob("*_inkml/*/*.inkml"))[:limit]
    records=[];read=0
    for file in paths:
        try:meta,strokes=parse_inkml(file)
        except (ET.ParseError,OSError,ValueError):continue
        if not strokes:continue
        read+=1
        # A word trace isn't a single glyph. Use individual drawn pen strokes
        # as generic motion prior and NOT as class-labelled examples.
        for trace in strokes:
            if len(trace)<7:continue
            if np.linalg.norm(trace[-1]-trace[0])<2 and len(trace)<12:continue
            records.append([trace])
    return records,{"inkml_files_scanned":len(paths),"verified_files":read,
                    "unlabelled_teacher_strokes":len(records),
                    "source":"Derendering/InkSight-Derenderings",
                    "teacher":"Google Research InkSight model-produced vector strokes",
                    "training_label_claim":"none; unconditional pen-motion pretraining",
                    "dataset_license":"Apache-2.0"}

if __name__=="__main__":
    import argparse,json
    p=argparse.ArgumentParser();p.add_argument("root")
    a=p.parse_args()
    _,stats=teacher_motion_records(a.root)
    print(json.dumps(stats,indent=2))
