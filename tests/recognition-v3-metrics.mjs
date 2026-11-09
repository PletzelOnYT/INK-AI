import fs from "node:fs";
import assert from "node:assert/strict";

const metrics="models/recognition-v3-metrics.json";
const modelPath="models/ink-cnn-v3.json";
if(!fs.existsSync(metrics)){
 console.log("V3 pending: real-pen writer-disjoint training has not published an evaluation yet");
 process.exit(0);
}
const result=JSON.parse(fs.readFileSync(metrics,"utf8"));
const baseline=result.baseline_v2?.pen_independent;
assert.ok(baseline?.tested>=1100,"Missing genuine independent writer baseline");
assert.ok(result.uji_independent_glyphs>=1100);
if(result.eligible){
 assert.ok(fs.existsSync(modelPath),"Accepted V3 must publish weights");
 const model=JSON.parse(fs.readFileSync(modelPath,"utf8"));
 assert.equal(model.format,"ink-cnn-int8-v1");
 assert.equal(model.training.finetuned_from,"models/ink-cnn-v2.json");
 assert.equal(model.layers?.length,5);
 assert.equal(model.labels.length,102);
 assert.ok(result.independent_pen_v3?.tested>=1100);
 const old=baseline.overall;
 const now=result.independent_pen_v3.overall;
 assert.ok(now>=old+.025,"V3 improvement on unseen pen writers too small: "+old+" vs "+now);
 const emBefore=result.baseline_v2.emnist_browser_style.overall;
 const emAfter=result.best?.emnist?.overall;
 assert.ok(emAfter>=emBefore-.055,"New handwriting model breaks EMNIST beyond permitted gate");
 console.log("PASS: real writer heldout V3 recognition improved",old,"→",now,
             "EMNIST-style",emBefore,"→",emAfter);
}else{
 assert.ok(!fs.existsSync(modelPath),"Failed V3 must not silently be used");
 console.log("PASS: V3 failed writer holdout release gate; validated V2 remains selected");
}
