# INK AI — Handwriting recognition and handwriting completion

**Minimal drawing interface:** a pen, an eraser, optional ✨ **Neural Assist**, a white handwriting board, and the automatically recognized text below. It is designed for **letters, numbers, punctuation, and mathematical symbols** — **not sketches or object drawings**.

[Open or download the single HTML file](./index.html). You can run it directly in a modern browser with an internet connection. It only downloads the two neural model files from **this GitHub repository**, and uses no external AI services or JavaScript libraries.

## Experimental Neural Assist (sparkle)

Tap ✨ and start handwriting a character. The existing recognizer generates candidate labels, and the independently trained V2 network predicts missing portions of the current letter, digit, or symbol. To avoid its old **large fuzzy gray sploches**, the browser now thins predicted glyphs to centerlines, traces the lines, smooths their curves, and displays them as **narrow, transparent pen strokes**.

A second improvement is the [human handwriting reference bank](./models/ink-human-glyph-references.json): **15,931 individual EMNIST, HASYv2 and supplemental punctuation examples** selected and stored in this repository. The assistant aligns these real handwritten shapes with the strokes you already drew, then uses them to guide neural completions. This reduces the blurry averaging problem, but cannot guarantee that an unfinished stroke has only one correct interpretation.

Press **Tab** to cycle through alternative suggested letters/symbols when a partial shape could mean several things, such as `I`, `l`, `1`, `B`, or `P`. Press **G** (or **Enter**) to accept the current ghost suggestion as real **editable vector strokes**. Press **Cmd+Z/Ctrl+Z** to undo, or keep handwriting without accepting. Unaccepted ghost lines never become ink or influence the recognizer.

**What it is:** A real larger class-conditioned neural completion model, trained and fine-tuned to reconstruct partly missing handwritten characters. The system learns from masked parts of human-written glyph images, not geometric curve extrapolation. It does **not** have original human stroke-order data: vector paths are derived from reconstructed images and real glyph examples rather than directly predicted from pen-motion sequences.

**What it is not:** Sketch generation, picture/object completion, a generalized art generator, or a model capable of reliably guessing any intended symbol from a few marks. Unclear partial characters such as `I`, `l`, `1`, `|` may be guessed incorrectly. The suggestion network predicts pixels, so its gray suggestions can be soft-edged rather than perfect human pen strokes.

## The two independently trained models

1. **Handwriting recognition:** [models/ink-cnn-v1.json](./models/ink-cnn-v1.json). Convolutional neural network, trained from scratch on EMNIST ByClass and HASYv2 with synthetic punctuation supplements. This predicts which character you are writing.

2. **Neural handwriting completion (V2):** [models/ink-glyph-completion-v2.json](./models/ink-glyph-completion-v2.json). A **1,106,848-parameter class-conditional residual neural network** trained from random initialization. Dataset: **100,000 real handwritten EMNIST letters/digits**, **24,247 real handwritten HASYv2 symbols**, plus **12,000 explicitly synthetic punctuation examples**. The 4-epoch training is followed by a lower-learning-rate **fine-tuning stage on 74,386 difficult/confusable character examples**. The total training presentations are **619,374**. There are nine kinds of simulated incomplete handwriting and a missing-ink overlap objective to reduce vague gray haze. [V2 training metrics](./models/glyph-completion-v2-metrics.json) include masked completion F1. The previous [V1 network](./models/ink-glyph-completion-v1.json) remains as a safe fallback if V2 weights cannot be loaded.

V2's generator evaluates the handwriting classifier's **three most likely letters/symbols**, comparing how each proposed completion explains the actual visible ink instead of blindly trusting the top OCR guess. See the [side-by-side held-out benchmark](./models/glyph-completion-comparison.json) when published. No extra AI service, sketch dataset, or externally pretrained weights are used.

The complete implementation is a single HTML file containing browser inference code. Training uses Python/PyTorch in [src/train.py](./src/train.py), [src/train_glyph_completion.py](./src/train_glyph_completion.py) (legacy), and [src/train_glyph_completion_v2.py](./src/train_glyph_completion_v2.py) (V2). The finished weights load only from `PletzelOnYT/INK-AI`; the browser does not call other inference providers.

## Character recognition: screenshot regression and V2 improvements

The November 8 Mac screenshot showed a single roof-shaped handwritten stroke
mistaken for a long sequence of unrelated characters. This was a **segmentation
bug**: a formerly implemented "vertical valley" heuristic incorrectly split a
single connected diagonal line into many letter boxes. INK AI now **never
divides connected ink solely because it is wide**.

The original drawn roof is reproduced in
[`tests/recognition-regression-browser.py`](./tests/recognition-regression-browser.py).
It must produce exactly **one** region and the caret **`^`**. Additional
real-Chrome checks cover one continuous V, long zigzags, three independent
letters, and detached multi-stroke symbols `=`, `:`, `+`, and `X`.

The recognizer now uses conservative single-stroke geometry where unambiguous,
and combines nearby dots/crossbars rather than splitting symbols into multiple
lines. It also uses neighboring letters to help disambiguate uppercase vs.
lowercase characters that EMNIST frequently renders nearly identically. Low
confidence predictions can be shown as unknown instead of fabricated answers.

The original CNN recognizes about 85% of the official EMNIST ByClass test
images, but this **does not** imply 85% accuracy on arbitrary user handwriting,
joined cursive, or the user's on-screen stroke. Its per-class metrics show
significant limitations for rare lowercase shapes.

A new [class-balanced V2 recognition model](./models/ink-cnn-v2.json) was fine-tuned
for 480,000 more training presentations from **the project's own V1 weights**.
On all 116,323 official EMNIST test images, the class-balanced results are:

| Metric | V1 | V2 |
| --- | ---: | ---: |
| Overall accuracy | 84.90% | 84.32% |
| Macro-average class accuracy | 70.49% | 74.33% |
| Lowercase macro accuracy | 48.00% | 58.66% |

V2 makes significantly fewer errors on many rare lowercase letters but has a
small overall accuracy trade-off. It was only published because it cleared the
pre-established thresholds for minority-class improvement and maximum allowed
overall regression. Some individual classes, such as uppercase C, remain worse.
See [the full V2 class-level metrics](./models/recognition-v2-metrics.json) and
[the safe-training workflow](./actions/workflows/train-recognition-v2.yml).
The HTML automatically prefers the independently validated V2 model and
falls back to V1 if unavailable.

## Drawing controls

The **pen** makes black strokes. The **eraser** removes parts of the ink. The **sparkle** turns neural handwriting completion on and off. Press **Tab** to see alternative character completions, **G/Enter** to accept a vector stroke suggestion, **Escape** to clear the board, or **Ctrl+Z/Cmd+Z** to undo.

## Training-data attribution

- Cohen, Afshar, Tapson and van Schaik (2017), *EMNIST: An Extension of MNIST to Handwritten Letters*, NIST.
- Martin Thoma (2017), *HASYv2 Dataset*, [Zenodo](https://zenodo.org/records/259444), ODbL.
- Synthetic punctuation examples are computer-generated, not human handwriting.

Source datasets retain their original rights and licenses. INK AI does not include anyone else's pretrained model.

[Verify the browser and neural tests](./actions/workflows/verify.yml)
