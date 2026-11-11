#!/usr/bin/env python3
"""Generate complete, evidence-based recognition and completion model charts.

Blue identifies the exact checkpoint in docs/current-models.json, not the
candidate with the best isolated score. Different benchmarks have independent
axes and are never presented as interchangeable accuracy percentages.
"""
from html import escape
import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MODELS = ROOT / "models"
DOCS = ROOT / "docs"


def load(path):
    p = ROOT / path
    return json.loads(p.read_text(encoding="utf-8")) if p.is_file() else {}


def nested(data, *keys):
    for key in keys:
        if not isinstance(data, dict):
            return None
        data = data.get(key)
    return float(data) if isinstance(data, (int, float)) and not isinstance(data, bool) else None


def pct(value):
    return 100 * value if value is not None else None


def text(x, y, value, size=14, color="#1f2937", weight="400", anchor="start"):
    return (f'<text x="{x:.1f}" y="{y:.1f}" fill="{color}" '
            f'font-size="{size}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{escape(str(value))}</text>')


def rect(x, y, width, height, fill, stroke=None, radius=0):
    edge = f' stroke="{stroke}"' if stroke else ""
    return (f'<rect x="{x:.1f}" y="{y:.1f}" width="{width:.1f}" '
            f'height="{height:.1f}" rx="{radius}" fill="{fill}"{edge}/>')


def format_score(value, kind):
    if value is None:
        return "Not measured"
    return f"{value:.2f}%" if kind == "percent" else f"{value:.4f}"


