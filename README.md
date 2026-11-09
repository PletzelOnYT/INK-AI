# INK AI

An intentionally minimal handwriting-recognition web app.

**Interface:** one white drawing canvas and one live text prediction. No menus, training controls, buttons, settings, dashboards, or third-party inference APIs.

[Open or download the single HTML file](./index.html) and open it in your browser. Internet access is needed to download the independently trained neural-network weights from [models/ink-cnn-v1.json](./models/ink-cnn-v1.json) in **this repository only**.

Write with a mouse, finger, or pen. The prediction updates automatically after each stroke. Double-click / double-tap the canvas or press **Escape** to clear. Press **Ctrl+Z / Cmd+Z** to undo.

## Model

The Python/PyTorch trainer in [src/train.py](./src/train.py) trains the convolutional model from scratch, using EMNIST handwriting and HASYv2 samples and augmentations. The resulting quantized JSON model runs locally in a browser Web Worker; no server receives the drawing. The training code is retained for future development, but **training and fine-tuning are not part of the user interface**.

Training metrics: [models/metrics.json](./models/metrics.json). Word recognition is still limited by character segmentation and ambiguous handwriting; similar glyphs such as I/l/1 are particularly challenging.

Original handwriting dataset attribution:
- Cohen, Afshar, Tapson, van Schaik (2017), [EMNIST](https://www.nist.gov/itl/products-and-services/emnist-dataset), NIST.
- Martin Thoma (2017), [HASYv2](https://zenodo.org/records/259444), ODbL.

[Check HTML/worker and browser tests](./actions/workflows/verify.yml).
