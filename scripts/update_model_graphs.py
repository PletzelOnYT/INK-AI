#!/usr/bin/env python3
"""Rebuild the vertical benchmark charts using the original INK AI graph style.

Every percentage comes from a checked-in benchmark report. Missing webcam
measurements are visibly labeled, never fabricated as zeros.
"""
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/"docs"
OUT.mkdir(exist_ok=True)

def report(name):
    path=ROOT/"models"/name
    return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

printing=report("print-cnn-v1-metrics.json")
handwriting=report("recognition-v3-metrics.json")
completion=report("stroke-prefix-domain-v2-metrics.json")
print_value=printing.get("heldout_accuracy")
camera_value=printing.get("real_camera_word_accuracy")
hand_value=handwriting.get("independent_pen_v3",{}).get("overall")
completion_value=completion.get("gain")

def check_fraction(value):
    if value is not None and (not isinstance(value,(int,float)) or not 0<=value<=1):
        raise ValueError("Benchmark percentages must be real fractions: "+repr(value))
    return value

def vertical_chart(title, subtitle, bars, footer):
    for _,_,value in bars:check_fraction(value)
    out=[
      '<svg xmlns="http://www.w3.org/2000/svg" width="850" height="465" viewBox="0 0 850 465" role="img" aria-label="'+escape(title)+'">',
      '<rect width="850" height="465" fill="#fff"/>',
      '<g font-family="Arial,Helvetica,sans-serif">',
      '<text x="42" y="45" font-size="25" font-weight="600" fill="#202124">'+escape(title)+'</text>',
      '<text x="42" y="70" font-size="13" fill="#5f6368">'+escape(subtitle)+'</text>'
    ]
    for tick in range(0,101,20):
        y=360-260*tick/100
        stroke="#bdc1c6" if tick==0 else "#e8eaed"
        out.append(f'<line x1="90" y1="{y:.0f}" x2="800" y2="{y:.0f}" stroke="{stroke}"/>')
        out.append(f'<text x="77" y="{y+4:.0f}" font-size="12" fill="#5f6368" text-anchor="end">{tick}%</text>')
    count=len(bars)
    for i,(name,sub,value) in enumerate(bars):
        middle=90+710*(i+.5)/count
        bw=105 if count<=3 else 100
        left=middle-bw/2
        if value is None:
            # Outline indicates an unmeasured result, NOT a zero-height bar.
            out.append(f'<rect x="{left:.2f}" y="100" width="{bw}" height="260" fill="none" stroke="#9aa0a6" stroke-dasharray="5 5"/>')
            out.append(f'<text x="{middle:.2f}" y="230" font-size="14" fill="#5f6368" text-anchor="middle">N/A</text>')
        else:
            top=360-260*value
            out.append(f'<rect x="{left:.2f}" y="{top:.2f}" width="{bw}" height="{260*value:.2f}" fill="#4285f4"/>')
            out.append(f'<text x="{middle:.2f}" y="{top-10:.2f}" font-size="15" fill="#202124" text-anchor="middle">{value*100:.2f}%</text>')
        out.append(f'<text x="{middle:.2f}" y="389" font-size="14" fill="#202124" text-anchor="middle">{escape(name)}</text>')
        out.append(f'<text x="{middle:.2f}" y="410" font-size="12" fill="#5f6368" text-anchor="middle">{escape(sub)}</text>')
    out.append('<text x="425" y="447" font-size="12" fill="#5f6368" text-anchor="middle">'+escape(footer)+'</text>')
    out.append('</g></svg>')
    return ''.join(out)

holdout_n=printing.get("heldout_characters")
font_count=printing.get("heldout_font_count")
if print_value is not None:
    footer=f"Synthetic test: {holdout_n} characters, {font_count} held-out fonts. Real camera: unmeasured."
else:
    footer="Printed model evaluation pending. Real-camera accuracy has not been measured."
(OUT/"camera-print-benchmarks.svg").write_text(vertical_chart(
    "Camera Recognition", "Printed characters | synthetic-font test vs. live-camera test",
    [("Print CNN V1","held-out fonts",print_value),
     ("Camera OCR","real photos",camera_value)],
    footer
), encoding="utf-8")

(OUT/"ai-systems.svg").write_text(vertical_chart(
    "INK AI Systems", "Model benchmarks | different tests, not directly comparable",
    [("Recognizer V3","unseen writers",hand_value),
     ("Completer V2","error reduction",completion_value),
     ("Print CNN V1","held-out fonts",print_value),
     ("Camera OCR","real photos",camera_value)],
    "Different datasets and metrics. N/A means not measured, not 0%."
), encoding="utf-8")
print("Updated INK AI vertical benchmark charts using verified model reports")
