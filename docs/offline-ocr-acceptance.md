# Real Chrome offline OCR acceptance

**NOT PASSED:** build or browser OCR needs repair. Do not claim production accuracy.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 2s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.8mb ⚠️

⚡ Done in 190ms
Built completely offline OCR engine: 17658324 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19371200 bytes
OFFLINE OCR RESULT: {'elapsedMs': 204.5, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'ms': 176, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 42, 'name': 'dark-on-white-angle-12', 'text': '', 'words': 0}
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-ocr-colors-angles-browser.py", line 63, in <module>
    assert "THREADS" in record["text"].upper(),(
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: ('Failed printed text test', {'ms': 42, 'name': 'dark-on-white-angle-12', 'text': '', 'words': 0})
~~~
