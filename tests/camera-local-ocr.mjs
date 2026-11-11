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
assert.match(camera,/__inkCameraRecognize\(misses\.map\(i=>images\[i\]\)\)/);
assert.match(camera,/Math\.atan\(dominant\.slope\)/);
assert.match(camera,/const retries=\[-20,20,-40,40,-60,60,-85,85\]/);
assert.match(camera,/tracker\.update\(found,Date\.now\(\)\)/);
assert.match(camera,/schedule\(id,110\)/);
assert.match(read("src/camera_tracking.js"),/captured\.map\(t=>t\.text\)/);
assert.match(app,/window\.__inkCameraRecognize=async images/);
assert.match(camera,/rgba\(255,255,255,0\.30\)/);
assert.match(camera,/hg\.fill\(\);hg\.stroke\(\)/);
assert.match(camera,/paint\(regions,frame\)/);
assert.match(camera,/Detector\.detect\(image,w,h\)/);
assert.match(camera,/regionTracker\.update\(detectedWordRegions\(geometry\)/);
assert.match(camera,/Core\.decodePrintedWord\(selected,dictionaryByLength\.get/);
assert.match(camera,/Core\.looksLikeWord\(text,confidence\)/);
assert.match(camera,/regionTracker\.snapshot\(\)/);
assert.doesNotMatch(camera,/paint\(fresh,frame\);[\s\S]*const predictions=/,
 "Do not draw unverified candidate rectangles before OCR");
assert.match(shell,/id="cameraHighlights"/);
assert.match(shell,/src\/camera_text_detector\.js/);
assert.match(shell,/id="cameraVideo"/);
assert.match(css,/\.board\.camera-active #cameraHighlights\{display:block\}/);
assert.match(build,/\+tracking\+/);
assert.match(build,/\+scene\+/);
assert.match(build,/\+camera\+/);
console.log("PASS: first-party camera OCR, white overlay, integrated standalone source");