def graph(title, subtitle, rows, first_name, second_name,
          first_max, second_max, first_kind, second_kind, notes, target):
    """Small, legible SVG milestone charts for GitHub's README width.

    Accurate measured values are preserved; extreme trajectory outliers use
    an explicit broken axis rather than flattening all normal candidates.
    """
    if sum(bool(row["active"]) for row in rows) != 1:
        raise ValueError("One and only one deployed model must be marked blue")
    width, height = 900, 488
    left, right = 82, 860
    xcoords = [left + (right-left)*i/(len(rows)-1) for i in range(len(rows))]
    blue, gray, ink, grid = "#2563eb", "#94a3b8", "#142137", "#e5e7eb"
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
        f'height="{height}" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{escape(title)}">',
        rect(0, 0, width, height, "#ffffff"),
        '<g font-family="Arial,Helvetica,sans-serif">',
        '<circle cx="26" cy="25" r="6" fill="#2563eb"/>',
        text(41, 31, "In use", 13, blue, "700"),
    ]
    short = {
        "Sequence": "Seq", "Prefix": "Pre", "Domain": "Dom",
        "PenLift": "Pen", "Natural": "Nat", "Lift": "Lift",
    }
    for panel, (field, label, high, kind, header, ytop, ybottom) in enumerate((
        ("first", first_name, first_max, first_kind, 70, 110, 218),
        ("second", second_name, second_max, second_kind, 282, 321, 427),
    )):
        out.append(text(24, header, label, 19, ink, "700"))
        scored = [r[field] for r in rows if r[field] is not None]
        broken = (kind == "error" and len(scored) > 3 and
                  max(scored) > 1.75 * sorted(scored)[len(scored)//2])
        if broken:
            ordinary = [v for v in scored if v < 0.5]
            if not ordinary:
                broken = False
        if broken:
            # V5's 0.967+ outlier is placed in a separately scaled TOP band.
            # The zigzag on the axis makes the scale discontinuity explicit.
            lo = max(0, math.floor((min(ordinary)-.012)*100)/100)
            middle = math.ceil((max(ordinary)+.02)*100)/100
            far = math.ceil((max(scored)+.04)*100)/100
            lower_top, upper_bottom = ytop+38, ytop+25
            def position(value):
                if value <= middle:
                    return ybottom-(value-lo)/(middle-lo)*(ybottom-lower_top)
                if value > .5:
                    return upper_bottom-(value-.5)/(far-.5)*(upper_bottom-ytop)
                raise ValueError("Unexpected score falls into deliberate axis break")
            ticks = [(lo,ybottom),(round((lo+middle)/2,4),
                     position((lo+middle)/2)),(middle,lower_top),
                     (far,ytop)]
            # Two short diagonal cuts alongside the y-axis indicate a break.
            x=left-11
            out.append(f'<path d="M {x-5} {lower_top-6} l 5 -7 l 5 7 '
                       f'm 0 -4 l 5 -7" fill="none" stroke="#64748b" '
                       f'stroke-width="1.8"/>')
        else:
            if scored:
                lo,far=min(scored),max(scored)
                if kind=="percent":
                    lo=max(0,math.floor((lo-1.5)/5)*5)
                    far=min(100,math.ceil((far+1.5)/5)*5)
                else:
                    margin=max(.012,(far-lo)*.12)
                    lo=max(0,math.floor((lo-margin)*100)/100)
                    far=math.ceil((far+margin)*100)/100
                if far<=lo:
                    far=lo+(10 if kind=="percent" else .1)
            else:
                lo,far=0,high
            def position(value):
                return ybottom-(value-lo)/(far-lo)*(ybottom-ytop)
            ticks=[(lo,ybottom),((lo+far)/2,position((lo+far)/2)),(far,ytop)]
        for value,y in ticks:
            out.append(f'<line x1="{left-5:.1f}" y1="{y:.1f}" '
                       f'x2="{right+6:.1f}" y2="{y:.1f}" '
                       f'stroke="{grid}" stroke-width="1"/>')
            out.append(text(left-11, y+4, format_score(value,kind),
                            11, "#667085", anchor="end"))
        coordinates=[]
        for i,row in enumerate(rows):
            value=row[field]
            coordinates.append(None if value is None else (xcoords[i],position(value)))
        for i in range(len(coordinates)-1):
            p,q=coordinates[i],coordinates[i+1]
            if not p or not q:
                continue
            # Do not draw a falsely continuous slope across a broken axis.
            if broken and ((rows[i][field] > .5) != (rows[i+1][field] > .5)):
                continue
            out.append(f'<path d="M {p[0]:.1f} {p[1]:.1f} '
                       f'L {q[0]:.1f} {q[1]:.1f}" '
                       f'fill="none" stroke="#cbd5e1" '
                       f'stroke-width="2.5" stroke-dasharray="5 4"/>')
        for i,row in enumerate(rows):
            x=xcoords[i]
            value=row[field]
            active=row["active"]
            out.append(f'<g data-model="{escape(row["name"])}" '
                       f'data-active="{str(active).lower()}" '
                       f'data-weight="{escape(row["weights"])}" '
                       f'data-metric="{field}">')
            legacy = row.get("legacy")
            desc = format_score(value,kind) if value is not None else (legacy or "not measured")
            out.append(f'<title>{escape(row["name"])}: {escape(desc)}'
                       f' · {escape(row["status"])}</title>')
            if value is None:
                if legacy and panel==0:
                    # Legacy sequence NLL is visible on hover, not on an
                    # inapplicable trajectory graph.
                    out.append(text(x,ybottom-13,"—",17,gray,anchor="middle"))
                else:
                    out.append(text(x,ybottom-13,"—",17,gray,anchor="middle"))
            else:
                y=position(value)
                if not ytop-.01<=y<=ybottom+.01:
                    raise ValueError(f"Out-of-bounds score for {row['name']}: {value}")
                if active:
                    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="12" '
                               'fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>')
                out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                           f'r="{7.5 if active else 6}" '
                           f'fill="{blue if active else "#ffffff"}" '
                           f'stroke="{blue if active else gray}" stroke-width="2.5"/>')
                ty=y-15
                if ty < ytop-2:
                    ty=y+25
                out.append(text(x,ty,format_score(value,kind),
                                13 if active else 11.5,
                                blue if active else ink,
                                "700" if active else "500","middle"))
            name=row["name"]
            chunks=name.split()
            short_name=(short.get(chunks[0],chunks[0])+chunks[1]
                        if len(chunks)==2 and len(rows)>7 else name)
            out.append(text(x,ybottom+26,short_name,13,
                            blue if active else ink,
                            "700" if active else "500","middle"))
            out.append("</g>")
    out.append("</g></svg>")
    DOCS.joinpath(target).write_text("".join(out),encoding="utf-8")

manifest = load("docs/current-models.json")
selected_cnn = manifest.get("recognizer", {}).get("weights")
selected_gru = manifest.get("completer", {}).get("weights")
if not selected_cnn or not selected_gru:
    raise ValueError("Build docs/current-models.json before generating model charts")

cnn1 = load("models/ink-cnn-v1.json")
cnn2 = load("models/recognition-v2-metrics.json")
cnn3 = load("models/recognition-v3-metrics.json")
cnn4 = load("models/recognition-v4-evaluation-summary.json")
cnn5 = load("models/recognition-v5-metrics.json")


