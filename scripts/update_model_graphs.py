#!/usr/bin/env python3
"""Rebuild INK AI model graphs whenever a system or benchmark changes.
Never fill in unknown metrics with invented numbers.
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"docs"
OUT.mkdir(exist_ok=True)
metrics_path=ROOT/"models/print-cnn-v1-metrics.json"
print_metrics=json.loads(metrics_path.read_text()) if metrics_path.exists() else {}
recognition_metrics=json.loads((ROOT/"models/recognition-v3-metrics.json").read_text())
completion_metrics=json.loads((ROOT/"models/stroke-prefix-domain-v2-metrics.json").read_text())
hand_accuracy=recognition_metrics["independent_pen_v3"]["overall"]
completion_gain=completion_metrics["gain"]
accuracy=print_metrics.get("heldout_accuracy")
real_camera=print_metrics.get("real_camera_word_accuracy")
if accuracy is not None and not 0<=accuracy<=1:raise ValueError("Bad heldout accuracy")
if real_camera is not None and not 0<=real_camera<=1:raise ValueError("Bad camera accuracy")
def svg_start(title,subtitle,width=920,height=460):
    return [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
      f'<rect width="{width}" height="{height}" fill="#ffffff"/>',
      '<g font-family="Arial,Helvetica,sans-serif">',
      f'<text x="36" y="46" font-size="26" font-weight="bold" fill="#202124">{escape(title)}</text>',
      f'<text x="36" y="76" font-size="14" fill="#5f6368">{escape(subtitle)}</text>']
def text(x,y,s,size=15,color="#30343a",bold=False):
    return f'<text x="{x}" y="{y}" font-size="{size}" fill="{color}"'+(' font-weight="bold"' if bold else '')+'>'+escape(str(s))+'</text>'
def bar(x,y,value,label):
    a=[text(x,y-9,label,15,bold=True),f'<rect x="{x}" y="{y+10}" width="665" height="23" rx="6" fill="#eceff1"/>']
    if value is not None:
        a.append(f'<rect x="{x}" y="{y+10}" width="{665*value:.2f}" height="23" rx="6" fill="#4285f4"/>')
        a.append(text(x+685,y+28,f"{value*100:.2f}%",17,bold=True))
    else:a.append(text(x+685,y+28,"Not measured",14,color="#68737d"))
    return a
parts=svg_start("Camera printed-text recognition","Synthetic-font evaluation is NOT a webcam benchmark.")
parts+=bar(45,128,accuracy,"PRINT CNN V1 | Character accuracy on independent font families")
parts+=bar(45,222,real_camera,"Camera | Correct complete words on real photos")
font_n=print_metrics.get("heldout_font_count")
n=print_metrics.get("heldout_characters")
if accuracy is not None:
    parts.append(text(45,334,f"Holdout: {n} synthetic glyphs across {font_n} fonts; trained from scratch.",14))
else:
    parts.append(text(45,334,"Printed CNN training/independent evaluation is pending.",14))
parts.append(text(45,375,"All text/background colors: local RGB contrast detection; real-camera validation pending.",14))
parts.append(text(45,412,"New systems must supply independently measured metrics. Unknown values stay unplotted.",13,color="#59626b"))
parts.append("</g></svg>")
(OUT/"camera-print-benchmarks.svg").write_text("".join(parts),encoding="utf8")

parts=svg_start("INK AI | Model and system benchmarks","Different metrics, different datasets. Bar heights must not be compared as one score.",920,590)
parts+=bar(45,125,hand_accuracy,"Handwriting CNN V3 | UJI held-out writers | character accuracy")
parts+=bar(45,230,completion_gain,"Completer Domain V2 | reduction in pen trajectory error")
parts+=bar(45,335,accuracy,"Printed CNN V1 | synthetic held-out fonts | character accuracy")
parts+=bar(45,440,real_camera,"Camera OCR | real-world complete-word accuracy")
parts.append(text(45,547,"Handwriting and completion figures: existing repository benchmark graphs.",13,color="#59626b"))
parts.append("</g></svg>")
(OUT/"ai-systems.svg").write_text("".join(parts),encoding="utf8")
print("Updated camera-print-benchmarks.svg and ai-systems.svg; no fabricated results")
