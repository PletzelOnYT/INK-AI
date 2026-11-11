# Real Chrome offline OCR acceptance

**PASS:** local standalone HTML preserved genuine print on colored and angled labels while suppressing smooth-wall and shoulder false positives.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 2s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.9mb ⚠️

⚡ Done in 180ms
Built completely offline OCR engine: 17741063 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v3.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19479570 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 204, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 184, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 244, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 57, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 252, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 222, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 288, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 157, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 292, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 261, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 2, 'detected': -180, 'ms': 192, 'text': 'NY THREADS'}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 251, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 258, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 230, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 229, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 225, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 241, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 229, 'pass': 1, 'rotation': 12.289066746210056, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 46, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 198, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 225, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 233, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'ms': 247, 'pass': 1, 'rotation': -45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 216, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 207, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'ms': 227, 'pass': 1, 'rotation': -90, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'ms': 271, 'pass': 1, 'rotation': -135, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'ms': 187, 'pass': 2, 'rotation': -180, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'ms': 217, 'pass': 1, 'rotation': 35, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 222, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'ms': 216, 'pass': 1, 'rotation': -65, 'source': 'angle-projection', 'text': 'NY THREADS'}
PASS: camera recognizes angled print (-90..180 degrees), white-on-black, blue-on-yellow and blank walls offline
~~~
