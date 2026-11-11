import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const code=readFileSync(new URL("../src/camera_text_detector.js",import.meta.url),"utf8");
assert.doesNotThrow(()=>new vm.Script(code));
const context={module:{exports:{}},Uint8Array,Uint32Array,Int32Array,Map,Math};
vm.runInNewContext(code,context);
const detector=context.module.exports;
assert.ok(detector.detect&&detector.findTextLines&&detector.makeMasks);
const width=320,height=140;
function maskForText(){
 const mask=new Uint8Array(width*height);
 // A printed row of similarly sized, separated glyphs.
 for(let i=0;i<10;i++){
  const x=20+i*18,y=55+Math.round(i*.2);
  for(let dy=0;dy<16;dy++)for(let dx=0;dx<9;dx++){
   if(dx===0||dx===8||dy===0||dy===15)
     mask[(y+dy)*width+x+dx]=1;
  }
 }
 return mask;
}
const detected=detector.findTextLines(maskForText(),width,height);
assert.ok(detected.some(line=>line.letters.length>=8),
 "Connected-component segmentation should find a row of text");
const blank=detector.findTextLines(new Uint8Array(width*height),width,height);
assert.equal(blank.length,0);
function maskForCabinet(){
 const mask=new Uint8Array(width*height);
 for(let k=0;k<8;k++){
  const x=15+k*34;
  for(let y=8;y<128;y++)mask[y*width+x]=1;
 }
 return mask;
}
assert.equal(detector.findTextLines(maskForCabinet(),width,height).length,0,
 "Tall cabinet seams are not a text line");
// Tight, high-contrast two-letter garment labels should be eligible even
// when they are not ordinary dictionary words.
function shortLabelMask(){
 const mask=new Uint8Array(width*height);
 for(const start of [30,51]){
  for(let y=50;y<74;y++)for(let x=start;x<start+11;x++)
   if(x===start||x===start+10||y===50||y===73)
    mask[y*width+x]=1;
 }
 return mask;
}
const shortLines=detector.findTextLines(shortLabelMask(),width,height,true);
assert.ok(shortLines.some(line=>line.letters.length===2),
 "Short uppercase abbreviations should be detected in high-contrast mode");
console.log("PASS: printed-character grouping and no-text rejection");
