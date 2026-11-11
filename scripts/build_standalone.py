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
html=html.replace('<script src="./src/camera_tracking.js" defer></script>', '')
html=html.replace('<script src="./src/camera_text_detector.js" defer></script>', '')
html=html.replace('<script src="./src/camera_line_runtime.js" defer></script>', '')
html=html.replace('<script src="./src/camera_text_evidence.js" defer></script>', '')
html=html.replace('<script src="./src/camera_document_layout.js" defer></script>', '')
html=html.replace('<script src="./src/camera_handwriting.js" defer></script>', '')
html=html.replace('<script src="./src/camera_offline_bridge.js" defer></script>', '')
html=html.replace('<script src="./src/camera_ocr.js" defer></script>', '')
# Preserve attribution directly in the single distributable HTML as well
# as in the editable GitHub repository.
from html import escape as html_escape
notice=(ROOT/"third_party/OCR_NOTICE.md").read_text(encoding="utf-8")
html=html.replace("</head>",'<script id="inkOcrAttribution" type="text/plain">'+
                  html_escape(notice)+'</script>\n</head>')
css=(ROOT/"src/app.css").read_text(encoding="utf-8")
app=(ROOT/"src/app.js").read_text(encoding="utf-8")
camera=(ROOT/"src/camera_ocr.js").read_text(encoding="utf-8")
tracking=(ROOT/"src/camera_tracking.js").read_text(encoding="utf-8")
scene=(ROOT/"src/camera_text_detector.js").read_text(encoding="utf-8")
line_runtime=(ROOT/"src/camera_line_runtime.js").read_text(encoding="utf-8")
text_evidence=(ROOT/"src/camera_text_evidence.js").read_text(encoding="utf-8")
document_layout=(ROOT/"src/camera_document_layout.js").read_text(encoding="utf-8")
handwriting=(ROOT/"src/camera_handwriting.js").read_text(encoding="utf-8")
offline_bridge=(ROOT/"src/camera_offline_bridge.js").read_text(encoding="utf-8")
ocr_bundle_file=ROOT/"dist/ink-offline-ocr.js"
if not ocr_bundle_file.is_file():
    raise RuntimeError("Offline WASM OCR missing: run npm install && npm run build:ocr first")
ocr_bundle=ocr_bundle_file.read_text(encoding="utf-8")
if len(ocr_bundle)<2_000_000:
    raise RuntimeError("Offline OCR model is missing from the distributable")
ocr_bundle=ocr_bundle.replace("</script", "<\\/script")
preference=(ROOT/"src/neural_preference_model.js").read_text(encoding="utf-8")
def accepted_model(version):
    candidate=ROOT/f"models/ink-stroke-prefix-domain-{version}.json"
    report=ROOT/f"models/stroke-prefix-domain-{version}-metrics.json"
    if not (candidate.is_file() and report.is_file()):return False
    metrics=json.loads(report.read_text(encoding="utf-8"))
    return (metrics.get("eligible") is True and
            metrics.get("deployable") is True and
            metrics.get("browser_integration_passed") is True and
            metrics.get("candidate",{}).get("independent",{})
              .get("prefix_frame_position_error") is not None)
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
lift_weights=ROOT/"models/ink-stroke-lift-aware-v5.json"
lift_report=ROOT/"models/recurrent-lift-v5-metrics.json"
if lift_weights.is_file() and lift_report.is_file():
    lift_metrics=json.loads(lift_report.read_text(encoding="utf-8"))
    if lift_metrics.get("eligible") is True and (
        lift_metrics.get("browser_integration_passed") is True or
        os.environ.get("INK_STROKE_PREVIEW_LIFT_V5")=="1"):
        stroke_path="models/ink-stroke-lift-aware-v5.json"
# V6 remains an experiment until both the held-out writer benchmark and
# real browser trajectory integration are recorded as passing. A failed
# training job must NEVER silently replace the model users already have.
v6_file=ROOT/"models/ink-stroke-prefix-domain-v6.json"
v6_report=ROOT/"models/stroke-prefix-domain-v6-metrics.json"
if v6_file.is_file():
    candidate_report=json.loads(v6_report.read_text()) if v6_report.is_file() else {}
    if (candidate_report.get("eligible") is True and
        candidate_report.get("deployable") is True and
        candidate_report.get("browser_integration_passed") is True):
        stroke_path="models/ink-stroke-prefix-domain-v6.json"
    elif os.environ.get("INK_STROKE_PREVIEW_V6")=="1":
        stroke_path="models/ink-stroke-prefix-domain-v6.json"
