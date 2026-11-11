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
    """Two vertically stacked milestone timelines; each panel is one metric.

    Dashed connectors show the measured sequence of experiments, not a
    guaranteed improvement or proof that successive candidates were released.
    Only the exact deployed-model weight from the build manifest gets blue.
    """
    active = [r for r in rows if r["active"]]
    if len(active) != 1:
        raise ValueError(f"{title}: exactly one deployed checkpoint required")
    if len(rows) < 2:
        raise ValueError("Need two or more model milestones")
    width = max(1240, len(rows) * 160 + 180)
    left, right = 112, width - 74
    panel_height = 294
    first_panel = 170
    height = first_panel + 2 * panel_height + 112
    white, ink, muted, grid, blue, gray = (
        "#ffffff", "#111827", "#64748b", "#e2e8f0", "#2563eb", "#94a3b8")
    xcoords = [left + (right-left)*i/(len(rows)-1) for i in range(len(rows))]
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" '
           f'height="{height}" viewBox="0 0 {width} {height}" '
           f'role="img" aria-label="{escape(title)}">',
           rect(0, 0, width, height, white),
           '<g font-family="Arial,Helvetica,sans-serif">',
           text(36, 46, title, 29, ink, "700"),
           text(36, 73, subtitle, 15, muted),
           rect(37, 94, 12, 12, blue, radius=6),
           text(60, 106, "Blue node = model deployed in index.html", 13, ink),
           rect(425, 94, 12, 12, gray, radius=6),
           text(448, 106, "Gray = earlier version / trial", 13, muted),
           text(785, 106, "Dotted line = measured trial history; not guaranteed improvement",
                13, muted),
           text(36, 132, "Milestones ordered by version (not calendar date)", 12, muted)]
    for panel, (field, name, high, kind) in enumerate(
        (("first", first_name, first_max, first_kind),
         ("second", second_name, second_max, second_kind))):
        top = first_panel + panel * panel_height
        plot_top, plot_bottom = top + 46, top + 185
        out.append(text(36, top+4, name, 18, ink, "700"))
        out.append(text(width-40, top+4,
                        "LOWER IS BETTER" if kind == "error" else "HIGHER IS BETTER",
                        12, muted, anchor="end"))
        for grid_index in range(5):
            number = high * grid_index/4
            y = (plot_top + (number/high)*(plot_bottom-plot_top)
                 if kind == "error" else
                 plot_bottom - (number/high)*(plot_bottom-plot_top))
            out.append(f'<line x1="{left-6:.1f}" y1="{y:.1f}" '
                       f'x2="{right+6:.1f}" y2="{y:.1f}" stroke="{grid}"/>')
            out.append(text(left-15, y+4, format_score(number, kind),
                            12, muted, anchor="end"))
        scored = []
        for i, row in enumerate(rows):
            value = row[field]
            if value is None:
                continue
            y = (plot_top + value/high*(plot_bottom-plot_top)
                 if kind == "error" else
                 plot_bottom - value/high*(plot_bottom-plot_top))
            # Axis bounds must include every nonmissing score; do not clip
            # failures merely to make the progress line look better.
            if not plot_top-0.01 <= y <= plot_bottom+0.01:
                raise ValueError(f"Score outside axis: {row['name']} / {name}: {value}")
            scored.append((i, xcoords[i], y))
        # Each dot is a distinct milestone. The dashed link is a visual
        # experiment history rather than a continuous model family.
        for first, second in zip(scored, scored[1:]):
            ax, ay, bx, by = first[1], first[2], second[1], second[2]
            out.append(f'<path d="M {ax:.1f} {ay:.1f} L {bx:.1f} {by:.1f}" '
                       f'fill="none" stroke="#cbd5e1" stroke-width="2.5" '
                       f'stroke-dasharray="7 6" />')
        for i, row in enumerate(rows):
            x = xcoords[i]
            value = row[field]
            used = row["active"]
            out.append(
                f'<g data-model="{escape(row["name"])}" '
                f'data-active="{str(used).lower()}" '
                f'data-weight="{escape(row["weights"])}" '
                f'data-metric="{field}">')
            if value is None:
                if panel == 0 and row.get("legacy"):
                    out.append(text(x, plot_top+26, row["legacy"],
                                    12, muted, anchor="middle"))
                    out.append(text(x, plot_top+44, "different benchmark",
                                    10, muted, anchor="middle"))
                else:
                    out.append(text(x, plot_bottom-9, "unmeasured",
                                    11, muted, anchor="middle"))
            else:
                y = (plot_top + value/high*(plot_bottom-plot_top)
                     if kind == "error" else
                     plot_bottom - value/high*(plot_bottom-plot_top))
                if used:
                    out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="12.5" '
                               f'fill="#dbeafe" stroke="{blue}" stroke-width="2"/>')
                out.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" '
                           f'r="{7.5 if used else 6.5}" '
                           f'fill="{blue if used else white if row["status"]=="REJECTED" else gray}" '
                           f'stroke="{blue if used else gray}" stroke-width="2.6"/>')
                label_y = y - 17
                # Avoid touching the top boundary; place extreme scores below.
                if label_y < plot_top + 4:
                    label_y = y + 24
                out.append(text(x, label_y, format_score(value, kind),
                                14, blue if used else "#334155",
                                "700" if used else "500", "middle"))
            out.append(text(x, plot_bottom+28, row["name"], 13,
                            blue if used else ink, "700" if used else "500",
                            "middle"))
            status = "IN USE" if used else row["status"]
            out.append(text(x, plot_bottom+47, status, 11,
                            blue if used else muted, "700" if used else "400",
                            "middle"))
            out.append("</g>")
    footer_y = first_panel + 2 * panel_height + 11
    for j, note in enumerate(notes):
        out.append(text(36, footer_y+j*24, note, 12, muted))
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
graph(
    "Recognizer — every model version",
    "Two DIFFERENT accuracy benchmarks; higher is better in each column.",
    recognition, "Unseen UJI pen writers · accuracy", "EMNIST · accuracy",
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
            legacy=(f"Legacy NLL {nested(seq,'baseline_v1','independent','nll'):.3f}"
                    if nested(seq,'baseline_v1','independent','nll') is not None else None)),
    gru_row("Sequence V2", "models/ink-stroke-sequence-v2.json", None,
            nested(seq, "v2", "independent", "pen_lift_f1"),
            "REJECTED" if seq.get("eligible") is False else "UNVERIFIED",
            "Larger sequence model",
            legacy=(f"Legacy NLL {nested(seq,'v2','independent','nll'):.3f}"
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
    "Completer — every model version",
    "Writer-disjoint movement error (lower is better) and pen-lift F1 (higher is better).",
    completer, "Free-running position error · lower", "Pen-lift F1 · higher",
    error_scale, lift_scale, "error", "percent",
    ["Sequence V1/V2: only independent legacy sequence NLL is comparable within that pair.",
     "Error and pen-lift F1 are different metrics. A low error alone cannot pass the release gate.",
     "V7 has no published score until training, unseen-writer, and browser acceptance finish."],
    "completion-vertical-bars.svg")
print("PASS: generated two complete version-history SVGs; blue exactly matches deployed-model manifest")
