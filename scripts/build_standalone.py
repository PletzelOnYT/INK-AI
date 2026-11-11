#!/usr/bin/env python3
"""Build the genuinely offline, self-contained distribution from source files.

The editable src/index.shell.html stays small. The distributable index.html contains
embedded neural weights, word data, JavaScript and CSS.
"""
from pathlib import Path
import sys
import json,os

ROOT=Path(__file__).resolve().parents[1]
html=(ROOT/"src/index.shell.html").read_text(encoding="utf-8")
assert '<script src="./src/app.js" defer></script>' in html
css=(ROOT/"src/app.css").read_text(encoding="utf-8")
app=(ROOT/"src/app.js").read_text(encoding="utf-8")
preference=(ROOT/"src/neural_preference_model.js").read_text(encoding="utf-8")
def accepted_model(version):
    candidate=ROOT/f"models/ink-stroke-prefix-domain-{version}.json"
    report=ROOT/f"models/stroke-prefix-domain-{version}-metrics.json"
    if not (candidate.is_file() and report.is_file()):return False
    metrics=json.loads(report.read_text(encoding="utf-8"))
    return metrics.get("eligible") is True and metrics.get("deployable") is True
# A new candidate can only become the downloaded default after both
# writer-disjoint quality checks and real offline Chrome integration pass.
natural_file=ROOT/"models/ink-stroke-natural-v4.json"
natural_metrics=ROOT/"models/stroke-natural-v4-metrics.json"
def natural_allowed():
    if not(natural_file.is_file() and natural_metrics.is_file()):return False
    metric=json.loads(natural_metrics.read_text())
    return metric.get("eligible") is True and (
        metric.get("browser_integration_passed") is True or
        os.environ.get("INK_STROKE_PREVIEW_V4")=="1")
stroke_path=next((f"models/ink-stroke-prefix-domain-{v}.json"
                  for v in ("v4","v3") if accepted_model(v)),
                 "models/ink-stroke-prefix-domain-v2.json")
if natural_allowed():stroke_path="models/ink-stroke-natural-v4.json"
print("Bundled GRU:",stroke_path)
models=[
 ("inkRecognitionModel","application/json",
  "models/ink-cnn-v3.json"),
 ("inkStrokeModel","application/json",stroke_path),
 ("inkStrokeBackup","application/json","models/ink-stroke-sequence-v1.json"),
 ("inkEnglishWords","text/plain","data/english-words.txt"),
 ("strokeWorkerSource","text/plain","src/stroke_worker.js"),
]
tags=[]
for ident,kind,path in models:
    content=(ROOT/path).read_text(encoding="utf-8")
    if "</script" in content.lower():
        raise ValueError("Unexpected script closing tag in "+path)
    tags.append(f'<script id="{ident}" type="{kind}">{content}</script>')
html=html.replace('<link rel="stylesheet" href="./src/app.css">',
                  '<style>\n'+css+'\n</style>')
html=html.replace('<script src="./src/neural_preference_model.js"></script>', '')
html=html.replace('<script src="./src/app.js" defer></script>',
                  '\n'.join(tags)+'\n<script>\n'+preference+'\n'+app+'\n</script>')
out=ROOT/"dist/ink-ai-standalone.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html,encoding="utf-8")
assert out.stat().st_size>1_400_000 and 'src="./src/app.js"' not in html
print("Built independent offline INK AI:",out, out.stat().st_size,"bytes")
