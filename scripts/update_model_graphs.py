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


def podium(title, rows, metric, target):
    """Minimal top-three benchmark podium; rank measured results only.

    Recognizer: independent UJI writer accuracy (%).
    Completer: decrease in trajectory error relative to Prefix V1 (%).
    These are benchmark rankings, NOT claims about deployability.
    """
    if sum(bool(r["active"]) for r in rows) != 1:
        raise ValueError("Exactly one actually deployed model must exist")
    results = []
    if metric == "accuracy":
        for row in rows:
            if row["first"] is not None:
                results.append((row, row["first"]))
    elif metric == "trajectory_improvement":
        baseline = next(
            (r["first"] for r in rows if r["name"] == "Prefix V1"), None)
        if baseline is None or baseline <= 0:
            raise ValueError("The measured Prefix V1 baseline is required")
        for row in rows:
            # Sequence V1/V2 have a different metric. Do not manufacture %.
            if row["first"] is not None:
                results.append((row, 100*(baseline-row["first"])/baseline))
    else:
        raise ValueError("Unsupported benchmark " + metric)
    ordered = sorted(results, key=lambda e: (-e[1], e[0]["name"]))[:3]
    if len(ordered) != 3:
        raise ValueError("At least three comparable measured models required")
    width, height = 900, 394
    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" '
        f'width="{width}" height="{height}" viewBox="0 0 {width} {height}" '
        f'role="img" aria-label="{escape(title)} — top three measured versions">',
        rect(0, 0, width, height, "#ffffff"),
        '<defs>',
        '<linearGradient id="ink-gold" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#FCE7A5"/>'
        '<stop offset="1" stop-color="#EAB84A"/></linearGradient>',
        '<linearGradient id="ink-silver" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#E9EDF2"/>'
        '<stop offset="1" stop-color="#B6C0CE"/></linearGradient>',
        '<linearGradient id="ink-bronze" x1="0" y1="0" x2="1" y2="1">'
        '<stop offset="0" stop-color="#EDC3A1"/>'
        '<stop offset="1" stop-color="#CA8961"/></linearGradient>',
        '</defs>',
        '<g font-family="Arial,Helvetica,sans-serif">',
        '<line x1="52" y1="362" x2="848" y2="362" '
        'stroke="#D9DEE7" stroke-width="2"/>',
    ]
    placement = {
        1: (336, 100, 228, 260, "ink-gold", "#9A6D12"),
        2: (77, 154, 228, 206, "ink-silver", "#6F7C8D"),
        3: (595, 194, 228, 166, "ink-bronze", "#965935"),
    }
    for rank, (row, score) in enumerate(ordered, 1):
        x, y, w, h, shade, trim = placement[rank]
        cx = x + w/2
        active = "true" if row["active"] else "false"
        out.append(
            f'<g data-model="{escape(row["name"])}" '
            f'data-weight="{escape(row["weights"])}" '
            f'data-rank="{rank}" data-active="{active}" '
            f'data-score="{score:.6f}" data-status="{escape(row["status"])}">')
        out.append(
            f'<title>{escape(row["name"])}: {score:.2f}% · '
            f'{escape(row["status"])}'
            f'{" · CURRENT MODEL" if row["active"] else ""}</title>')
        out.append(rect(x, y, w, h, f"url(#{shade})", radius=14))
        out.append(
            f'<rect x="{x+3:.0f}" y="{y+3:.0f}" width="{w-6:.0f}" '
            f'height="{h-6:.0f}" rx="11" fill="none" '
            f'stroke="{trim}" stroke-opacity="0.40" stroke-width="1.5"/>')
        out.append(f'<circle cx="{cx:.0f}" cy="{y+16:.0f}" r="25" '
                   f'fill="#FFFFFF" stroke="{trim}" stroke-width="3"/>')
        out.append(text(cx, y+26, str(rank), 25, trim, "700", "middle"))
        out.append(text(cx, y+91, row["name"], 25, "#1A2432", "700", "middle"))
        out.append(text(cx, y+139, f"{score:.2f}%", 35, "#1A2432", "700",
                        "middle"))
        if row["active"]:
            # A small blue underline denotes the shipped checkpoint without
            # adding another label to the simple three-name podium.
            out.append(rect(cx-26, y+154, 52, 6, "#2563EB", radius=3))
        out.append("</g>")
    out.append("</g></svg>")
    DOCS.joinpath(target).write_text("".join(out), encoding="utf-8")

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
podium("Recognizer", recognition, "accuracy",
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
podium("Completer", completer, "trajectory_improvement",
       "completion-vertical-bars.svg")
print("PASS: generated two three-model medal podiums from measured benchmarks")
