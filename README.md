# INK AI — Handwriting recognition and handwriting completion

**Minimal drawing interface:** a pen, an eraser, optional ✨ **Neural Assist**, a white handwriting board, and the automatically recognized text below. It is designed for **letters, numbers, punctuation, and mathematical symbols** — **not sketches or object drawings**.

[Open or download the single HTML file](./index.html). You can run it directly in a modern browser with an internet connection. It only downloads the two neural model files from **this GitHub repository**, and uses no external AI services or JavaScript libraries.

## Experimental Neural Assist (sparkle)

Tap ✨ and start handwriting a character. The system identifies the current partial letter, digit, or symbol with the existing recognizer. A *separately trained neural handwriting-completion network* then predicts possible **missing portions of that same character**. Its suggestion appears as transparent gray ink. As you keep drawing, it updates.

Press **G** to accept a suggested completion as real, undoable ink, or continue handwriting without accepting. Faint ink is kept in a separate overlay and is never sent to the recognizer until accepted.

**What it is:** A real class-conditioned neural completion model, trained to reconstruct partly missing handwritten characters. The system learns from missing parts of human-written glyph images and does not extrapolate geometric curves.

**What it is not:** Sketch generation, picture/object completion, a generalized art generator, or a model capable of reliably guessing any intended symbol from a few marks. Unclear partial characters such as `I`, `l`, `1`, `|` may be guessed incorrectly. The suggestion network predicts pixels, so its gray suggestions can be soft-edged rather than perfect human pen strokes.

## The two independently trained models

1. **Handwriting recognition:** [models/ink-cnn-v1.json](./models/ink-cnn-v1.json). Convolutional neural network, trained from scratch on EMNIST ByClass and HASYv2 with synthetic punctuation supplements. This predicts which character you are writing.

2. **Neural handwriting completion:** [models/ink-glyph-completion-v1.json](./models/ink-glyph-completion-v1.json). Class-conditional feedforward neural generator, independently trained from random initialization. Training: **45,000 real handwritten EMNIST characters**, **24,247 real handwritten HASYv2 symbols**, plus **9,000 font-generated punctuation samples**. Training runs for 3 epochs and makes **234,741 presentations**. The network is taught with randomly hidden parts of characters and reconstructs missing ink. [Training metrics](./models/glyph-completion-metrics.json) report held-out masked loss, not visual accuracy.

The complete implementation is a single HTML file containing the browser inference code. Training uses Python/PyTorch in [src/train.py](./src/train.py) and [src/train_glyph_completion.py](./src/train_glyph_completion.py). The finished weights load only from `PletzelOnYT/INK-AI`; the browser does not call other inference providers.

## Drawing controls

The **pen** makes black strokes. The **eraser** removes parts of the ink. The **sparkle** turns neural handwriting completion on and off. Press **G** to accept the suggestion, **Escape** to clear the board, or **Ctrl+Z/Cmd+Z** to undo.

## Training-data attribution

- Cohen, Afshar, Tapson and van Schaik (2017), *EMNIST: An Extension of MNIST to Handwritten Letters*, NIST.
- Martin Thoma (2017), *HASYv2 Dataset*, [Zenodo](https://zenodo.org/records/259444), ODbL.
- Synthetic punctuation examples are computer-generated, not human handwriting.

Source datasets retain their original rights and licenses. INK AI does not include anyone else's pretrained model.

[Verify the browser and neural tests](./actions/workflows/verify.yml)
