import fs from "node:fs";
import assert from "node:assert/strict";

const read=path=>fs.readFileSync(path,"utf8");
const model=path=>JSON.parse(read("models/"+path));
const readme=read("README.md");
const manifest=JSON.parse(read("docs/current-models.json"));

assert.ok(readme.includes("## Models used by INK AI"));
assert.ok(!/Model leaderboards|Model graphs|vertical-bars\.svg/.test(readme),
  "README must explain deployed models without graphs");
assert.ok(readme.includes("CNN V5")&&readme.includes("Domain V2 GRU"));
assert.ok(readme.includes("Tesseract LSTM")&&readme.includes("WASM"));
assert.ok(readme.includes("./docs/current-models.json"));

const v3=model("recognition-v3-metrics.json");
const v5=model("recognition-v5-metrics.json");
const prefix=model("stroke-prefix-domain-v2-metrics.json");
assert.ok(v5.independent_pen_v3.overall>v3.independent_pen_v3.overall);
assert.ok(v5.eligible===true&&v5.browser_integration_passed===true&&v5.deployable===true);
assert.ok(Math.abs(v5.independent_pen_v3.overall*100-77.8852)<1e-4);
assert.equal(manifest.recognizer.weights,"models/ink-cnn-v5.json");
assert.equal(manifest.completer.weights,"models/ink-stroke-prefix-domain-v2.json");
assert.equal(manifest.completer.heldout_writer_trajectory_error,
  prefix.candidate.independent.prefix_frame_position_error);
assert.ok(readme.includes("not nearest-template matching"));
assert.ok(readme.includes("trained recurrent generative neural network"));
assert.ok(readme.includes("OCR is **real trained machine learning**"));
console.log("PASS: README describes deployed neural models accurately and contains no charts");
