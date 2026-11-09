# INK AI — Online handwriting recognition and neural stroke completion

**One white drawing board, Pen, Eraser, optional ✨ Assist, and the recognized text.** Only handwritten letters (A–Z, a–z), digits (0–9), punctuation and mathematical symbols. No image generation or object sketches.

[Download index.html](./index.html) and open it in a modern browser. The app downloads only its own published neural weights from this repository. When opened as a local HTML file, it needs internet access to obtain those weights. **No API keys, outside inference services, model providers, nearest-neighbor templates, or glyph-image lookups.**

## ✨ Experimental Assist — actual learned pen movements

The new generator is a **class-conditioned, autoregressive, 2-layer GRU mixture-density network**. It consumes the ordered strokes actually drawn by the user, including pen-up boundaries, and predicts a probability distribution for the *next* (Δx, Δy), whether the pen is down, and whether the character has ended.

The network samples future **multi-stroke pen trajectories**, not a bitmap, 32×32 glyph reconstruction, skeletonized pixel mask, traced font, or nearest matching saved example. Its only geometric rules constrain out-of-bounds jumps and smoothly render the neural model's own vector points. It samples pen-lift decisions from the model's learned probabilities rather than attaching every stroke together.

- Pen: draw real black strokes. Eraser: remove visible ink.
- Sparkle: enable translucent gray neural vector suggestions.
- **Tab:** cycle between neural completions for different plausible characters.
- **G** or **Enter:** accept the current completion as editable, undoable pen strokes.
- **Cmd+Z / Ctrl+Z:** undo; **Escape:** clear.

The handwriting recognition CNN proposes likely character identities, but does *not* supply generated line shapes. The stroke generator also evaluates the likelihood of the user's existing pen-movement prefix under each candidate class to improve selection. Predictions run in an isolated browser Web Worker and never alter the real drawing until accepted.

If the trained sequence weights have not yet been published, the ✨ button retries downloading them. **There is no simulated/template fallback presented as AI.** The pen, eraser, and recognition continue functioning.

## Actual training data and full class support

[UJI Pen Characters (Version 2)](https://archive.ics.uci.edu/dataset/177/uji+pen+characters+version+2), by Prat, Castro, Llorens, Marzal and Vilar (2008), DOI [10.24432/C5FG8S](https://doi.org/10.24432/C5FG8S), **CC BY 4.0**: 11,640 human-written online character recordings from 60 writers. Each sample preserves the original sequence of actual pen coordinates and stroke boundaries. Training uses UJI's **writer-disjoint** training and test partitions.

UJI includes real trajectories for uppercase and lowercase ASCII letters, digits and 16 punctuation marks. For the remaining common mathematical and punctuation characters (such as `+`, `=`, `^`, `×`, `÷`, `±`, `√`, `≠`, `≤` and `≥`) the project contributes **explicitly labeled synthetic vector trajectories** with stroke-order and shape augmentation; these are *not* claimed to be real-human recordings. The model supports all classes in [`CHARS`](./src/train.py).

- Training source: [`src/train_stroke_sequence.py`](./src/train_stroke_sequence.py).
- Independent browser inference: [`src/stroke_worker.js`](./src/stroke_worker.js), embedded verbatim into the downloadable HTML.
- UI interface: [`src/stroke_assist_ui.js`](./src/stroke_assist_ui.js), embedded in the HTML.
- Trained model: [`models/ink-stroke-sequence-v1.json`](./models/ink-stroke-sequence-v1.json), once the [training workflow](./actions/workflows/train-stroke-sequence.yml) successfully publishes it.
- Held-out writer validation: [`models/stroke-sequence-metrics.json`](./models/stroke-sequence-metrics.json).

**Published checkpoint:** 373,563 trainable parameters; 6,210 genuine human pen-trajectory training glyphs from UJI; 3,101 writer-disjoint held-out glyphs; 7,680 synthetic mathematical/punctuation trajectory examples; 111,120 training presentations over 6 training and 2 fine-tuning epochs. Best held-out teacher-forced negative log likelihood: **−4.31849**, pen-state classification accuracy: **98.951%**. A negative Gaussian log-likelihood is mathematically valid and is *not* a percentage accuracy. These metrics do not prove that generated future handwriting looks correct to humans.

Automated Chrome tests confirm that five partial character examples produce nonempty narrow neural vector suggestions, that **Tab** cycles distinct proposals, and that **G** accepts strokes without affecting the pen/eraser. A separate unit test verifies that the recurrent worker emits genuine pen lifts for at least one of five multi-stroke symbol prefixes; the current measured result is **3/5**, not perfect multi-stroke reliability.

**Limitations:** Character completion is inherently ambiguous. The GRU predicts one plausible continuation, not the user's intended letter with certainty. UJI does not record pressure/timing, so those aren't learned. Model evaluation must distinguish teacher-forced held-out sequence loss from actual rendered completion quality. Train/test samples from different writers are separated. Full multi-character cursive words and unsupported symbols are not guaranteed to be correct.

## Character recognition and segmentation

The recognized text below the board is generated by a separately trained CNN, **now upgraded to V3 for real pen input**. The original V2 was trained mostly on scanned EMNIST images; the V3 model was adapted to the stroke thickness, normalization, and drawing style used by the browser, using **6,210 genuine UJI online handwriting recordings**, EMNIST rehearsal, and 256,000 additional training presentations. It is still the project's own CNN—no third-party model or AI API.

On **1,551 independent UJI samples from writers excluded from training and model selection**, recognition improved from **52.74% (V2)** to **76.47% (V3)**, a **23.73 percentage-point increase**. The browser-style EMNIST accuracy changed slightly from **84.51%** to **84.26%** on a separate 12,000-image sample. These are specific evaluation datasets, not a guarantee of the same accuracy on any user's handwriting. See [full V3 training and independent test results](./models/recognition-v3-metrics.json).

The downloaded HTML automatically prefers [real-pen V3](./models/ink-cnn-v3.json), then [class-balanced V2](./models/ink-cnn-v2.json), then V1 if newer weights cannot load. V2 originally improved the mean lowercase-class accuracy on official EMNIST ByClass from 48.00% to 58.66%, but some visually indistinguishable uppercase/lowercase glyphs remain ambiguous. [Full V2 class metrics](./models/recognition-v2-metrics.json).

The segmenter **never cuts a continuous connected stroke into multiple letters merely because it is wide** (an earlier bug turned a single `^` into a nonsensical long string). Nearby strokes are grouped for `^`, `+`, `=`, `:` and `X`. The [regression tests](./tests/recognition-regression-browser.py) recreate these shapes in actual Chrome, not just mock the classifier. The system is still imperfect for touching cursive letters.

## Testing

[GitHub Actions verification](./actions/workflows/verify.yml) runs JavaScript/worker checks, real browser pen-and-eraser tests, the roof-shaped-stroke regression, and, once the generator exists, multi-stroke neural generation tests using its *real* learned weights. It also verifies that no nearest-neighbor/template completion code survives in the HTML.

Training and inference are independent. The legacy raster completion network is no longer used by the HTML; it remains in historical source for reproducibility. The previous handwriting-example lookup bank and its builder have been removed.
