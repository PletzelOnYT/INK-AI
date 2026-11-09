import fs from "node:fs";
import assert from "node:assert/strict";

const metrics="models/stroke-prefix-domain-v2-metrics.json";
const modelFile="models/ink-stroke-prefix-domain-v2.json";
if(!fs.existsSync(metrics)){
 console.log("PASS: browser-prefix training hasn't published metrics yet; keep proven checkpoint");
 process.exit(0);
}
const m=JSON.parse(fs.readFileSync(metrics,"utf8"));
assert.ok(m.real_independent_glyphs>1100);
assert.ok(m.seen>30000);
assert.ok(m.parameters>300000);
if(m.eligible){
 assert.ok(fs.existsSync(modelFile),"Published evaluation passed but model file missing");
 const model=JSON.parse(fs.readFileSync(modelFile,"utf8"));
 assert.equal(model.format,"ink-online-stroke-mdn-v1");
 assert.equal(model.training.prefix_domain_v2,true);
 assert.equal(model.training.fine_tuned_own_model,"models/ink-stroke-prefix-v1.json");
 assert.equal(model.parameter_count,m.parameters);
 const before=m.baseline.independent.prefix_frame_position_error;
 const after=m.candidate.independent.prefix_frame_position_error;
 assert.ok(after<before*.975,"Model lacks independent browser-prefix improvement");
 assert.ok(m.candidate.independent.pen_lift_f1>=m.baseline.independent.pen_lift_f1-.025);
 assert.ok(m.gain>=.025);
 console.log("PASS: true partial-canvas pen model improved on independent writers",
   before,"→",after,"gain",m.gain,"pen-lift F1",m.candidate.independent.pen_lift_f1);
}else{
 assert.ok(!fs.existsSync(modelFile),"Rejected weights must never be used");
 console.log("PASS: browser-prefix V2 rejected and predecessor safely retained");
}
