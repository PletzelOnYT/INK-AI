# Real Chrome offline OCR acceptance

**NOT PASSED:** build or browser OCR needs repair. Do not claim production accuracy.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 2s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.9mb ⚠️

⚡ Done in 160ms
Built completely offline OCR engine: 17756797 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v5.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19521471 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 201.59999999999854, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 148, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 45, 'name': 'dark-on-white-angle-12', 'text': '', 'words': 0}
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-ocr-colors-angles-browser.py", line 88, in <module>
    assert "THREADS" in record["text"].upper(),(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: ('Failed printed text test', {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 45, 'name': 'dark-on-white-angle-12', 'text': '', 'words': 0})
~~~
