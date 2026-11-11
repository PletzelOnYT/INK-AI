import fs from "node:fs";
import assert from "node:assert/strict";
import vm from "node:vm";

const exists=path=>fs.existsSync(path);
const read=path=>fs.readFileSync(path,"utf8");
const json=path=>JSON.parse(read(path));
const app=read("src/app.js"),worker=read("src/stroke_worker.js");
new vm.Script(app,{filename:"src/app.js"});
new vm.Script(worker,{filename:"src/stroke_worker.js"});

const main=read("scripts/build_standalone.py");
assert.ok(app.includes("STROKE_PREFIX_DOMAIN_V7_URL"),"V7 release URL not wired");
assert.ok(app.includes("saved.training?.prefix_domain_v7"),"Bundled V7 would be rejected by the browser");
assert.ok(worker.includes("prefixDomainV7:Boolean(network.training?.prefix_domain_v7)"),"Worker cannot identify V7");
assert.ok(app.includes("m.prefixDomainV7?12:"),"Worker version not shown to user");
assert.ok(!app.includes('if(source.includes("v2") && !(candidate.training?.v2'),"Released Domain V2 confused with rejected sequence V2");
assert.ok(main.includes("trial.get(\"browser_integration_passed\") is True"),"Build must not ship unverified V7");
const sourceList=app.slice(app.indexOf('const sources=location.protocol==="file:"?'),app.indexOf("let model=null,lastError=null;"));
assert.ok(sourceList.indexOf("STROKE_PREFIX_DOMAIN_V7_URL")<sourceList.indexOf("STROKE_PREFIX_DOMAIN_V2_URL"),"V7 must be first released candidate");
assert.ok(!/STROKE_LIFT_V5_URL|STROKE_NATURAL_V4_URL|STROKE_PREFIX_DOMAIN_V4_URL|STROKE_PREFIX_DOMAIN_V3_URL/.test(sourceList),"Rejected candidate appears in fallback list");

const c3=json("models/recognition-v3-metrics.json"),c5=json("models/recognition-v5-metrics.json");
for(const [n,p] of [["V3","models/ink-cnn-v3.json"],["V5","models/ink-cnn-v5.json"]]){
 const m=json(p);
 assert.equal(m.format,"ink-cnn-int8-v1",n+" wrong format");
 assert.equal(m.labels.length,102,n+" wrong labels");
 assert.equal(m.layers.length,5,n+" wrong architecture");
 assert.deepEqual(m.input,[1,32,32],n+" wrong input");
}
assert.ok(c5.independent_pen_v3.overall>c3.independent_pen_v3.overall,"V5 must improve unseen writer score");
const graphR=read("docs/recognition-vertical-bars.svg"),graphC=read("docs/completion-vertical-bars.svg");
for(let v=1;v<=5;v++)assert.ok(graphR.includes("CNN V"+v),"Recognizer graph missing V"+v);
for(const name of ["Sequence V1","Sequence V2","Prefix V1","Domain V2","PenLift V3","Domain V3","Domain V4","Natural V4","Lift V5","Domain V6","Domain V7"]) assert.ok(graphC.includes(name),"Completer graph missing "+name);
const rejected=["stroke-prefix-domain-v3-metrics.json","stroke-prefix-domain-v4-metrics.json","penlift-v3-metrics.json","stroke-natural-v4-metrics.json","recurrent-lift-v5-metrics.json","stroke-prefix-domain-v6-metrics.json"];
for(const file of rejected){
 const m=json("models/"+file);assert.equal(m.eligible,false,"Rejected experimental weights must not be treated as released: "+file);
}
const v7Metrics="models/stroke-prefix-domain-v7-metrics.json";
if(exists(v7Metrics)){
 const m=json(v7Metrics);
 assert.equal(m.candidate_version,7);
 if(m.deployable){
  assert.equal(m.eligible,true);
  assert.equal(m.browser_integration_passed,true);
  assert.ok(exists("models/ink-stroke-prefix-domain-v7.json"),"Deployable V7 lacks weights");
 }
}else{
 assert.ok(!graphC.includes("V7 released"),"V7 cannot be released without metrics");
 console.log("V7: waiting for trained writer-disjoint and browser-tested weights; released V2 remains default");
}
console.log("PASS: released-model selection, recognizer checkpoints, all version graphs and V7 integration");
