import fs from "node:fs";
import assert from "node:assert/strict";
if(!fs.existsSync("models/ink-cnn-v2.json")){
 console.log("SKIP: recognition fine-tuning did not publish a validated V2 yet");
 process.exit(0);
}
const results=JSON.parse(fs.readFileSync("models/recognition-v2-metrics.json","utf8"));
const model=JSON.parse(fs.readFileSync("models/ink-cnn-v2.json","utf8"));
assert.equal(model.format,"ink-cnn-int8-v1");
assert.equal(model.training.finetuned_from,"models/ink-cnn-v1.json");
const a=results.baseline,b=results.best.metrics;
assert.equal(b.tested,116323);
assert.equal(a.tested,116323);
assert.ok(b.overall>=a.overall-.015,"V2 loses too much overall accuracy");
assert.ok(b.macro>=a.macro+.010,"V2 fails class-balanced accuracy gate");
assert.ok(b.lowercase_macro>=a.lowercase_macro+.020,"V2 fails lowercase accuracy gate");
assert.ok(model.training.emnist_test_accuracy>=a.overall-.015);
console.log("PASS: V2 full 116,323-image EMNIST test validated:",JSON.stringify({
 overall:[a.overall,b.overall],macro:[a.macro,b.macro],
 lowercase:[a.lowercase_macro,b.lowercase_macro]
}));
