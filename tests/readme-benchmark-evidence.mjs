import fs from "node:fs";
import assert from "node:assert/strict";
const get=(s)=>JSON.parse(fs.readFileSync("models/"+s,"utf8"));
const v2=get("recognition-v2-metrics.json"),v3=get("recognition-v3-metrics.json");
const r=get("glyph-completion-comparison.json"),p=get("stroke-prefix-metrics.json"),d=get("stroke-prefix-domain-v2-metrics.json");
const pen=get("penlift-v3-metrics.json");
const readme=fs.readFileSync("README.md","utf8");
const recognition=fs.readFileSync("docs/recognition-progress.svg","utf8");
const completion=fs.readFileSync("docs/completion-progress.svg","utf8");
function pct(num){return (100*num).toFixed(2)+"%"}
const values=[
 [readme,pct(v2.baseline.lowercase_macro),"V1 lowercase macro"],
 [readme,pct(v2.best.metrics.lowercase_macro),"V2 lowercase macro"],
 [readme,pct(v3.baseline_v2.pen_independent.overall),"V2 UJI"],
 [readme,pct(v3.independent_pen_v3.overall),"V3 UJI"],
 [readme,pct(r.v1.missing_ink_f1),"Raster V1 F1"],
 [readme,pct(r.v2.missing_ink_f1),"Raster V2 F1"],
 [readme,pct(p.improvement_fraction),"Prefix V1 error gain"],
 [readme,pct(d.gain),"Prefix-domain V2 error gain"],
 [recognition,pct(v3.baseline_v2.pen_independent.overall),"Recognition graph V2"],
 [recognition,pct(v3.independent_pen_v3.overall),"Recognition graph V3"],
 [recognition,pct(v2.baseline.lowercase_macro),"Recognition graph lowercase V1"],
 [recognition,pct(v2.best.metrics.lowercase_macro),"Recognition graph lowercase V2"],
 [completion,pct(r.v1.missing_ink_f1),"Completion graph raster V1"],
 [completion,pct(r.v2.missing_ink_f1),"Completion graph raster V2"],
 [completion,pct(p.improvement_fraction),"Completion graph prefix gain"],
 [completion,pct(d.gain),"Completion graph prefix-domain gain"]
];
for(const [body,value,tag] of values)assert.ok(body.includes(value),tag+" missing "+value);
for(const [filename,svg] of [["recognition-progress.svg",recognition],["completion-progress.svg",completion]]){
 assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
 assert.ok(svg.trimEnd().endsWith("</svg>"));
 assert.ok(!/<script|onload=|<foreignObject/i.test(svg),"SVG should remain a static chart");
 assert.ok(readme.includes("./docs/"+filename),"README missing graph "+filename);
}
assert.ok(readme.includes("**not** the live completer")&&readme.includes("not a percent of correct suggestions"),
 "Raster and trajectory metrics must never be misrepresented as current completion success");
assert.ok(readme.includes("a real CNN, not nearest-template matching"));
assert.ok(readme.includes("a real generative GRU, not a font or curve lookup"));
assert.equal(d.candidate.independent.pen_lift_f1,0);
assert.equal(p.writer_disjoint_independent_glyphs,1550);
assert.equal(v3.independent_pen_v3.tested,1551);
assert.ok(!readme.includes("flawless")||readme.includes("no model here is flawless"));
assert.ok(pen.eligible===false);
console.log("PASS: README charts match published measured metrics, explain neural models, and avoid false completion success claims");
