import fs from "node:fs";
import assert from "node:assert/strict";
const get=name=>JSON.parse(fs.readFileSync("models/"+name,"utf8"));
const manifest=JSON.parse(fs.readFileSync("docs/current-models.json","utf8"));
const v3=get("recognition-v3-metrics.json");
const v5=get("recognition-v5-metrics.json");
const v4=get("recognition-v4-evaluation-summary.json");
const v2=get("stroke-prefix-domain-v2-metrics.json");
const seq=get("stroke-sequence-v2-metrics.json");
const pen=get("penlift-v3-metrics.json");
const lift=get("recurrent-lift-v5-metrics.json");
const readme=fs.readFileSync("README.md","utf8");
const recog=fs.readFileSync("docs/recognition-vertical-bars.svg","utf8");
const comp=fs.readFileSync("docs/completion-vertical-bars.svg","utf8");
function pct(v){return (100*v).toFixed(2)+"%"}
function err(v){return v.toFixed(4)}
for(const [file,svg] of [["recognition-vertical-bars.svg",recog],["completion-vertical-bars.svg",comp]]){
 assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
 assert.ok(svg.trimEnd().endsWith("</svg>"));
 assert.ok(!/<script|onload=|<foreignObject/i.test(svg));
 assert.ok(readme.includes("./docs/"+file));
 assert.ok(svg.includes('fill="#ffffff"'),"Chart must have white background");
 assert.equal((svg.match(/data-active="true"/g)||[]).length,2,"Each metric panel must mark the same single deployed model");
 assert.ok(svg.includes("<path d="),"Version timeline must have connected milestone paths");
 assert.ok(svg.includes('width="900" height="488"'),"Graph must fit the GitHub README without horizontal overflow");
 assert.ok(!svg.includes('>Completer</text>')&&!svg.includes('>Recognizer</text>'),"README already labels these graphs; avoid duplicate titles");
 assert.ok(!svg.includes("Dotted line =")&&!svg.includes("Two DIFFERENT"),"Remove noisy annotations");

 assert.ok(svg.includes("data-metric=\"first\"") && svg.includes("data-metric=\"second\""),"Need two separate metric panels");
}
const liveCnn=manifest.recognizer.weights,liveGru=manifest.completer.weights;
assert.ok(recog.includes('data-active="true" data-weight="'+liveCnn+'"'),"CNN blue must match actual HTML manifest");
assert.ok(comp.includes('data-active="true" data-weight="'+liveGru+'"'),"GRU blue must match actual HTML manifest");
assert.ok(recog.includes('fill="#2563eb"'),"Deployed CNN must be highlighted blue");
assert.ok(comp.includes('fill="#2563eb"'),"Deployed GRU must be highlighted blue");
for(const version of [1,2,3,4,5])
 assert.ok(recog.includes('data-model="CNN V'+version+'"'),"Missing CNN version "+version);
for(const s of [pct(v3.baseline_v2.pen_independent.overall),pct(v3.independent_pen_v3.overall),pct(v4.independent_uji_v4.overall),pct(v5.independent_pen_v3.overall)])
 assert.ok(recog.includes(s),"Missing measured independent-writer accuracy "+s);
assert.ok(recog.includes("84.96%"),"CNN V1 should have its actual EMNIST score");
for(const name of ["Sequence V1","Sequence V2","Prefix V1","Domain V2","PenLift V3",
                   "Domain V3","Domain V4","Natural V4","Lift V5","Domain V6","Domain V7"]){
 assert.ok(comp.includes('data-model="'+name+'"'),"Missing completer experiment "+name);
}
assert.ok(comp.includes(err(v2.candidate.independent.prefix_frame_position_error)));
assert.ok(comp.includes(err(pen.candidate.prefix_position.prefix_frame_position_error)));
assert.ok(comp.includes(err(lift.candidate.position.prefix_frame_position_error)));
assert.ok(comp.includes(pct(pen.candidate.independent.pen_lift_f1)));
assert.ok(comp.includes(pct(lift.candidate.independent.pen_lift_f1)));
assert.ok(comp.includes("NLL "+seq.baseline_v1.independent.nll.toFixed(3)),"Missing legacy V1 NLL");
assert.ok(comp.includes("NLL "+seq.v2.independent.nll.toFixed(3)),"Missing legacy V2 NLL");
assert.ok(comp.includes('data-model="Domain V7"'),"V7 still appears with pending status even without metrics");
assert.ok(comp.includes('stroke-width="1.8"'),"Large rejected V5 outlier requires a visibly broken axis instead of compressing the other results");
assert.ok(comp.includes('0.9673'),"V5 outlier value must stay visible and unchanged");
assert.ok(readme.includes("a real CNN, not nearest-template matching"));
assert.ok(readme.includes("a real generative GRU, not a font or curve lookup"));
assert.ok(readme.includes("**not** perfect-font replacements"));
assert.ok(readme.includes("whole-character suggestion acceptance/correctness rate"));
for(const [svg,live] of [[recog,liveCnn],[comp,liveGru]]){
 for(const metric of ["first","second"]){
  const groups=[...svg.matchAll(/<g data-model="([^"]+)" data-active="true" data-weight="([^"]+)" data-metric="([^"]+)"/g)]
   .filter(m=>m[3]===metric);
  assert.equal(groups.length,1,"One active milestone per metric");
  assert.equal(groups[0][2],live,"Blue node must match build manifest");
 }
}
console.log("PASS: connected milestone timeline, two distinct metrics, measured scores and one blue deployed model");
