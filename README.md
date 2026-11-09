# INK AI — Handwriting recognition + neural sketch completion

**INK AI has a minimal interface:** pen, eraser, optional ✨ Neural Assist, a white drawing board, and live handwriting recognition underneath. No registration, training buttons, or third-party inference API.

Download [index.html](./index.html) and open it in Chrome, Edge, or Safari with internet access. The single HTML file downloads its **own two model files from this repository**; it has no external JavaScript libraries.

## Two completely different trained models

**1. Handwriting reader** — [models/ink-cnn-v1.json](./models/ink-cnn-v1.json)

- PyTorch convolutional neural network, trained independently using human EMNIST characters and HASYv2 math symbols.
- Reads uppercase, lowercase, numbers, punctuation, and simple sequences as you draw.
- Known problem: I / lowercase l / 1 ambiguity and touching or cursive handwriting.

**2. Generative drawing assistant** — [models/ink-sketch-gru-v1.json](./models/ink-sketch-gru-v1.json)

- **Genuine independently trained neural generator**, not line extrapolation.
- Trained from random weights using 27,253 human sketches from Google's Quick, Draw! dataset across 12 categories (cat, dog, tree, flower, house, car, bird, fish, star, smiley face, bicycle, apple).
- The recurrent GRU uses a learned mixture of Gaussian pen-movement distributions, pen-up signals, and stop signals to sample **possible future drawing strokes**, conditioned on your earlier strokes.
- Trained for three passes, 81,759 training presentations. Its held-out generative negative log likelihood is reported in [models/sketch-metrics.json](./models/sketch-metrics.json). That is a loss metric, **not a percentage accuracy or visual-quality guarantee**.
- Weights are only fetched from this GitHub repo and decoded by a dedicated browser Web Worker.

## Using Neural Assist

Tap the ✨ sparkle button. Draw a partial shape with the pen and translucent gray **neural suggestions** appear. These suggestions are sampled from the independent sketch generator's learned distribution, not the old geometric algorithm. Press **G** to accept the visible suggestion as ordinary ink, or keep drawing and the suggestions update. Tap ✨ again to switch it off.

Ghost strokes live on a separate transparent overlay and **do not alter your actual artwork or OCR prediction until accepted**. The sketch generator can suggest curves and multi-stroke figure completions. Its learned categories are limited, so it will not reliably finish arbitrary scenes or act like a large text-to-image model. It may output poor or incomplete suggestions. The referenced external example video could not be independently inspected, so this implementation should not be described as an exact recreation of that video.

Pen and Eraser still work with mouse, touch, and stylus. **Escape** clears, **Ctrl+Z/Cmd+Z** undoes.

## Reproducible source, no third-party model inference

The code to train each model is in [src/train.py](./src/train.py) and [src/train_sketch.py](./src/train_sketch.py). The training jobs run in GitHub Actions and are separate from the user interface. The model weights are original results of training; no other provider's pre-trained weights are copied or fetched at runtime.

## Data rights and attribution

- **Google Creative Lab, Quick, Draw! Dataset**, [project](https://github.com/googlecreativelab/quickdraw-dataset), [license CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Training on derivative Sketch-RNN-format vector records; original contributing human drawings retain applicable rights.
- Cohen, Afshar, Tapson & van Schaik (2017), EMNIST dataset from NIST.
- Martin Thoma (2017), HASYv2 dataset, ODbL.

The project does **not** claim exclusive ownership of the original training datasets or of third-party research concepts.

[View GitHub Actions validation](./actions/workflows/verify.yml) · [View sketch-model training job](./actions/workflows/train-sketch.yml)
