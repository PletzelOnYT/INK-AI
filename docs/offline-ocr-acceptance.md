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

⚡ Done in 151ms
Built completely offline OCR engine: 17758582 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Bundled recognizer: models/ink-cnn-v5.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19528971 bytes
PASS: camera word spaces, punctuation, line wraps, columns, paragraph breaks and printed addresses
PASS: light/dark text angle estimates from -180° to 180° and exact word highlight backprojection
PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state
PASS: text edges on both polarities; smooth shoulders, walls, lone seams and lone letters rejected
PASS: confidently hallucinated wall/shoulder words rejected; genuine print preserved
OFFLINE OCR RESULT: {'elapsedMs': 161.1999999999971, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 130, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 188, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'evidence': {'accepted': 2, 'rejected': 0}, 'ms': 56, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 226, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 156, 'name': 'smooth-shoulder', 'text': '', 'words': 0}
SCENE {'evidence': {'accepted': 0, 'rejected': 0}, 'ms': 282, 'name': 'smooth-wall', 'text': '', 'words': 0}
PASS: offline OCR preserves colored/angled text and rejects background, wall and shoulder
PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration
SIDEWAYS OCR {'angle': 0, 'attempt': 1, 'detected': 0, 'ms': 118, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 90, 'attempt': 1, 'detected': -90, 'ms': 236, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': -90, 'attempt': 1, 'detected': 90, 'ms': 187, 'text': 'NY THREADS'}
SIDEWAYS OCR {'angle': 180, 'attempt': 1, 'detected': 180, 'ms': 206, 'text': "NY THREADS\n'HREADS"}
PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes
OBLIQUE CAMERA {'angle': -90, 'bg': '#ffffff', 'ms': 149, 'pass': 1, 'rotation': 90, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -75, 'bg': '#ffffff', 'ms': 247, 'pass': 1, 'rotation': 75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -60, 'bg': '#ffffff', 'ms': 200, 'pass': 1, 'rotation': 60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -45, 'bg': '#ffffff', 'ms': 198, 'pass': 1, 'rotation': 45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -30, 'bg': '#ffffff', 'ms': 186, 'pass': 1, 'rotation': 30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -20, 'bg': '#ffffff', 'ms': 278, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': -12, 'bg': '#ffffff', 'ms': 242, 'pass': 1, 'rotation': 20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 0, 'bg': '#ffffff', 'ms': 88, 'pass': 1, 'rotation': 0, 'source': 'upright', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 12, 'bg': '#ffffff', 'ms': 174, 'pass': 1, 'rotation': -11.650673723924704, 'source': 'tesseract-deskew', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 20, 'bg': '#ffffff', 'ms': 211, 'pass': 1, 'rotation': -20, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 30, 'bg': '#ffffff', 'ms': 183, 'pass': 1, 'rotation': -30, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 45, 'bg': '#ffffff', 'ms': 304, 'pass': 1, 'rotation': -45, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 60, 'bg': '#ffffff', 'ms': 141, 'pass': 1, 'rotation': -60, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 75, 'bg': '#ffffff', 'ms': 339, 'pass': 1, 'rotation': -75, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 90, 'bg': '#ffffff', 'ms': 197, 'pass': 1, 'rotation': -90, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 135, 'bg': '#ffffff', 'ms': 243, 'pass': 1, 'rotation': -135, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': 180, 'bg': '#ffffff', 'ms': 171, 'pass': 1, 'rotation': 180, 'source': 'angle-projection', 'text': 'THREADS NY'}
OBLIQUE CAMERA {'angle': -35, 'bg': '#17191c', 'ms': 285, 'pass': 1, 'rotation': 35, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 25, 'bg': '#f8d94b', 'ms': 145, 'pass': 1, 'rotation': -25, 'source': 'angle-projection', 'text': 'NY THREADS'}
OBLIQUE CAMERA {'angle': 65, 'bg': '#17191c', 'ms': 251, 'pass': 1, 'rotation': -65, 'source': 'angle-projection', 'text': 'NY THREADS'}
PASS: camera recognizes angled print (-90..180 degrees), white-on-black, blue-on-yellow and blank walls offline
~~~
