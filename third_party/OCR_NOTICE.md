# Third-party OCR components bundled with INK AI

The standalone, browser-only camera OCR mode uses:

- **Tesseract.js 6.0.0**, Apache License 2.0, https://github.com/naptha/tesseract.js
- **Tesseract.js Core 6.0.0** (Tesseract WebAssembly), Apache License 2.0, https://github.com/naptha/tesseract.js-core
- **English integerized Tesseract LSTM traineddata**, from https://github.com/naptha/tessdata/tree/gh-pages/4.0.0_best_int, based on the Tesseract project
- Supporting JavaScript packages: idb-keyval, wasm-feature-detect, and esbuild, each under its own license.

These components are NOT the user's original INK AI handwriting CNN or stroke-completion GRU. INK AI does not claim to have trained the English Tesseract model.

GitHub Actions retrieves these components while BUILDING the downloadable HTML, bundles the worker, WebAssembly code and English model inside index.html, and commits that result. Opening the completed HTML does not fetch or call these repositories, a CDN, an API, or localhost.

For license terms, visit the corresponding source repositories. Source dependency versions are declared in package.json and scripts/build_offline_ocr.mjs.

The handwriting and stroke-completion models remain separate first-party INK AI models and are trained as documented elsewhere in this repository.
