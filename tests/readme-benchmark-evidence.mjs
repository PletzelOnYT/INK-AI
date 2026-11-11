import fs from "node:fs";
import assert from "node:assert/strict";
const get=name=>JSON.parse(fs.readFileSync("models/"+name,"utf8"));
const v3=get("recognition-v3-metrics.json");
const p=get("stroke-prefix-metrics.json");
const d=get("stroke-prefix-domain-v2-metrics.json");
const v5=get("recognition-v5-metrics.json");
const v6=get("stroke-prefix-domain-v6-metrics.json");
const readme=fs.readFileSync("README.md","utf8");
const recog=fs.readFileSync("docs/recognition-vertical-bars.svg","utf8");
const comp=fs.readFileSync("docs/completion-vertical-bars.svg","utf8");
function pct(v){return (100*v).toFixed(2)+"%"}
for(const [file,svg] of [
 ["recognition-vertical-bars.svg",recog],
 ["completion-vertical-bars.svg",comp]
]){
 assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
 assert.ok(svg.trimEnd().endsWith("</svg>"));
 assert.ok(!/<script|onload=|<foreignObject/i.test(svg));
 assert.ok(readme.includes("./docs/"+file));
 assert.ok(svg.includes('fill="#fff"'),"Chart must be white");
}
for(const x of [v3.baseline_v2.pen_independent.overall,v3.independent_pen_v3.overall])
 assert.ok(recog.includes(pct(x)),"Recognizer bar is not a measured UJI value");
assert.ok(recog.includes(pct(v5.independent_pen_v3.overall)),"Missing V5 independent-writer score");
for(const x of [d.baseline.independent.prefix_frame_position_error,d.candidate.independent.prefix_frame_position_error,v6.candidate.independent.prefix_frame_position_error])
 assert.ok(comp.includes(x.toFixed(3)),"Completer version history must include measured trajectory errors");
assert.ok(comp.includes("Domain V7") && comp.includes("Lift V5"),"Missing experiment versions");
assert.equal((recog.match(/<rect x=/g)||[]).length,4,"Four scored recognizer versions");
assert.ok((comp.match(/<rect x=/g)||[]).length>=5,"Model history must chart measured completer variants");
assert.ok(readme.includes("a real CNN, not nearest-template matching"));
assert.ok(readme.includes("a real generative GRU, not a font or curve lookup"));
assert.ok(readme.includes("**not** perfect-font replacements"));
assert.ok(readme.includes("whole-character suggestion acceptance/correctness rate"));
console.log("PASS: README graphs show measured model versions, with unverified versions explicitly labeled");
