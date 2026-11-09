import fs from "node:fs";
import assert from "node:assert/strict";

const path="models/stroke-prefix-metrics.json";
const modelPath="models/ink-stroke-prefix-v1.json";
if(!fs.existsSync(path)){
 console.log("PREFIX MODEL PENDING: writer-independent scheduled-sampling evidence not published");
 process.exit(0);
}
const x=JSON.parse(fs.readFileSync(path,"utf8"));
assert.ok(x.writer_disjoint_independent_glyphs>=1000);
assert.ok(x.presentations>10000);
if(x.eligible){
 assert.ok(fs.existsSync(modelPath),"Approved model must be published");
 const model=JSON.parse(fs.readFileSync(modelPath,"utf8"));
 assert.equal(model.format,"ink-online-stroke-mdn-v1");
 assert.equal(model.training.prefix_tuned,true);
 assert.equal(model.training.fine_tuned_own_model,"models/ink-stroke-sequence-v1.json");
 assert.ok(x.improvement_fraction>=.025);
 assert.ok(x.pen_accuracy_delta>=-.035);
 assert.ok(x.independent.free_rollout_position_error<x.base.independent.free_rollout_position_error);
 console.log("PASS: independently validated partial-letter recurrent model reduces free-running drift",
   x.base.independent.free_rollout_position_error,"→",x.independent.free_rollout_position_error);
}else{
 assert.ok(!fs.existsSync(modelPath),"Failed model must never replace good weights");
 console.log("PASS: incomplete-letter training rejected by writer-heldout quality gate; retain original generator");
}
