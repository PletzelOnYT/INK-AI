# INK AI

**A repository-backed handwriting recognizer that trains its own model from scratch.**

## Open the app

Download [index.html](./index.html) and open it in Chrome (internet is required to retrieve **your** trained model from this repository), or host the repository using GitHub Pages. Draw on the canvas, and it automatically reads after each stroke, using **Text / sentence** or **One symbol** mode.

The interface is one HTML file with inline JavaScript and CSS. The training language is **Python + PyTorch** in [src/train.py](./src/train.py). Only the resulting model is loaded into the browser from this GitHub repository.

## Training provenance

- **EMNIST ByClass**: 697,932 training images and 116,323 test images, written by people, covering 62 classes: uppercase, lowercase, and digits. [NIST EMNIST](https://www.nist.gov/itl/products-and-services/emnist-dataset).
- **HASYv2 (optional)**: real handwritten mathematical symbols; usable overlapping classes supplement EMNIST. HASYv2 has an ODbL license and attribution requirements. [Zenodo HASYv2](https://zenodo.org/records/259444).
- **Synthetic punctuation**: font-rendered examples for characters not well covered by the real datasets. **Not human writing.**
- **Augmentation**: random transforms provide millions of training *presentations* across epochs, not millions of independent human samples.

The network starts with randomly initialized weights. It does not import another pretrained model. The training workflow downloads public datasets and Python packages; **the final HTML loads its model only from this repository, never an outside inference service**.

## Start or check training

[Actions — Train INK AI handwriting model](./actions/workflows/train.yml).

The workflow runs when source or workflow files change, or can be manually triggered. Its job is to publish models/ink-cnn-v1.json and models/metrics.json. Training can be resource-intensive. Until a successful training job produces these files, the HTML clearly reports that the model is pending.

Local training:

    python -m pip install -r requirements.txt
    python src/train.py --epochs 4 --batch 256 --hasy

## Fine-tuning

Correct the AI's recognized text and click **Fine-tune on this correction**. The last neural-network classification layer is adjusted and stored in your browser. Export your corrections as JSON for backup or to transfer them. No GitHub write token is embedded in the public HTML.

## Features / limits

- Automatic live recognition, no Read button.
- Black and white handwriting canvas.
- Lowercase and uppercase, digits, ASCII punctuation and extra math symbols.
- Dedicated CPU inference Web Worker.
- Recognition of multiple characters, words, spaces and simple multi-line text.
- Personal model fine-tuning and JSON import/export.
- Limited English context for visually ambiguous I/l/1.
- No external inference API or pretrained third-party model.

**Important:** A character-by-character CNN is not a full cursive-language transcription model. Overlapping cursive, bad segmentation, very similar shapes, and handwritten fonts not represented in the real datasets can still produce errors. Accuracy requires measured validation.

## Attribution

Cohen, Afshar, Tapson and van Schaik (2017), *EMNIST: An Extension of MNIST to Handwritten Letters*, NIST.

Thoma (2017), *The HASYv2 Dataset*, DOI [10.5281/zenodo.259444](https://doi.org/10.5281/zenodo.259444), ODbL.

The software and separately trained model can belong to this repository; third-party training datasets retain their original provenance and rights.

Repository: https://github.com/PletzelOnYT/INK-AI
