# INK AI

**Handwriting recognition and live character completion.**

A small browser-based drawing app for writing letters, numbers, and symbols. Draw on the canvas to see what INK AI recognizes, or enable Assist to preview how a character might continue.

**Made by [PletzelOnYT](https://github.com/PletzelOnYT).**

## Try it

**[Download index.html](./index.html)** and open it in Chrome or another modern browser.

It's a single HTML file that works offline. The character recognizer, stroke prediction models and English word list are built in. No account, API key or server required.

## Features

- **Live recognition** — identifies handwritten letters, numbers, punctuation, and common math symbols.
- **Pen and eraser** — a simple canvas without extra menus.
- **Assist** — optional translucent line suggestions that update while you're drawing.
- **Stroke continuations** — the assistant draws light-gray, semi-transparent extensions of your actual ink. It does not overlay printed letters.
- **Multi-stroke characters** — handles separate strokes in characters like `+`, `=`, `:`, and `X`.
- **Local drawing controls** — suggestions don't modify the actual drawing until you accept them.

### Controls

| Control | Action |
| --- | --- |
| Pen | Draw |
| Eraser | Erase |
| ✨ Assist | Toggle character suggestions |
| Tab | Switch between available suggestions |
| G / Enter | Accept the suggested strokes |
| Cmd+Z / Ctrl+Z | Undo |
| Escape | Clear the canvas |

## How it works

INK AI has two separate models:

**Recognition:** A convolutional neural network (CNN) reads the drawing and predicts the most likely character. The current V3 model was adapted for browser-drawn handwriting rather than only scanned character images.

**Completion:** A stroke-based GRU generates possible next pen movements from the sequence you've drawn so far. It works with pen coordinates and pen-up/pen-down information, so the output is a vector line instead of an image.

Assist uses multiple candidate trajectories and filters out implausible shapes. It can use a built-in English word-frequency list to choose between genuinely plausible letters in a word, while leaving strongly recognized strokes alone. It does not force a tail onto a lowercase h that already reaches its baseline. It also takes the full-character recognition result into account, so a partial-stroke prediction doesn't override a more reliable whole-character guess. If the newer completion model can't produce a usable continuation, it can fall back to the previous trained stroke model.

The models run in browser workers and are embedded in the HTML, so it works without network access. Drawings stay in the canvas unless you choose to accept a suggestion.

## Models and training

The recognition model was trained with EMNIST handwriting samples and adapted using pen-drawn characters from the UJI dataset. In the writer-separated UJI test, V3 reached **76.47%** accuracy, compared with **52.74%** for V2 on the same test. See [recognition results](./models/recognition-v3-metrics.json).

The stroke generator uses [UJI Pen Characters v2](https://archive.ics.uci.edu/dataset/177/uji+pen+characters+version+2) for real handwritten pen trajectories. Additional punctuation and math characters use labeled synthetic stroke data. The training and evaluation sets separate handwriting from different writers.

The prefix-trained completion model is fine-tuned on unfinished characters and its own predicted movements. It reduced measured 14-step free-running position error by **7.28%** on a separate writer-held-out evaluation, though that doesn't translate directly into a character-completion accuracy percentage. See [completion results](./models/stroke-prefix-metrics.json).

A larger 1M-parameter experiment was also trained, but it did not pass the pen-lift evaluation and is **not used as the default**. Model size alone isn't a measure of quality.

## Project files

| File | Purpose |
| --- | --- |
| [index.html](./index.html) | Standalone drawing app |
| [src/stroke_assist_ui.js](./src/stroke_assist_ui.js) | Live gray neural pen suggestions, English context and drawing controls |
| [src/stroke_worker.js](./src/stroke_worker.js) | Neural stroke generation |
| [src/train.py](./src/train.py) | Character recognition training |
| [src/train_stroke_sequence.py](./src/train_stroke_sequence.py) | Stroke-model training |
| [src/train_prefix_completion.py](./src/train_prefix_completion.py) | Partial-character fine-tuning |
| [models/](./models) | Model weights and evaluation results |
| [tests/](./tests) | Browser and model regression tests |

## Testing

[GitHub Actions](./actions/workflows/verify.yml) runs JavaScript checks, model tests, and real Chrome tests for the drawing board. The test suite covers live suggestions while drawing, multi-stroke recognition, model loading from a downloaded HTML file, and completion of characters such as lowercase `h`.

## Additional handwriting training

The V4 recognizer experiment adds two more genuine handwriting sources to the existing UJI and EMNIST training: HASYv2 (hand-drawn letters and mathematical symbols) and UCI PenDigits (stylus-written digits from separate training/test writers). Training-only data is downloaded into the GitHub Actions runner; the released HTML does not contain any raw examples.

New model weights are only eligible for release if independent UJI writers improve without unacceptable lowercase, EMNIST, or PenDigits regression. A rejected experiment leaves the existing V3 recognizer intact. The V4 results are recorded in `models/recognition-v4-metrics.json` when the experiment completes.

**Data attribution:** [HASYv2](https://doi.org/10.5281/zenodo.259444), Martin Thoma, 2017 (Open Database License, ODbL); [Pen-Based Recognition of Handwritten Digits](https://doi.org/10.24432/C5MG6K), E. Alpaydin and F. Alimoglu, 1996 (CC BY 4.0). UJI Pen Characters v2 and EMNIST remain the original sources.

## Known limitations

Handwriting can be ambiguous, especially similar characters such as `I`, `l`, and `1`. Assist can also guess the wrong completion for unusual writing styles or incomplete strokes. Multi-character cursive writing is still a work in progress.

## Dataset credits

- [UJI Pen Characters v2](https://archive.ics.uci.edu/dataset/177/uji+pen+characters+version+2) — Prat, Castro, Llorens, Marzal, and Vilar (2008), [DOI: 10.24432/C5FG8S](https://doi.org/10.24432/C5FG8S), CC BY 4.0.
- EMNIST ByClass — handwriting recognition training data.

- [google-10000-english](https://github.com/first20hours/google-10000-english) — frequency-ordered English word list used for optional letter context.
