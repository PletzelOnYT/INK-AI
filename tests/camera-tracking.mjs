import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/camera_tracking.js",import.meta.url),"utf8");
const win={};
vm.runInNewContext(source,{window:win,Date,Math,Number,Map,Set,Uint8Array});
const core=win.InkCameraCore;
assert.ok(core?.createTracker&&core?.projectBox&&core?.createSceneMonitor);
assert.equal(core.looksLikeWord("Jmz5",.99),false);
assert.equal(core.looksLikeWord("JmzS",.99),false);
assert.equal(core.looksLikeWord("Chromebook",.84),true);
const preds=word=>[...word].map(ch=>({top:[
 {char:ch,confidence:.82},{char:"z",confidence:.09}]}));
const valid=core.decodePrintedWord(preds("Thank"),["thank","think","thunk"]);
assert.equal(valid.text,"Thank");
assert.ok(valid.confidence<=.83,
 "Dictionary correction must never inflate model confidence");
assert.equal(core.decodePrintedWord(preds("JmzS"),["nancy","thank"]),null,
 "Unrelated dictionary entries must not be invented from visual noise");
// When a printed glyph is ambiguous in one frame, aggregate its actual
// neural probabilities over multiple frames rather than forcing a word.
const evidence=core.createGlyphEvidenceTracker();
const fusionBox={x0:30,y0:20,x1:170,y1:46};
const fusionPolygon=[{x:30,y:20},{x:170,y:20},{x:170,y:46},{x:30,y:46}];
const glyphs=(noisy=false)=>[..."Thank"].map((ch,i)=>({top:
 noisy&&i===2?[{char:"m",confidence:.41},{char:ch,confidence:.40}]:
 [{char:ch,confidence:.84},{char:"m",confidence:.07}]}));
const input=predictions=>({box:fusionBox,polygon:fusionPolygon,
 angle:20,predictions});
assert.equal(evidence.update([input(glyphs(true))],2000).length,0);
let joined=evidence.update([input(glyphs())],2160);
assert.equal(joined.length,1);
assert.equal(joined[0].predictions.map(p=>p.top[0].char).join(""),"Thank");
joined=evidence.update([input(glyphs())],2300);
const fusedWord=core.decodePrintedWord(joined[0].predictions,["thank","think"]);
assert.equal(fusedWord.text,"Thank");
assert.ok(fusedWord.confidence<.9,
 "Evidence fusion must not invent certainty absent from the source CNN");
evidence.reset();
assert.equal(evidence.update([],2500).length,0);
const b={x0:120,y0:75,x1:310,y1:110},poly=[
 {x:120,y:75},{x:310,y:75},{x:310,y:110},{x:120,y:110}];
const item={text:"Chromebook",confidence:.82,box:b,polygon:poly,angle:28};
const tracker=core.createTracker();
assert.equal(tracker.update([item],1000).text,"");
assert.equal(tracker.update([item],1150).text,"");
assert.equal(tracker.update([item],1300).text,"Chromebook");
assert.equal(tracker.snapshot(1400).words.length,1);
assert.equal(tracker.update([],2600).text,"Chromebook",
 "One missed scan should not make the word flicker");
assert.equal(tracker.update([],4700).text,"",
 "A removed document must not leave old words on screen indefinitely");
const word1={...item,text:"Thank",angle:0,box:{x0:100,y0:20,x1:180,y1:44}};
const word2={...item,text:"you",angle:0,box:{x0:190,y0:20,x1:246,y1:44}};
for(let i=0;i<3;i++)tracker.update([word2,word1],5000+i*150);
assert.equal(tracker.snapshot(5500).text,"Thank you",
 "Transcription must follow reading order, not detection order");
const word3={...item,text:"November",box:{x0:100,y0:75,x1:250,y1:100}};
for(let i=0;i<3;i++)tracker.update([word3],5650+i*130);
assert.equal(tracker.snapshot(6100).text,"Thank you\nNovember",
 "Separate lines must remain in document order");
tracker.reset();
assert.equal(tracker.snapshot(6500).text,"");
const monitor=core.createSceneMonitor();
const frame=(r,g,b)=>new Uint8Array(Array.from({length:24*14},()=>[r,g,b,255]).flat());
assert.equal(monitor.update(frame(240,235,223),1000).changed,false);
assert.equal(monitor.update(frame(237,233,220),1100).changed,false);
assert.equal(monitor.update(frame(67,78,91),1200).changed,true,
 "A paper replaced by a room must reset the old transcript");
assert.equal(monitor.update(frame(68,80,90),1300).changed,false);
for(const angle of [-85,-60,-40,-20,0,20,40,60,85]){
 const source={width:640,height:360},radians=angle*Math.PI/180;
 const w=Math.ceil(Math.abs(Math.cos(radians))*640+Math.abs(Math.sin(radians))*360);
 const h=Math.ceil(Math.abs(Math.cos(radians))*360+Math.abs(Math.sin(radians))*640);
 const dx=290-320,dy=120-180;
 const x=w/2+Math.cos(radians)*dx-Math.sin(radians)*dy;
 const y=h/2+Math.sin(radians)*dx+Math.cos(radians)*dy;
 const back=core.pointFromRotated(x,y,{width:w,height:h,angle},source);
 assert.ok(Math.abs(back.x-290)<1e-8&&Math.abs(back.y-120)<1e-8);
}
console.log("PASS: no dictionary hallucinations, spatial consensus, reading order, scene reset and angled mapping");
