"""Offline packaging test; only fake local weights in a temporary directory."""
from __future__ import annotations
import importlib.util, json, os, re, shutil, tempfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location("package_recognition_v4",
 ROOT/"src/package_recognition_v4.py")
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

v3=json.loads((ROOT/"models/ink-cnn-v3.json").read_text())
with tempfile.TemporaryDirectory() as temp:
    root=Path(temp)
    (root/"models").mkdir()
    (root/"tests").mkdir()
    shutil.copy2(ROOT/"index.html",root/"index.html")
    for name in ("browser-smoke.py","continuation-offline-browser.py"):
        shutil.copy2(ROOT/"tests"/name,root/"tests"/name)
    shutil.copy2(ROOT/"models/ink-cnn-v3.json",root/"models/ink-cnn-v3.json")
    dummy=json.loads(json.dumps(v3))
    dummy["training"]["finetuned_from"]="models/ink-cnn-v3.json"
    (root/"models/ink-cnn-v4.json").write_text(json.dumps(dummy))
    counts={"uji_independent":1551}
    base={"pen_independent":{"overall":.764668}}
    report={"eligible":False,"quality_gates":{"better":True},
        "independent_uji_v4":{"overall":.80},
        "baseline_v3":base,"source_counts":counts}
    (root/"models/recognition-v4-metrics.json").write_text(json.dumps(report))
    previous=os.getcwd()
    try:
        os.chdir(root)
        original=(root/"index.html").read_bytes()
        try:
            module.main()
            raise AssertionError("Must reject unapproved experimental weights")
        except RuntimeError as e:
            assert "validated" in str(e)
        assert (root/"index.html").read_bytes()==original
        report["eligible"]=True
        (root/"models/recognition-v4-metrics.json").write_text(json.dumps(report))
        module.main()
        html=(root/"index.html").read_text()
        embedded=re.search(
            r'<script id="inkRecognitionModel" type="application/json">([\s\S]*?)</script>',
            html).group(1)
        assert json.loads(embedded)["training"]["finetuned_from"]=="models/ink-cnn-v3.json"
        assert 'version=candidate.training.finetuned_from==="models/ink-cnn-v3.json"?4:3;' in html
        assert "RECOGNITION_V4_URL" in html
        assert "rgba(55,55,55,0.30)" in html
        assert "drawCorrectionGlyph" not in html
        assert "type:\"vector-completion\"" in html
        assert "window.__inkRecognitionVersion===4" in (root/"tests/browser-smoke.py").read_text()
        assert "window.__inkRecognitionVersion>=3" in (root/"tests/continuation-offline-browser.py").read_text()
        assert abs(json.loads((root/"models/ink-cnn-v4.json").read_text())
            ["training"]["uji_independent_accuracy"]-.80)<1e-8
    finally:
        os.chdir(previous)
print("PASS: V4 offline packager refuses unapproved models and keeps original gray neural UI")
