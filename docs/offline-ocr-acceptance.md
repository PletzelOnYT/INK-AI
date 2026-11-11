# Real Chrome offline OCR acceptance

**NOT PASSED:** build or browser OCR needs repair. Do not claim production accuracy.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 3s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.8mb ⚠️

⚡ Done in 201ms
Built completely offline OCR engine: 17664329 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19397222 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 253.40000000000873, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 169, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 261, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 48, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 257, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 234, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 325, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 190, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 351, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 262, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 2, 'detected': -180, 'ms': 258, 'text': 'NY THREADS'}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 337, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 292, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 294, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 304, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 295, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 308, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 226, 'pass': 1, 'rotation': 12.289066746210056, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 60, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 202, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 279, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 306, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 45 [{'evidence': {'accepted': 3, 'rejected': 0}, 'hint': 45, 'passMs': 318, 'rotation': -30, 'source': 'angle-projection', 'text': 'Ny THR EApg'}, {'evidence': {'accepted': 3, 'rejected': 0}, 'hint': None, 'passMs': 65, 'rotation': -30, 'source': 'tracked', 'text': 'Ny THR EApg'}, {'evidence': {'accepted': 3, 'rejected': 0}, 'hint': None, 'passMs': 62, 'rotation': -30, 'source': 'tracked', 'text': 'Ny THR EApg'}, {'evidence': {'accepted': 3, 'rejected': 0}, 'hint': None, 'passMs': 63, 'rotation': -30, 'source': 'tracked', 'text': 'Ny THR EApg'}, {'evidence': {'accepted': 3, 'rejected': 0}, 'hint': 45, 'passMs': 312, 'rotation': -30, 'source': 'angle-projection', 'text': 'Ny THR EApg'}]
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 353, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 275, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'ms': 228, 'pass': 1, 'rotation': -90, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'ms': 270, 'pass': 1, 'rotation': -135, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'ms': 189, 'pass': 2, 'rotation': -180, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES -35 [{'evidence': {'accepted': 1, 'rejected': 0}, 'hint': -35, 'passMs': 370, 'rotation': 0, 'source': 'upright', 'text': 'RY'}, {'evidence': {'accepted': 1, 'rejected': 0}, 'hint': -35, 'passMs': 364, 'rotation': 0, 'source': 'upright', 'text': 'RY'}, {'evidence': {'accepted': 1, 'rejected': 0}, 'hint': -35, 'passMs': 364, 'rotation': 0, 'source': 'upright', 'text': 'RY'}, {'evidence': {'accepted': 1, 'rejected': 0}, 'hint': -35, 'passMs': 363, 'rotation': 0, 'source': 'upright', 'text': 'RY'}, {'evidence': {'accepted': 1, 'rejected': 0}, 'hint': -35, 'passMs': 366, 'rotation': 0, 'source': 'upright', 'text': 'RY'}]
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 280, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'failure': 'WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES'}
OBLIQUE FAIL FRAMES 65 [{'evidence': {'accepted': 0, 'rejected': 0}, 'hint': 65, 'passMs': 445, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': 65, 'passMs': 455, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': 65, 'passMs': 444, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': 65, 'passMs': 455, 'rotation': 0, 'source': 'upright', 'text': ''}, {'evidence': {'accepted': 0, 'rejected': 0}, 'hint': 65, 'passMs': 444, 'rotation': 0, 'source': 'upright', 'text': ''}]
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-oblique-browser.py", line 92, in <module>
    assert not failed, f"{len(failed)} angled OCR fixtures failed: "+str(
           ^^^^^^^^^^
AssertionError: 3 angled OCR fixtures failed: [(45, '#ffffff'), (-35, '#17191c'), (65, '#17191c')]
~~~
