import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/camera_tracking.js",import.meta.url),"utf8");
const win={};
vm.runInNewContext(source,{window:win,Date,Math,Number,Map,Set});
const core=win.InkCameraCore;
assert.ok(core?.createTracker&&core?.projectBox&&core?.anglesForPass);
const box={x0:120,y0:75,x1:310,y1:110};
const polygon=[{x:120,y:75},{x:310,y:75},{x:310,y:110},{x:120,y:110}];
const t=core.createTracker();
let state=t.update([{text:"Chromebook",confidence:.90,box,polygon,angle:40}],1000);
assert.equal(state.text,"Chromebook","Strong words must be shown on the first scan");
assert.equal(state.words.length,1);
assert.equal(state.activeAngle,40);
state=t.update([],1300);
assert.equal(state.text,"Chromebook","One missed scan must not erase recognized text");
state=t.update([],3700);
assert.equal(state.text,"Chromebook","Transcript survives disappearance from camera");
assert.equal(state.words.length,0,"Old highlighters must eventually expire");
state=t.update([{text:"Chromebook",confidence:.92,box,polygon,angle:40}],3900);
assert.equal(state.text,"Chromebook","Recurring frames must not append duplicate words");
state=t.update([{text:"Laptop",confidence:.47,box:{x0:135,y0:120,x1:230,y1:146},polygon,angle:0}],4100);
assert.equal(state.text,"Chromebook","Weak one-frame reading is not committed");
state=t.update([{text:"Laptop",confidence:.48,box:{x0:136,y0:121,x1:231,y1:147},polygon,angle:0}],4260);
assert.equal(state.text,"Chromebook Laptop","A second matching reading confirms a word");
t.reset();
assert.equal(t.snapshot(4300).text,"","Camera shutdown must clear its session");

function rotate(x,y,angle,source){
 const rad=angle*Math.PI/180,c=Math.cos(rad),s=Math.sin(rad);
 const width=Math.ceil(Math.abs(c)*source.width+Math.abs(s)*source.height);
 const height=Math.ceil(Math.abs(c)*source.height+Math.abs(s)*source.width);
 const dx=x-source.width/2,dy=y-source.height/2;
 return {x:width/2+c*dx-s*dy,y:height/2+s*dx+c*dy,width,height};
}
for(const angle of [-85,-60,-40,-20,0,20,40,60,85]){
 const source={width:640,height:360};
 const p=rotate(290,120,angle,source);
 const back=core.pointFromRotated(p.x,p.y,{angle,width:p.width,height:p.height},source);
 assert.ok(Math.abs(back.x-290)<1e-8&&Math.abs(back.y-120)<1e-8,
  "Rotated camera coordinates must map back to video at "+angle+" degrees");
}
for(let pass=0;pass<4;pass++)assert.ok(core.anglesForPass(pass,null).some(a=>a!==0),
 "Every camera scan must include an angled view");
assert.deepEqual([...core.anglesForPass(0,40)].sort((a,b)=>a-b),[-20,0,20,40]);
console.log("PASS: fast first-read, persistent transcript, no duplicate words, multi-angle mapping");
