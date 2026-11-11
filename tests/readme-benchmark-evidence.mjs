import fs from "node:fs";
import assert from "node:assert/strict";
const read=p=>fs.readFileSync(p,"utf8");
const model=p=>JSON.parse(read("models/"+p));
const manifest=JSON.parse(read("docs/current-models.json"));
const readme=read("README.md");
const recog=read("docs/recognition-vertical-bars.svg");
const comp=read("docs/completion-vertical-bars.svg");

function podium(svg,file) {
 assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'),file+" must be SVG");
 assert.ok(svg.includes('width="900" height="394"'),file+" must fit README");
 assert.ok(svg.trimEnd().endsWith("</svg>"));
 assert.ok(!/<script|onload=|<foreignObject/i.test(svg));
 assert.ok(readme.includes("./docs/"+file));
 for(const shade of ["ink-gold","ink-silver","ink-bronze"])
  assert.ok(svg.includes('id="'+shade+'"'),file+" missing "+shade);
 const placements=[...svg.matchAll(/<g data-model="([^"]+)" data-weight="([^"]+)" data-rank="([123])" data-active="(true|false)" data-score="([^"]+)" data-status="([^"]+)">/g)];
 assert.equal(placements.length,3,file+" must show exactly three ranked models");
 assert.deepEqual(placements.map(p=>Number(p[3])),[1,2,3],file+" medals must be in rank order");
 const scores=placements.map(p=>Number(p[5]));
 assert.ok(scores.every(Number.isFinite)&&scores.every(x=>Number.isFinite(x)),"missing score");
 assert.ok(scores[0]>=scores[1]&&scores[1]>=scores[2],"podium must be sorted highest first");
 for(let i=0;i<3;i++){
  const m=placements[i];
  assert.ok(svg.includes(m[1]),"missing model name");
  assert.ok(svg.includes(scores[i].toFixed(2)+"%"),"missing displayed score");
 }
 assert.ok(!svg.includes("Trajectory error ↓")&&!svg.includes("Pen-lift F1 ↑"),
  "No old multi-panel graph legends");
 return placements.map(m=>({name:m[1],weight:m[2],rank:+m[3],active:m[4]==="true",score:+m[5],status:m[6]}));
}
const rankedR=podium(recog,"recognition-vertical-bars.svg");
const rankedC=podium(comp,"completion-vertical-bars.svg");
const v3=model("recognition-v3-metrics.json");
const v4=model("recognition-v4-evaluation-summary.json");
const v5=model("recognition-v5-metrics.json");
const expectedR=[
 ["CNN V5",v5.independent_pen_v3.overall*100],
 ["CNN V3",v3.independent_pen_v3.overall*100],
 ["CNN V4",v4.independent_uji_v4.overall*100],
];
expectedR.forEach(([name,score],i)=>{
 assert.equal(rankedR[i].name,name,"recognizer ranking");
 assert.ok(Math.abs(rankedR[i].score-score)<0.000001);
});
assert.equal(rankedR[0].weight,manifest.recognizer.weights,"shipped recognizer is gold");
assert.ok(rankedR[0].active);
const domain2=model("stroke-prefix-domain-v2-metrics.json");
const domain3=model("stroke-prefix-domain-v3-metrics.json");
const domain6=model("stroke-prefix-domain-v6-metrics.json");
const domain7=model("stroke-prefix-domain-v7-metrics.json");
const base=domain2.baseline.independent.prefix_frame_position_error;
const rankedCandidates=[
 ["Domain V2",domain2.candidate.independent.prefix_frame_position_error],
 ["Domain V3",domain3.candidate.independent.prefix_frame_position_error],
 ["Domain V6",domain6.candidate.independent.prefix_frame_position_error],
 ["Domain V7",domain7.candidate.independent.prefix_frame_position_error],
].map(([name,error])=>[name,100*(base-error)/base]).sort((a,b)=>b[1]-a[1]).slice(0,3);
for(let i=0;i<3;i++){
 assert.equal(rankedC[i].name,rankedCandidates[i][0],"completer score ranking");
 assert.ok(Math.abs(rankedC[i].score-rankedCandidates[i][1])<0.000001);
}
assert.ok(!rankedC.some(m=>m.active),"Unreleased experimental Completers must not be labeled active");
assert.equal(manifest.completer.weights,"models/ink-stroke-prefix-domain-v2.json");
assert.ok(readme.includes("not a success rate")&&readme.includes("research"),
 "README must explain that trajectory reduction is not overall quality or release approval");
assert.ok(readme.includes("a real CNN, not nearest-template matching"));
assert.ok(readme.includes("a real generative GRU, not a font or curve lookup"));
console.log("PASS: two honest 3-model medal podiums, measured scores and release distinction");
