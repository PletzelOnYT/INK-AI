import fs from "node:fs";
import assert from "node:assert/strict";
const path="models/penlift-v3-metrics.json";
if(!fs.existsSync(path)){console.log("PASS: pen-lift V3 experiment still running");process.exit(0)}
const r=JSON.parse(fs.readFileSync(path,"utf8"));
assert.ok(r.test_glyphs>1000);
assert.ok(r.seen>25000);
const model="models/ink-stroke-penlift-v3.json";
if(r.eligible){
 assert.ok(fs.existsSync(model));
 const m=JSON.parse(fs.readFileSync(model,"utf8"));
 assert.equal(m.format,"ink-online-stroke-mdn-v1");
 assert.equal(m.training.penlift_calibrated_v3,true);
 assert.equal(m.training.fine_tuned_own_model,"models/ink-stroke-prefix-domain-v2.json");
 const metrics=r.candidate.independent;
 assert.ok(metrics.pen_lift_f1>=.20);
 assert.ok(metrics.pen_lift_precision>=.20&&metrics.pen_lift_recall>=.20);
 assert.ok(r.candidate.prefix_position.prefix_frame_position_error <=
   r.baseline.prefix_position.prefix_frame_position_error*1.06);
 console.log("PASS: verified pen-lift neural enhancement",
   "F1",metrics.pen_lift_f1,"precision",metrics.pen_lift_precision,
   "recall",metrics.pen_lift_recall);
}else{
 assert.ok(!fs.existsSync(model),"Rejected pen-lift checkpoint must not ship");
 console.log("PASS: pen-lift model failed independent quality gate and was not published");
}
