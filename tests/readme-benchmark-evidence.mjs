import fs from "node:fs";
import assert from "node:assert/strict";
const get=name=>JSON.parse(fs.readFileSync("models/"+name,"utf8"));
const v3=get("recognition-v3-metrics.json");
const p=get("stroke-prefix-metrics.json");
const d=get("stroke-prefix-domain-v2-metrics.json");
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
for(const x of [p.improvement_fraction,d.gain])
 assert.ok(comp.includes(pct(x)),"Completer bar is not a measured GRU error reduction");
assert.equal((recog.match(/<rect x=/g)||[]).length,3,"Three vertical recognizer bars");
assert.equal((comp.match(/<rect x=/g)||[]).length,2,"Two vertical completer bars");
assert.ok(readme.includes("a real CNN, not nearest-template matching"));
assert.ok(readme.includes("a real generative GRU, not a font or curve lookup"));
assert.ok(readme.includes("**not** perfect-font replacements"));
assert.ok(readme.includes("whole-character suggestion acceptance/correctness rate"));
console.log("PASS: minimal README includes real, separate vertically plotted CNN and GRU evidence");
