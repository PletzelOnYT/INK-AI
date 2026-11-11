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
    """Compact milestone lines. Names and real scores only; detailed data in SVG tooltips."""
    if sum(row["active"] for row in rows) != 1:
        raise ValueError("Exactly one model per chart must be the deployed checkpoint")
    # Keep the wide version histories readable in GitHub's narrower README.
    width = 1000 if len(rows) <= 6 else 1260
    height = 572
    left, right = 95, width - 40
    xs = [left + (right-left)*i/(len(rows)-1) for i in range(len(rows))]
    blue, gray, ink, faint = "#2563eb", "#94a3b8", "#172033", "#e5e7eb"
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" '
        f'viewBox="0 0 {width} {height}" role="img" aria-label="{escape(title)}">',
        rect(0, 0, width, height, "#ffffff"),
        '<g font-family="Arial,Helvetica,sans-serif">',
        text(30, 43, title.replace(" — every model version", ""), 30, ink, "700"),
        '<circle cx="36" cy="66" r="6" fill="#2563eb"/>',
        text(49, 71, "In use", 14, blue, "600"),
    ]
    panel_top = (96, 315)
    for panel, (key, label, scale, kind) in enumerate((
        ("first", first_name, first_max, first_kind),
        ("second", second_name, second_max, second_kind))):
        top = panel_top[panel]
        ytop, ybottom = top + 42, top + 155
        out.append(text(30, top+10, label, 19, ink, "600"))
        valid = [row[key] for row in rows if row[key] is not None]
        # Each panel has an honest visible scale, tightly framing the scores.
        # We do not invent missing values or clip poor-performing trials.
        if valid:
            lo, hi = min(valid), max(valid)
            if kind == "percent":
                lo = max(0, math.floor((lo - 1.5)/5)*5)
                hi = min(100, math.ceil((hi + 1.5)/5)*5)
            else:
                margin = max(.02, (hi-lo)*.16)
                lo = max(0, math.floor((lo-margin)*100)/100)
                hi = math.ceil((hi+margin)*100)/100
            if hi <= lo:
                hi = lo + (10 if kind == "percent" else .1)
        else:
            lo, hi = 0, scale
        for t in range(3):
            v = lo+(hi-lo)*t/2
            yy = ybottom - (v-lo)/(hi-lo)*(ybottom-ytop)
            out.append(f'<line x1="{left-9:.1f}" y1="{yy:.1f}" '
                       f'x2="{right+9:.1f}" y2="{yy:.1f}" '
                       f'stroke="{faint}" stroke-width="1"/>')
            out.append(text(left-15, yy+5, format_score(v,kind),
                            12, "#667085", anchor="end"))
        # A dash between consecutive measured versions is a timeline, not a
        # claim of monotonic progress. Missing measurements break the line.
        positions = []
        for i, row in enumerate(rows):
            value = row[key]
            positions.append(
                None if value is None
                else (xs[i],ybottom-(value-lo)/(hi-lo)*(ybottom-ytop)))
        for p, q in zip(positions, positions[1:]):
            if p and q:
                out.append(f'<path d="M {p[0]:.1f} {p[1]:.1f} L {q[0]:.1f} {q[1]:.1f}" '
                           f'fill="none" stroke="#cbd5e1" stroke-width="2.5" '
                           f'stroke-dasharray="5 4"/>')
        for i, row in enumerate(rows):
            x, value = xs[i], row[key]
            active = row["active"]
            out.append(f'<g data-model="{escape(row["name"])}" '
                       f'data-active="{str(active).lower()}" '
                       f'data-weight="{escape(row["weights"])}" data-metric="{key}">')
            details = (f'{row["name"]} | {row["status"]} | {label}: '
                       f'{format_score(value,kind) if value is not None else row.get("legacy") or "N/A"}')
            out.append(f'<title>{escape(details)}</title>')
            if value is None:
                # Legacy sequence models have an NLL rather than a trajectory
                # measurement; display the actual NLL without faking a dot.
                legacy = row.get("legacy") if key == "first" else None
                if legacy:
                    out.append(text(x, ybottom-12, legacy, 12, "#667085",
                                    anchor="middle"))
                else:
                    out.append(text(x, ybottom-12, "—", 18, gray, anchor="middle"))
            else:
                y = positions[i][1]
                if active:
                    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="13" '
                               'fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>')
                out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                           f'r="{8 if active else 6.5}" '
                           f'fill="{blue if active else "#ffffff"}" '
                           f'stroke="{blue if active else gray}" stroke-width="2.8"/>')
                score_y = y-18
                if score_y < ytop+5:
                    score_y = y+30
                out.append(text(x, score_y, format_score(value,kind),
                                15 if active else 13, blue if active else ink,
                                "700" if active else "500", "middle"))
            if panel == 1:
                label_name = row["name"].replace("Sequence ","Seq ").replace(
                    "Prefix ","Pre ").replace("Domain ","Dom ").replace(
                    "PenLift ","Pen ").replace("Natural ","Nat ").replace("Lift ","Lift ")
                out.append(text(x, ybottom+29, label_name,
                                15 if active else 13,
                                blue if active else ink,
                                "700" if active else "500", "middle"))
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