# V7 may replace the published GRU ONLY after independent real-writer
# pen-lift, EOS and trajectory benchmarks AND actual Chrome path acceptance.
v7_file=ROOT/"models/ink-stroke-prefix-domain-v7.json"
v7_report=ROOT/"models/stroke-prefix-domain-v7-metrics.json"
if v7_file.is_file():
    trial=json.loads(v7_report.read_text()) if v7_report.is_file() else {}
    if (trial.get("eligible") is True and
        trial.get("deployable") is True and
        trial.get("browser_integration_passed") is True):
        stroke_path="models/ink-stroke-prefix-domain-v7.json"
    elif os.environ.get("INK_STROKE_PREVIEW_V7")=="1":
        stroke_path="models/ink-stroke-prefix-domain-v7.json"
print("Bundled GRU:",stroke_path)
# V5 is a genuine trained CNN. Its writer-disjoint score alone is not enough
# to ship it. Real offline-browser validation must publish the acceptance flag.
recognition_path="models/ink-cnn-v3.json"
v5_weights=ROOT/"models/ink-cnn-v5.json"
v5_metrics=ROOT/"models/recognition-v5-metrics.json"
if v5_weights.is_file() and v5_metrics.is_file():
    report=json.loads(v5_metrics.read_text())
    valid=(report.get("eligible") is True and
           report.get("independent_pen_v3",{}).get("overall",0)>=.77 and
           report.get("best",{}).get("emnist",{}).get("overall",0)>=.82)
    v3_report=json.loads((ROOT/"models/recognition-v3-metrics.json").read_text())
    better_than_active=(report.get("independent_pen_v3",{}).get("overall",0)>
                        v3_report.get("independent_pen_v3",{}).get("overall",1))
    if valid and better_than_active and (
        report.get("deployable") is True and
        report.get("browser_integration_passed") is True or
        os.environ.get("INK_RECOGNIZER_PREVIEW_V5")=="1"):
        recognition_path="models/ink-cnn-v5.json"
print("Bundled recognizer:",recognition_path)
# Produce a machine-readable record of what this downloadable HTML actually uses.
# The graphs include candidates, but this manifest identifies deployed weights.
def checkpoint_record(name):
    p=ROOT/"models"/name
    return json.loads(p.read_text()) if p.is_file() else {}
cnn_version="v5" if recognition_path.endswith("v5.json") else "v3"
cnn_report=checkpoint_record(f"recognition-{cnn_version}-metrics.json")
cnn_measured=(cnn_report.get("independent_pen_v3",{}) if cnn_version=="v5"
              else cnn_report.get("independent_pen_v3",{})).get("overall")
gru_version="v7" if stroke_path.endswith("prefix-domain-v7.json") else "v2" if stroke_path.endswith("prefix-domain-v2.json") else "other"
gru_report=checkpoint_record(f"stroke-prefix-domain-{gru_version}-metrics.json") if gru_version!="other" else {}
gru_error=gru_report.get("candidate",{}).get("independent",{}).get("prefix_frame_position_error")
manifest={"format":"ink-ai-deployed-models-v1",
          "recognizer":{"weights":recognition_path,"heldout_writer_accuracy":cnn_measured},
          "completer":{"weights":stroke_path,"heldout_writer_trajectory_error":gru_error},
          "note":"These are the actual neural checkpoints bundled into the standalone HTML. Other research checkpoints are not automatically released."}
model_manifest=ROOT/"docs/current-models.json"
model_manifest.parent.mkdir(exist_ok=True)
model_manifest.write_text(json.dumps(manifest,indent=2)+"\n",encoding="utf-8")
models=[
 ("inkRecognitionModel","application/json",
  recognition_path),
 ("inkStrokeModel","application/json",stroke_path),
 ("inkStrokeBackup","application/json","models/ink-stroke-sequence-v1.json"),
 ("inkEnglishWords","text/plain","data/english-words.txt"),
 ("strokeWorkerSource","text/plain","src/stroke_worker.js"),
]
# Include the locally trained printed-character CNN when the checked-in
# checkpoint exists; keep older source builds functional until it is trained.
if (ROOT/"models/ink-print-cnn-v1.json").is_file():
    models.append(("inkPrintModel","application/json","models/ink-print-cnn-v1.json"))
# Dedicated native text-vs-background CNN (published only after synthetic tests).
if (ROOT/"models/ink-camera-textness-v1.json").is_file():
    models.append(("inkTextnessModel","application/json","models/ink-camera-textness-v1.json"))
if (ROOT/"models/ink-native-line-ctc-v1.json").is_file():
    models.append(("inkLineModel","application/json","models/ink-native-line-ctc-v1.json"))
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
                  '\n'.join(tags)+'\n<script>\n'+preference+'\n'+app+'\n'+tracking+'\n'+scene+'\n'+line_runtime+'\n'+ocr_bundle+'\n'+text_evidence+'\n'+document_layout+'\n'+handwriting+'\n'+offline_bridge+'\n'+camera+'\n</script>')
out=ROOT/"dist/ink-ai-standalone.html"
out.parent.mkdir(exist_ok=True)
out.write_text(html,encoding="utf-8")
assert out.stat().st_size>1_400_000 and 'src="./src/app.js"' not in html
print("Built independent offline INK AI:",out, out.stat().st_size,"bytes")
