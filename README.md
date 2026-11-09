# INK AI

Handwriting recognition and whole-character auto-correct in a single HTML file.

Made by [PletzelOnYT](https://github.com/PletzelOnYT).

## Try it

Download [index.html](./index.html) and open it in Chrome. The trained character recognizer and English word list are inside the HTML file, so it also works offline.

Draw on the white board, then turn on Assist to preview a complete corrected letter. It will not change your original handwriting until you accept the correction.

| Key | What it does |
| --- | --- |
| **G** or **Accept** | Replace the selected handwritten character with the complete, corrected character |
| **Tab** | Cycle through recognized alternatives |
| **Ctrl/Cmd + Z** | Undo the correction and restore the original drawing |
| **Escape** | Clear the board |

Pen and eraser still work as before.

## Recognition and English context

INK AI runs a trained CNN in your browser to recognize letters, numbers, punctuation, and mathematical symbols. It also has a built-in, frequency-ranked list of **10,000 English words** that helps pick between plausible letters within a word. The dictionary can favor a reasonable English word, but it does **not** override strongly recognized handwriting, and it does not try to guess words when you write a single letter.

The preview is a whole, clean character, **not** a continuation of an unfinished neural stroke. You can change the suggestion using Tab, accept it using G, or leave your handwriting untouched.

Everything runs locally; no account, API key, external AI service, or connection is required for this standalone version.

## Development

- `src/autocorrect_ui.js` — correction preview, English context scoring, acceptance and undo.
- `models/ink-cnn-v3.json` — trained character recognition.
- `src/train_recognition_v3.py` — training and writer-disjoint evaluation.
- `tests/autocorrect-quality.mjs` — contextual scoring and bundled-asset tests.
- `tests/autocorrect-browser.py` — real offline Chrome tests for G, click-to-accept, and undo.

The older stroke-sequence generation experiments remain in `src/` and `models/` for research, but they are not used by the main auto-correct interface.

Dictionary data: [google-10000-english](https://github.com/first20hours/google-10000-english), based on public word-frequency data.

## Limitations

Recognition can still be wrong, especially with connected cursive, overlapping characters, or unusual handwriting. Word context can improve ambiguous guesses, but it does not understand sentences or guarantee the intended letter.
