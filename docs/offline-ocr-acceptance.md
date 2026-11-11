# Real Chrome offline OCR acceptance

**PASS:** local standalone HTML recognized text on generated label, color and tilted fixtures while completely offline.

Test fixture: printed NY THREADS and Torrey Pines High School, generated in Chrome.
No webcam image, cloud OCR, or external recognition request was used.

~~~text

added 15 packages in 2s

> ink-ai-offline-ocr-build@1.0.0 build:ocr
> node scripts/build_offline_ocr.mjs

Bundling pretrained English OCR: 5199098 bytes

  dist/ink-offline-ocr.js  16.8mb ⚠️

⚡ Done in 143ms
Built completely offline OCR engine: 17659113 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19372226 bytes
OFFLINE OCR RESULT: {'elapsedMs': 159, 'engine': 'bundled-tesseract-wasm', 'lines': 2, 'text': 'NY THREADS\nTorrey Pines High School', 'words': 6}
PASS: GitHub index.html reads real printed text while completely offline
SCENE {'ms': 128, 'name': 'white-on-black', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 101, 'name': 'dark-on-white-angle-12', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 53, 'name': 'blue-on-yellow', 'text': 'NY THREADS', 'words': 2}
SCENE {'ms': 152, 'name': 'empty-cabinet-geometry', 'text': '', 'words': 0}
PASS: offline OCR handles white-on-black, color and angled labels
~~~
