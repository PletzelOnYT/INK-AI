#!/usr/bin/env python3
"""Embed a quality-approved V4 CNN in the existing offline INK AI HTML.

This script only changes the model asset and fallback loader, never the
drawing controls, neural stroke generator, original ink or gray suggestions.
It refuses to operate if the independent-writer gates failed.
"""
from __future__ import annotations
import json,re
from pathlib import Path

def replace_one(text,before,after,description):
    if text.count(before)!=1:
        raise RuntimeError("Unexpected index.html structure at "+description)
    return text.replace(before,after)

def main():
    metrics=json.loads(Path("models/recognition-v4-metrics.json").read_text())
    if not metrics.get("eligible") or not all(metrics["quality_gates"].values()):
        raise RuntimeError("Only an independently validated V4 model can be embedded")
    candidate=json.loads(Path("models/ink-cnn-v4.json").read_text())
    v3=json.loads(Path("models/ink-cnn-v3.json").read_text())
    assert candidate["format"]=="ink-cnn-int8-v1"
    assert candidate["labels"]==v3["labels"]
    assert candidate["input"]==[1,32,32]
    assert len(candidate["layers"])==5
    assert candidate["training"]["finetuned_from"]=="models/ink-cnn-v3.json"
    assert metrics["independent_uji_v4"]["overall"]>=(
       metrics["baseline_v3"]["pen_independent"]["overall"]+.008)
    candidate["training"]["uji_independent_accuracy"]=metrics["independent_uji_v4"]["overall"]
    candidate["training"]["uji_independent_glyphs"]=metrics["source_counts"]["uji_independent"]
    model_json=json.dumps(candidate,separators=(",",":"),ensure_ascii=False)
    Path("models/ink-cnn-v4.json").write_text(model_json,encoding="utf8")

    html_path=Path("index.html")
    html=html_path.read_text(encoding="utf8")
    match=re.search(
      r'(<script id="inkRecognitionModel" type="application/json">)'
      r'([\s\S]*?)(</script>)',html)
    if not match:raise RuntimeError("No offline CNN JSON to replace")
    embedded=json.loads(match.group(2))
    if embedded["training"].get("finetuned_from")!="models/ink-cnn-v2.json":
        raise RuntimeError("Refusing to overwrite unexpected embedded CNN")
    # Prevent a future JSON field from accidentally closing the HTML script.
    escaped=model_json.replace("<",r"\u003c")
    html=html[:match.start(2)]+escaped+html[match.end(2):]
    html=replace_one(html,
       'const RECOGNITION_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v3.json";',
       'const RECOGNITION_V3_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v3.json";\n'
       'const RECOGNITION_V4_URL="https://raw.githubusercontent.com/PletzelOnYT/INK-AI/main/models/ink-cnn-v4.json";',
       "V4 URL")
    html=replace_one(html,
       '  const candidates=[\n   {version:3,relative:"models/ink-cnn-v3.json",remote:RECOGNITION_V3_URL,',
       '  const candidates=[\n'
       '   {version:4,relative:"models/ink-cnn-v4.json",remote:RECOGNITION_V4_URL,\n'
       '       parent:"models/ink-cnn-v3.json"},\n'
       '   {version:3,relative:"models/ink-cnn-v3.json",remote:RECOGNITION_V3_URL,',
       "fallback precedence")
    html=replace_one(html,
       '       candidate.training?.finetuned_from==="models/ink-cnn-v2.json"&&\n'
       '       candidate.labels?.length===102&&candidate.input?.join(",")==="1,32,32"){\n'
       '      model=candidate;version=3;',
       '       ["models/ink-cnn-v2.json","models/ink-cnn-v3.json"].includes(\n'
       '          candidate.training?.finetuned_from)&&\n'
       '       candidate.labels?.length===102&&candidate.input?.join(",")==="1,32,32"){\n'
       '      model=candidate;\n'
       '      version=candidate.training.finetuned_from==="models/ink-cnn-v3.json"?4:3;',
       "offline model validation")
    if "drawCorrectionGlyph" in html or 'id="acceptCorrection"' in html:
        raise RuntimeError("Refusing to reintroduce the printed-font UI")
    assert html.count('id="inkRecognitionModel"')==1
    assert html.count('id="strokeWorkerSource"')==1
    html_path.write_text(html,encoding="utf8")

    smoke=Path("tests/browser-smoke.py")
    body=smoke.read_text()
    before='    if Path("models/ink-cnn-v3.json").is_file():\n'
    after=('    if Path("models/ink-cnn-v4.json").is_file():\n'
           '        assert driver.execute_script("return window.__inkRecognitionVersion===4"),'
           '"Independently validated V4 was not loaded"\n'
           '    elif Path("models/ink-cnn-v3.json").is_file():\n')
    smoke.write_text(replace_one(body,before,after,"Chrome recognition version"))
    offline=Path("tests/continuation-offline-browser.py")
    body=offline.read_text()
    offline.write_text(replace_one(body,
        '    assert driver.execute_script("return window.__inkRecognitionVersion===3")',
        '    assert driver.execute_script("return window.__inkRecognitionVersion>=3")',
        "offline recognition version"))
    print("PACKAGED V4: validated original-label CNN, unchanged original UI and neural assist")
if __name__=="__main__":main()
