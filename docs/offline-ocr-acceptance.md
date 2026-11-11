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

⚡ Done in 142ms
Built completely offline OCR engine: 17658253 bytes
Bundled GRU: models/ink-stroke-prefix-domain-v2.json
Built independent offline INK AI: /home/runner/work/INK-AI/INK-AI/dist/ink-ai-standalone.html 19371129 bytes
Traceback (most recent call last):
  File "/home/runner/work/INK-AI/INK-AI/tests/camera-bundled-ocr-browser.py", line 45, in <module>
    assert result.get("ok"),result.get("error")
           ~~~~~~~~~~^^^^^^
AssertionError: NetworkError: Failed to execute 'importScripts' on 'WorkerGlobalScope': The script at 'blob:null/1a7661c0-e1e9-49a2-80b4-df0df78a68ea#core.js' failed to load.
~~~