def cnn_row(version, uji, emnist, note, status):
    path = f"models/ink-cnn-v{version}.json"
    return {"name": f"CNN V{version}", "first": pct(uji),
            "second": pct(emnist), "subtitle": note,
            "active": selected_cnn == path, "status": status, "weights": path}


recognition = [
    cnn_row(1, None, nested(cnn1, "training", "emnist_test_accuracy"),
            "Original EMNIST model", "SUPERSEDED"),
    cnn_row(2, nested(cnn3, "baseline_v2", "pen_independent", "overall"),
            nested(cnn2, "best", "metrics", "overall"), "Pen-writer baseline", "SUPERSEDED"),
    cnn_row(3, nested(cnn3, "independent_pen_v3", "overall"),
            nested(cnn3, "best", "emnist", "overall"), "Pen-adapted, accepted", "SUPERSEDED"),
    cnn_row(4, nested(cnn4, "independent_uji_v4", "overall"),
            nested(cnn4, "emnist", "overall"), "Four-dataset experiment",
            "REJECTED" if cnn4.get("eligible") is False else "UNVERIFIED"),
    cnn_row(5, nested(cnn5, "independent_pen_v3", "overall"),
            nested(cnn5, "best", "emnist", "overall"), "Unseen-writer improvement",
            "VALIDATED" if cnn5.get("deployable") and cnn5.get("browser_integration_passed")
            else "BROWSER GATE PENDING"),
]
for path in sorted(MODELS.glob("recognition-v*-metrics.json")):
    match = re.fullmatch(r"recognition-v(\d+)-metrics.json", path.name)
    if not match or int(match.group(1)) <= 5:
        continue
    num = int(match.group(1))
    m = load("models/" + path.name)
    result = nested(m, f"independent_pen_v{num}", "overall")
    if result is None:
        result = nested(m, "best", "independent_test", "overall")
    emnist = nested(m, "best", "emnist", "overall")
    recognition.append(cnn_row(num, result, emnist, "Experimental candidate",
                               "VALIDATED" if m.get("deployable") and m.get("browser_integration_passed")
                               else "NOT RELEASED"))
graph(
    "Recognizer",
    "",
    recognition, "Handwriting accuracy", "EMNIST accuracy",
    100, 100, "percent", "percent",
    ["V1 was not scored on the UJI writer split. V4 evidence is preserved from its experiment branch.",
     "A higher standalone accuracy does not authorize deployment without the required browser tests."],
    "recognition-vertical-bars.svg")


seq = load("models/stroke-sequence-v2-metrics.json")
prefix = load("models/stroke-prefix-metrics.json")
domain2 = load("models/stroke-prefix-domain-v2-metrics.json")
pen3 = load("models/penlift-v3-metrics.json")
natural4 = load("models/stroke-natural-v4-metrics.json")
lift5 = load("models/recurrent-lift-v5-metrics.json")


def gru_row(name, weight, error, lift, status, subtitle="", legacy=None, extra=""):
    return {"name": name, "active": selected_gru == weight, "weights": weight,
            "first": error, "second": pct(lift),
            "status": status, "subtitle": subtitle,
            "legacy": legacy, "extra": extra}


