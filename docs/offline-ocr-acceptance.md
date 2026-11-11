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

⚡ Done in 190ms
Built completely offline OCR engine: 17747602 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v5.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19488159 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 267.0999999999767, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 173, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 209, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 60, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 205, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 95, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 312, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 164, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 258, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 259, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 3, 'detected': -180, 'ms': 325, 'text': 'NY THREADS'}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 214, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 254, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 296, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 277, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 205, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 389, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 177, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 54, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 203, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 294, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 202, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'ms': 411, 'pass': 1, 'rotation': -45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 198, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 226, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 90 [{'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 216, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 271, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 162, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 285, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -90, 'passMs': 160, 'rotation': 0, 'source': 'upright', 'text': ''}]
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 135 [{'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 271, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 246, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 290, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 187, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': -45, 'passMs': 355, 'rotation': 0, 'source': 'upright', 'text': ''}]
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 180 [{'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 115, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 185, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 217, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 270, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}, {'evidence': {'accepted': 2, 'rejected': 0}, 'hint': 0, 'passMs': 116, 'rotation': 0, 'source': 'upright', 'text': 'SAVv3IdHL AN'}]
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'ms': 358, 'pass': 1, 'rotation': 35, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 206, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'ms': 271, 'pass': 1, 'rotation': -65, 'source': 'angle-projection', 'text': 'NY THREADS'}
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-oblique-browser.py", line 92, in <module>
    assert not failed, f"{len(failed)} angled OCR fixtures failed: "+str(
           ^^^^^^^^^^
AssertionError: 3 angled OCR fixtures failed: [(90, '#ffffff'), (135, '#ffffff'), (180, '#ffffff')]
~~~
