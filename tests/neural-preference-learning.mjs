import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const moduleText=fs.readFileSync("src/neural_preference_model.js","utf8");
const records=new Map();
const storage={getItem:k=>records.get(k)||null,setItem:(k,v)=>records.set(k,v),
 removeItem:k=>records.delete(k)};
const root={};
vm.runInNewContext(moduleText,{window:root,Math,Array,Number,JSON,Set,Map});
const model=root.InkPreferenceAI.create(storage);
const candidate=(y,straight)=>({
 label:"h",score:1,quality:-.2,rolloutLogLikelihood:3,confidence:.8,
 _finishedConfidence:.65,paths:straight?
 [[[.2,.25],[.4,.17],[.7,.06]]]:
 [[[.2,.25],[.26,.35],[.33,.42],[.35,y]]]
});
const good=candidate(.72,false),bad=candidate(.06,true);
const pending={frame:{x:50,y:80,size:200},lastInk:[90,130]};
assert.equal(model.examples,0);
assert.deepEqual(model.rank([bad,good],pending),[bad,good],
 "Untrained network must not rearrange suggestions");
const initial=model.predict(good,pending)-model.predict(bad,pending);
for(let i=0;i<50;i++)assert.ok(model.learn(good,[good,bad],pending));
const trained=model.predict(good,pending)-model.predict(bad,pending);
console.log("TRAINED PREFERENCE MARGIN",initial,trained);
assert.ok(trained>initial+.002,"Positive G feedback should teach a neural preference");
assert.equal(model.examples,50);
assert.equal(model.rank([bad,good],pending)[0],good,
 "After training, accepted pen geometry should outrank rejected geometry");
assert.ok(![...records.values()][0].includes("paths"),"No handwritten path data saved");
const restored=root.InkPreferenceAI.create(storage);
assert.equal(restored.examples,50);
assert.ok(Math.abs(restored.predict(good,pending)-model.predict(good,pending))<1e-9);
restored.reset();assert.equal(restored.examples,0);
assert.equal(records.size,0);
storage.setItem("ink-ai-preferences-v1",'{"version":1,"seen":12,"w1":[999]}');
assert.equal(root.InkPreferenceAI.create(storage).examples,0,
 "Malformed saved neural weights should be ignored");
console.log("PASS: real 14-12-1 on-device neural preference training, persistence and no ink storage");