completer = [
    gru_row("Sequence V1", "models/ink-stroke-sequence-v1.json", None,
            nested(seq, "baseline_v1", "independent", "pen_lift_f1"),
            "SUPERSEDED", "Original stroke GRU",
            legacy=(f"NLL {nested(seq,'baseline_v1','independent','nll'):.3f}"
                    if nested(seq,'baseline_v1','independent','nll') is not None else None)),
    gru_row("Sequence V2", "models/ink-stroke-sequence-v2.json", None,
            nested(seq, "v2", "independent", "pen_lift_f1"),
            "REJECTED" if seq.get("eligible") is False else "UNVERIFIED",
            "Larger sequence model",
            legacy=(f"NLL {nested(seq,'v2','independent','nll'):.3f}"
                    if nested(seq,'v2','independent','nll') is not None else None)),
    gru_row("Prefix V1", "models/ink-stroke-prefix-v1.json",
            nested(domain2, "baseline", "independent", "prefix_frame_position_error"),
            nested(domain2, "baseline", "independent", "pen_lift_f1"),
            "SUPERSEDED", "Prefix model"),
    gru_row("Domain V2", "models/ink-stroke-prefix-domain-v2.json",
            nested(domain2, "candidate", "independent", "prefix_frame_position_error"),
            nested(domain2, "candidate", "independent", "pen_lift_f1"),
            "SUPERSEDED", "Accepted domain GRU"),
    gru_row("PenLift V3", "models/ink-stroke-penlift-v3.json",
            nested(pen3, "candidate", "prefix_position", "prefix_frame_position_error"),
            nested(pen3, "candidate", "independent", "pen_lift_f1"),
            "REJECTED" if pen3.get("eligible") is False else "UNVERIFIED",
            "Pen-up training experiment"),
]
for version in (3, 4):
    metrics = load(f"models/stroke-prefix-domain-v{version}-metrics.json")
    completer.append(gru_row(
        f"Domain V{version}", f"models/ink-stroke-prefix-domain-v{version}.json",
        nested(metrics, "candidate", "independent", "prefix_frame_position_error"),
        nested(metrics, "candidate", "independent", "pen_lift_f1"),
        "REJECTED" if metrics.get("eligible") is False else "NOT RELEASED",
        "Independent-writer experiment"))
completer.append(gru_row(
    "Natural V4", "models/ink-stroke-natural-v4.json",
    nested(natural4, "candidate", "independent", "prefix_frame_position_error"),
    nested(natural4, "candidate", "independent", "pen_lift_f1"),
    "REJECTED" if natural4.get("eligible") is False else "NOT RELEASED",
    "Natural-motion experiment"))
completer.append(gru_row(
    "Lift V5", "models/ink-stroke-lift-aware-v5.json",
    nested(lift5, "candidate", "position", "prefix_frame_position_error"),
    nested(lift5, "candidate", "independent", "pen_lift_f1"),
    "REJECTED" if lift5.get("eligible") is False else "NOT RELEASED",
    "Pen-lift experiment"))
for version in range(6, 8):
    metrics = load(f"models/stroke-prefix-domain-v{version}-metrics.json")
    completer.append(gru_row(
        f"Domain V{version}", f"models/ink-stroke-prefix-domain-v{version}.json",
        nested(metrics, "candidate", "independent", "prefix_frame_position_error"),
        nested(metrics, "candidate", "independent", "pen_lift_f1"),
        ("REJECTED" if metrics.get("eligible") is False else
         "NOT RELEASED" if metrics else "AWAITING TESTS"),
        "Trial not released" if not metrics else "Independent-writer trial"))
for p in sorted(MODELS.glob("stroke-prefix-domain-v*-metrics.json")):
    match = re.fullmatch(r"stroke-prefix-domain-v(\d+)-metrics.json", p.name)
    if not match or int(match.group(1)) <= 7:
        continue
    v = int(match.group(1))
    metrics = load("models/" + p.name)
    completer.append(gru_row(
        f"Domain V{v}", f"models/ink-stroke-prefix-domain-v{v}.json",
        nested(metrics, "candidate", "independent", "prefix_frame_position_error"),
        nested(metrics, "candidate", "independent", "pen_lift_f1"),
        "VALIDATED" if metrics.get("deployable") and metrics.get("browser_integration_passed")
        else "NOT RELEASED", "Experimental candidate"))
completer.sort(key=lambda item: (
    int(re.search(r"V(\d+)", item["name"]).group(1)),
    {"Sequence": 0, "Prefix": 1, "PenLift": 2, "Domain": 3, "Natural": 4,
     "Lift": 5}.get(item["name"].split()[0], 6)
))
measured_lifts = [x["second"] for x in completer if x["second"] is not None]
lift_scale = max(15, 5 * math.ceil(max(measured_lifts, default=0) / 5))
measured_errors = [x["first"] for x in completer if x["first"] is not None]
error_scale = max(1.1, math.ceil(max(measured_errors, default=0)*10)/10)
graph(
    "Completer",
    "",
    completer, "Trajectory error ↓", "Pen-lift F1 ↑",
    error_scale, lift_scale, "error", "percent",
    ["Sequence V1/V2: only independent legacy sequence NLL is comparable within that pair.",
     "Error and pen-lift F1 are different metrics. A low error alone cannot pass the release gate.",
     "V7 has no published score until training, unseen-writer, and browser acceptance finish."],
    "completion-vertical-bars.svg")
print("PASS: generated two complete version-history SVGs; blue exactly matches deployed-model manifest")
