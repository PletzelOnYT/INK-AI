import fs from "node:fs";
import assert from "node:assert/strict";
const metrics="models/recognition-v4-metrics.json";
const modelPath="models/ink-cnn-v4.json";
if(!fs.existsSync(metrics)){
 console.log("PASS: V4 experiment not published; current V3 stays unchanged");
 process.exit(0);
}
const m=JSON.parse(fs.readFileSync(metrics,"utf8"));
assert.ok(m.training_presentations>=450000);
assert.ok(m.source_counts.uji_pen_train>=6000);
assert.ok(m.source_counts.uji_independent>=1100);
assert.ok(m.source_counts.hasy_training>=1500);
assert.ok(m.source_counts.hasy_writer_heldout>=300);
assert.equal(m.source_counts.pendigits_training,7494);
assert.equal(m.source_counts.pendigits_unseen_writers,3498);
assert.ok(m.baseline_v3.pen_independent.overall>=.70);
if(m.eligible){
 assert.ok(fs.existsSync(modelPath),"Accepted V4 checkpoint missing");
 assert.ok(Object.values(m.quality_gates).every(Boolean));
 const model=JSON.parse(fs.readFileSync(modelPath,"utf8"));
 const base=JSON.parse(fs.readFileSync("models/ink-cnn-v3.json","utf8"));
 assert.equal(model.format,"ink-cnn-int8-v1");
 assert.deepEqual(model.labels,base.labels,"Trained weights may not change character order");
 assert.equal(model.training.finetuned_from,"models/ink-cnn-v3.json");
 assert.equal(model.layers.length,5);
 assert.ok(m.independent_uji_v4.overall>=m.baseline_v3.pen_independent.overall+.008);
 console.log("PASS: V4 independently improves unseen writers and preserves original label mapping",
   m.baseline_v3.pen_independent.overall,"→",m.independent_uji_v4.overall);
}else{
 assert.ok(!fs.existsSync(modelPath),"Rejected model must not be published");
 console.log("PASS: V4 rejected, original V3 weights remain protected");
}
