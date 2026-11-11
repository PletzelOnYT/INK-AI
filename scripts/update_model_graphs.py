#!/usr/bin/env python3
"""Regenerate the two README model-history charts from checked-in benchmark records.

Never convert missing metrics into made-up scores. Release labels are separate
from measured candidate scores. Camera OCR is a different benchmark.
"""
import json
import re
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DOCS = ROOT / "docs"

def record(name):
    p = MODELS / name
    return json.loads(p.read_text()) if p.is_file() else {}

def measured(value, scale=1):
    return round(float(value) * scale, 5) if isinstance(value, (int, float)) else None

def chart(title, subtitle, items, maximum, unit, footer):
    width, height, left, right, top, bottom = 1400, 490, 80, 1370, 108, 354
    def fmt(v):
        return f"{v:.2f}%" if unit == "percent" else f"{v:.3f}"
    def text(x, y, value, size=13, fill="#202124", anchor="middle"):
        return f'<text x="{x:.2f}" y="{y:.2f}" font-size="{size}" fill="{fill}" text-anchor="{anchor}">{escape(str(value))}</text>'
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
           f'<rect width="{width}" height="{height}" fill="#fff"/>',
           '<g font-family="Arial,Helvetica,sans-serif">',
           text(44,43,title,26,anchor="start"), text(44,69,subtitle,13,"#5f6368","start")]
    for i in range(6):
        val = i * maximum / 5
        y = bottom - (bottom-top)*i/5
        out.append(f'<line x1="{left}" y1="{y:.2f}" x2="{right}" y2="{y:.2f}" stroke="{("#bdc1c6" if i == 0 else "#e8eaed")}"/>')
        out.append(text(72,y+4,fmt(val),12,"#5f6368","end"))
    slot = (right-left)/len(items)
    bw = min(82,slot*.62)
    for idx,item in enumerate(items):
        name,status,value = item
        x = left + slot*(idx+.5)
        color = "#4285f4" if status=="released" else "#9aa0a6"
        if value is None:
            out.append(text(x,333,"no score",12,"#777"))
        else:
            y = bottom - (bottom-top)*max(0,min(maximum,value))/maximum
            out.append(f'<rect x="{x-bw/2:.2f}" y="{y:.2f}" width="{bw:.2f}" height="{bottom-y:.2f}" fill="{color}"/>')
            out.append(text(x,max(top+10,y-9),fmt(value),14))
        out.append(text(x,382,name,13))
        out.append(text(x,401,status,11,color))
    out.append(text(44,444,footer,12,"#5f6368","start"))
    out.append('</g></svg>')
    return "".join(out)

v3 = record("recognition-v3-metrics.json")
v5 = record("recognition-v5-metrics.json")
recog = [
    ("CNN V1","unscored",None),
    ("CNN V2","superseded",measured(v3.get("baseline_v2",{}).get("pen_independent",{}).get("overall"),100)),
    ("CNN V3","released",measured(v3.get("independent_pen_v3",{}).get("overall"),100)),
    ("CNN V4","rejected",74.40), # Historic graph value, V4 experiment is on its own branch.
    ("CNN V5","released" if v5.get("eligible") is True and v5.get("deployable") is True and v5.get("browser_integration_passed") is True else "experimental",measured(v5.get("independent_pen_v3",{}).get("overall"),100)),
]
# Future recognizer experiments are added automatically if a comparable
# independently held-out pen-writer accuracy is recorded.
for p in sorted(MODELS.glob("recognition-v*-metrics.json")):
    m = re.fullmatch(r"recognition-v(\d+)-metrics.json",p.name)
    if not m or int(m.group(1))<=5: continue
    report=record(p.name)
    val=report.get("independent_pen_v"+m.group(1),{}).get("overall")
    if val is None: val=report.get("best",{}).get("independent_test",{}).get("overall")
    recog.append(("CNN V"+m.group(1),"experimental",measured(val,100)))
DOCS.joinpath("recognition-vertical-bars.svg").write_text(chart(
    "Recognizer version history",
    "UJI · held-out pen writers · accuracy (higher is better)",
    recog,100,"percent",
    "V5 shown as released only if held-out and real-browser acceptance passed. V4 rejected; V1 unscored."
),encoding="utf-8")

v2 = record("stroke-prefix-domain-v2-metrics.json")
v1score=v2.get("baseline",{}).get("independent",{}).get("prefix_frame_position_error")
scores=[
    ("Sequence V1","superseded",None), # NLL, not the same trajectory-error metric
    ("Sequence V2","rejected" if record("stroke-sequence-v2-metrics.json").get("eligible") is False else "unscored",None),
    ("Prefix V1","superseded",measured(v1score)),
    ("Domain V2","released",measured(v2.get("candidate",{}).get("independent",{}).get("prefix_frame_position_error"))),
    ("PenLift V3","rejected" if record("penlift-v3-metrics.json").get("eligible") is False else "unscored",None),
]
for version in range(3,8):
    r=record(f"stroke-prefix-domain-v{version}-metrics.json")
    if version==5: # Independent V5 lift experiment used a different metric.
        r=record("recurrent-lift-v5-metrics.json")
        scores.append(("Lift V5","rejected" if r else "unscored",None))
        continue
    if version==7 and not r:
        scores.append(("Domain V7","pending",None))
        continue
    value=r.get("candidate",{}).get("independent",{}).get("prefix_frame_position_error")
    status="released" if r.get("eligible") is True and r.get("deployable") is True and r.get("browser_integration_passed") is True else ("rejected" if r.get("eligible") is False else "pending")
    scores.append((f"Domain V{version}",status,measured(value)))
natural=record("stroke-natural-v4-metrics.json")
scores.append(("Natural V4","rejected" if natural.get("eligible") is False else "unscored",
    measured(natural.get("candidate",{}).get("independent",{}).get("prefix_frame_position_error"))))
for p in sorted(MODELS.glob("stroke-prefix-domain-v*-metrics.json")):
    m=re.fullmatch(r"stroke-prefix-domain-v(\d+)-metrics.json",p.name)
    if not m or int(m.group(1))<=7: continue
    r=record(p.name)
    value=r.get("candidate",{}).get("independent",{}).get("prefix_frame_position_error")
    status="released" if r.get("eligible") and r.get("deployable") and r.get("browser_integration_passed") else ("rejected" if r.get("eligible") is False else "pending")
    scores.append(("Domain V"+m.group(1),status,measured(value)))
DOCS.joinpath("completion-vertical-bars.svg").write_text(chart(
    "Completer version history",
    "Held-out writer · free-running trajectory position error (lower is better)",
    sorted(scores, key=lambda e: (int(re.search(r"V(\d+)",e[0]).group(1)), 0 if e[0].startswith("Sequence") else 1 if e[0].startswith("Prefix") else 2 if e[0].startswith("PenLift") else 3 if e[0].startswith("Domain") else 4)),.5,"error",
    "Only comparable trajectory errors have bars; rejected models stay gray; V7 requires independent and browser validation."
),encoding="utf-8")
print("Updated both model-history SVGs from available measured reports.")
