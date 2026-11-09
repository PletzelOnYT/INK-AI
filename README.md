# INK AI

An intentionally minimal handwriting-recognition web app.

**Interface:** a minimal black-and-white pen/eraser toolbar, one white drawing canvas, and one live text prediction. No training controls, settings, dashboards, or third-party inference APIs.

[Open or download the single HTML file](./index.html) and open it in your browser. Internet access is needed to download the independently trained neural-network weights from [models/ink-cnn-v1.json](./models/ink-cnn-v1.json) in **this repository only**.

Choose the **pen** to draw black ink or the **eraser** to remove parts of strokes, using your mouse, finger, or stylus. Erasing is pixel-precise and undoable. The text prediction updates automatically after drawing **or erasing**. Press **Escape** to clear the board and **Ctrl+Z / Cmd+Z** to undo. The toolbar uses only two controls, styled after the pen/eraser concept in Apple's Pages drawing tools.

## Model

The Python/PyTorch trainer in [src/train.py](./src/train.py) trains the convolutional model from scratch, using EMNIST handwriting and HASYv2 samples and augmentations. The resulting quantized JSON model runs locally in a browser Web Worker; no server receives the drawing. The training code is retained for future development, but **training and fine-tuning are not part of the user interface**.

Training metrics: [models/metrics.json](./models/metrics.json). The browser also includes conservative preprocessing improvements for detached dots, touching letters, and context-dependent I/l/1 choices. Word recognition remains limited by character segmentation and ambiguous handwriting; similar glyphs such as I/l/1 are particularly challenging. These preprocessing changes do not change the neural-network weights or its recorded accuracy.

Original handwriting dataset attribution:
- Cohen, Afshar, Tapson, van Schaik (2017), [EMNIST](https://www.nist.gov/itl/products-and-services/emnist-dataset), NIST.
- Martin Thoma (2017), [HASYv2](https://zenodo.org/records/259444), ODbL.

[Check HTML/worker and browser tests](./actions/workflows/verify.yml).
