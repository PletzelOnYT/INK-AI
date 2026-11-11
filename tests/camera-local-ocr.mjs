import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const read=p=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
const camera=read("src/camera_ocr.js");
const app=read("src/app.js");
const shell=read("src/index.shell.html");
const css=read("src/app.css");
const build=read("scripts/build_standalone.py");
assert.doesNotThrow(()=>new vm.Script(camera));
assert.ok(!/Tesseract|tesseract\.js|cdn\.jsdelivr|createWorker\(["']eng/.test(camera),
 "Camera must not load a third-party OCR engine");
assert.ok(!/\bfetch\s*\(|\bXMLHttpRequest\b/.test(camera),
 "Camera must not upload frames or fetch external text models");
assert.match(camera,/__inkCameraRecognize\(images\)/);
assert.match(app,/window\.__inkCameraRecognize=async images/);
assert.match(camera,/rgba\(255,255,255,0\.30\)/);
assert.match(camera,/hg\.fill\(\);hg\.stroke\(\)/);
assert.match(camera,/paint\(candidateBoxes,frame\)/);
assert.match(shell,/id="cameraHighlights"/);
assert.match(shell,/id="cameraVideo"/);
assert.match(css,/\.board\.camera-active #cameraHighlights\{display:block\}/);
assert.match(build,/\+camera\+/);
console.log("PASS: first-party camera OCR, white overlay, integrated standalone source");
