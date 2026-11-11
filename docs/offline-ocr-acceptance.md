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

⚡ Done in 121ms
Built completely offline OCR engine: 17660220 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19391722 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 163.5, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 122, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 72, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 35, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 107, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 172, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 83, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 105, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'error': 'No THREADS within seven scans'}
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-sideways-browser.py", line 50, in <module>
    assert "THREADS" in entry.get("text","").upper(),entry
           ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
AssertionError: {'angle': 90, 'error': 'No THREADS within seven scans'}
~~~
