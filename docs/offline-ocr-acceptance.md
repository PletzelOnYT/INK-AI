# Real Chrome offline OCR acceptance

**PASS:** local standalone HTML preserved genuine print on colored and angled labels while suppressing smooth-wall and shoulder false positives.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 3s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.9mb ⚠️

⚡ Done in 221ms
Built completely offline OCR engine: 17753699 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v5.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19494256 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 205.3000000000029, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 174, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 207, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 51, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 330, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 123, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 362, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 159, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 301, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 240, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 1, 'detected': 180, 'ms': 325, 'text': 'NY THREADS'}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 185, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 320, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 269, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 333, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 181, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 416, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 209, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 120, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 213, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 324, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 175, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'ms': 446, 'pass': 1, 'rotation': -45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 168, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 273, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'ms': 237, 'pass': 1, 'rotation': -90, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'ms': 412, 'pass': 1, 'rotation': -135, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'ms': 99, 'pass': 1, 'rotation': 180, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'ms': 302, 'pass': 1, 'rotation': 35, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 169, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'ms': 266, 'pass': 1, 'rotation': -65, 'source': 'angle-projection', 'text': 'NY THREADS'}
PASS: camera recognizes angled print (-90..180 degrees), white-on-black, blue-on-yellow and blank walls offline
~~~
