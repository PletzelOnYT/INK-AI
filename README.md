# INK AI — Handwriting recognition and handwriting completion

**Minimal drawing interface:** a pen, an eraser, optional ✨ **Neural Assist**, a white handwriting board, and the automatically recognized text below. It is designed for **letters, numbers, punctuation, and mathematical symbols** — **not sketches or object drawings**.

[Open or download the single HTML file](./index.html). You can run it directly in a modern browser with an internet connection. It only downloads the two neural model files from **this GitHub repository**, and uses no external AI services or JavaScript libraries.

## Experimental Neural Assist (sparkle)

Tap ✨ and start handwriting a character. The system identifies the current partial letter, digit, or symbol with the existing recognizer. A *separately trained neural handwriting-completion network* then predicts possible **missing portions of that same character**. Its suggestion appears as transparent gray ink. As you keep drawing, it updates.

Press **G** to accept a suggested completion as real, undoable ink, or continue handwriting without accepting. Faint ink is kept in a separate overlay and is never sent to the recognizer until accepted.

**What it is:** A real larger class-conditioned neural completion model, trained and fine-tuned to reconstruct partly missing handwritten characters. The system learns from masked parts of human-written glyph images, not geometric curve extrapolation. It does not have human stroke-order data, so suggestions are reconstructed pixels rather than perfectly predicted pen movements.

**What it is not:** Sketch generation, picture/object completion, a generalized art generator, or a model capable of reliably guessing any intended symbol from a few marks. Unclear partial characters such as `I`, `l`, `1`, `|` may be guessed incorrectly. The suggestion network predicts pixels, so its gray suggestions can be soft-edged rather than perfect human pen strokes.

## The two independently trained models

1. **Handwriting recognition:** [models/ink-cnn-v1.json](./models/ink-cnn-v1.json). Convolutional neural network, trained from scratch on EMNIST ByClass and HASYv2 with synthetic punctuation supplements. This predicts which character you are writing.

2. **Neural handwriting completion (V2):** [models/ink-glyph-completion-v2.json](./models/ink-glyph-completion-v2.json). A **1,106,848-parameter class-conditional residual neural network** trained from random initialization. Dataset: **100,000 real handwritten EMNIST letters/digits**, **24,247 real handwritten HASYv2 symbols**, plus **12,000 explicitly synthetic punctuation examples**. The 4-epoch training is followed by a lower-learning-rate **fine-tuning stage on 74,386 difficult/confusable character examples**. The total training presentations are **619,374**. There are nine kinds of simulated incomplete handwriting and a missing-ink overlap objective to reduce vague gray haze. [V2 training metrics](./models/glyph-completion-v2-metrics.json) include masked completion F1. The previous [V1 network](./models/ink-glyph-completion-v1.json) remains as a safe fallback if V2 weights cannot be loaded.

V2's generator evaluates the handwriting classifier's **three most likely letters/symbols**, comparing how each proposed completion explains the actual visible ink instead of blindly trusting the top OCR guess. See the [side-by-side held-out benchmark](./models/glyph-completion-comparison.json) when published. No extra AI service, sketch dataset, or externally pretrained weights are used.

The complete implementation is a single HTML file containing browser inference code. Training uses Python/PyTorch in [src/train.py](./src/train.py), [src/train_glyph_completion.py](./src/train_glyph_completion.py) (legacy), and [src/train_glyph_completion_v2.py](./src/train_glyph_completion_v2.py) (V2). The finished weights load only from `PletzelOnYT/INK-AI`; the browser does not call other inference providers.

## Drawing controls

The **pen** makes black strokes. The **eraser** removes parts of the ink. The **sparkle** turns neural handwriting completion on and off. Press **G** to accept the suggestion, **Escape** to clear the board, or **Ctrl+Z/Cmd+Z** to undo.

## Training-data attribution

- Cohen, Afshar, Tapson and van Schaik (2017), *EMNIST: An Extension of MNIST to Handwritten Letters*, NIST.
- Martin Thoma (2017), *HASYv2 Dataset*, [Zenodo](https://zenodo.org/records/259444), ODbL.
- Synthetic punctuation examples are computer-generated, not human handwriting.

Source datasets retain their original rights and licenses. INK AI does not include anyone else's pretrained model.

[Verify the browser and neural tests](./actions/workflows/verify.yml)
