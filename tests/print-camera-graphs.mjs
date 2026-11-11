import assert from "node:assert/strict";
import fs from "node:fs";
const get=file=>fs.readFileSync(file,"utf8");
const camera=get("src/camera_ocr.js");
const app=get("src/app.js");
const shell=get("src/index.shell.html");
const build=get("scripts/build_standalone.py");
const train=get("src/train_print_cnn.py");
const readme=get("README.md");
const systems=get("docs/ai-systems.svg");
const printed=get("docs/camera-print-benchmarks.svg");
assert.match(camera,/Math\.abs\(luminance\)<=24&&chroma>49/,"Colored text mask missing");
assert.match(camera,/luminance<-24/,"Dark text polarity missing");
assert.match(camera,/luminance>24/,"Light text polarity missing");
assert.match(camera,/paint\(candidateBoxes,frame\)/,"Highlights must not depend on a successful OCR prediction");
assert.match(app,/cmd==="readPrint"/);
assert.match(app,/cmd==="initPrint"/);
assert.match(build,/ink-print-cnn-v1\.json/);
assert.match(train,/class PrintCNN/);
assert.match(train,/heldout_font_count/);
assert.match(readme,/\.\/docs\/camera-print-benchmarks.svg/);
assert.match(readme,/\.\/docs\/ai-systems.svg/);
assert.match(readme,/Graph update rule/);
assert.match(shell,/id="cameraHighlights"/);
assert.ok(!/Tesseract|cdn\.|api\.openai\.com/.test(camera));
assert.ok(printed.startsWith("<svg")&&systems.startsWith("<svg"));
const recognizer=get("docs/recognition-vertical-bars.svg");
for(const [name,svg] of [["camera",printed],["all-systems",systems]]){
 assert.match(svg,/width="850" height="465" viewBox="0 0 850 465"/,
   name+" must use the same dimensions as the existing benchmark charts");
 assert.match(svg,/<rect width="850" height="465" fill="#fff"\/>/,
   name+" must match the original white chart background");
 assert.match(svg,/x1="90" y1="360" x2="800" y2="360"/,
   name+" must have the vertical chart baseline");
 assert.match(svg,/x1="90" y1="100" x2="800" y2="100"/,
   name+" must have the vertical chart grid");
 assert.match(svg,/fill="#4285f4"/,name+" needs blue vertical measured bars");
 assert.match(svg,/text-anchor="middle"/,name+" needs centered bar labels");
 assert.doesNotMatch(svg,/width="665" height="23"/,
   name+" must not regress to horizontal bars");
}
assert.match(recognizer,/width="850" height="465"/);
const report="models/print-cnn-v1-metrics.json";
if(fs.existsSync(report)){
 const m=JSON.parse(get(report));
 assert.ok(m.trained_from_scratch);
 assert.ok(m.heldout_characters>=500&&m.heldout_font_count>=2);
 assert.ok(m.heldout_accuracy>=0&&m.heldout_accuracy<=1);
 assert.ok(printed.includes((100*m.heldout_accuracy).toFixed(2)+"%"),
   "Published camera accuracy graph must reflect the actual benchmark");
 assert.ok(systems.includes((100*m.heldout_accuracy).toFixed(2)+"%"),
   "All-system benchmark must reflect the same printed CNN report");
 assert.ok(m.real_camera_word_accuracy===null||m.real_camera_word_accuracy>=0);
}
if(!fs.existsSync(report))assert.match(printed,/Not measured/);
console.log("PASS: all-color camera detection, independent print CNN, benchmark graphs");
