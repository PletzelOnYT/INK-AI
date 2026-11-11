# Real Chrome offline OCR acceptance

**NOT PASSED:** build or browser OCR needs repair. Do not claim production accuracy.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 3s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.9mb ⚠️

⚡ Done in 235ms
Built completely offline OCR engine: 17747602 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v5.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19488159 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 220.30000000001746, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 176, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 170, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 70, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 218, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 94, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 283, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 165, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 240, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 235, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 3, 'detected': -180, 'ms': 284, 'text': 'NY THREADS'}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 183, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 235, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 278, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 244, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 179, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 335, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 149, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 45, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 167, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 246, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 180, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'ms': 354, 'pass': 1, 'rotation': -45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 169, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 194, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 90 [{'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 186, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 241, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 135, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 240, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 136, 'rotation': 0, 'source': 'upright', 'text': ''}]
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 135 [{'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 234, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 203, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 241, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 154, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 320, 'rotation': 0, 'source': 'upright', 'text': ''}]
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 180 [{'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 95, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 161, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 181, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 233, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 98, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}]
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'ms': 291, 'pass': 1, 'rotation': 35, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 168, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'ms': 231, 'pass': 1, 'rotation': -65, 'source': 'angle-projection', 'text': 'NY THREADS'}
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-oblique-browser.py", line 92, in <module>
    assert not failed, f"{len(failed)} angled OCR fixtures failed: "+str(
           ^^^^^^^^^^
AssertionError: 3 angled OCR fixtures failed: [(90, '#ffffff'), (135, '#ffffff'), (180, '#ffffff')]
~~~
