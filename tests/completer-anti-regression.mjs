import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const worker=fs.readFileSync("src/stroke_worker.js","utf8");
const application=fs.readFileSync("src/app.js","utf8");
const ui=fs.readFileSync("src/stroke_assist_ui.js","utf8");
const i=application.indexOf("function completionEvidence(");
const j=application.indexOf("async function scoreFinishedAlternatives(",i);
assert.ok(i>=0&&j>i);
const context={};vm.createContext(context);
vm.runInContext(application.slice(i,j),context);
const approval=context.completionEvidence;
assert.equal(approval(.67,.31,"h"),false,
 "A suggestion that destroys an already recognizable h must be rejected");
assert.equal(approval(.03,.015,"o"),false,
 "A weak random line must not receive a positive score");
assert.equal(approval(.23,.245,"o"),true,
 "A plausible completion that improves recognition should remain eligible");
assert.equal(approval(.92,.92,"h"),false,
 "Never add a tail to a finished, high-confidence letter");
for(const [name,source] of [["app",application],["isolated UI",ui]]){
 assert.match(source,/if\(option\.support&&option\.support\.ok!==true\)return false/,
  name+" must not bypass the worker's trained-trajectory quality checks");
 assert.match(source,/if\(!possibilities\.length&&m\.type==="completion"\)\s*\{\s*clearGhost\(\)/,
  name+" must erase a now-invalid stale suggestion");
 assert.doesNotMatch(source,/\(e\.key\.toLowerCase\(\)==="g"\|\|e\.key==="Enter"\)/,
  name+" must not accidentally accept neural ink on Enter");
 assert.match(source,/width:12,points:points\.map\(p=>p\.slice\(\)\)/,
  name+" must accept pen strokes at matching ink thickness");
}
assert.match(worker,/function trajectorySupport\(/);
assert.match(worker,/if\(!shape\.ok\)continue/);
assert.match(worker,/bestEarly=\{paths:visible\.map/,
 "Natural early-stop must preserve actual sampled neural vectors");
console.log("PASS: harmful ghosts rejected; independent recognition must improve; G-only ink acceptance and matching stroke width");
