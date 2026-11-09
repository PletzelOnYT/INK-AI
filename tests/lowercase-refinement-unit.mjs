import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source=fs.readFileSync("src/recognition_refinement.js","utf8");
const html=fs.readFileSync("index.html","utf8");
assert.ok(html.includes(source.trim()),"App HTML and recognition refinement must stay in sync");
assert.ok(!html.includes("drawCorrectionGlyph"),"Keep neural gray stroke continuations");
assert.ok(!html.includes("correction-bar"),"Do not change the original minimal interface");
const context={Math};
vm.createContext(context);
vm.runInContext(source,context);
const {dottedStemEvidence,openCStrokeEvidence,refinedLetterAt}=context;
function image(width=160,height=160){
 const data=new Uint8ClampedArray(width*height*4);
 data.fill(255);
 const put=(x0,y0,x1,y1)=>{
  for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
   const p=(y*width+x)*4;
   data[p]=data[p+1]=data[p+2]=0;
  }
 };
 return {data,width,height,put};
}
const pixels=image();
pixels.put(62,14,71,23);
pixels.put(80,66,87,120);
const region={box:[61,14,88,120],line:0,space:false};
assert.ok(dottedStemEvidence(region,pixels),"Off-center dot above vertical stem should count as lowercase i");
const options=[{char:";",confidence:.53},{char:"i",confidence:.36},{char:"j",confidence:.09}];
assert.equal(refinedLetterAt(0,[region],[{top:options}],pixels,[],";"),"i");
const noDot=image();
noDot.put(80,25,88,120);
assert.equal(dottedStemEvidence({box:[80,25,88,120]},noDot),false);
const colon=image();colon.put(62,14,70,23);colon.put(62,66,70,78);
assert.equal(dottedStemEvidence({box:[62,14,70,78]},colon),false,"Two tiny dots must not become i");
const bang=image();bang.put(80,14,88,85);bang.put(80,115,88,123);
assert.equal(dottedStemEvidence({box:[80,14,88,123]},bang),false,"! has dot below stem");
const hooked=image();hooked.put(80,14,88,23);hooked.put(61,68,94,123);
assert.equal(dottedStemEvidence({box:[61,14,94,123]},hooked),false,"Don't call a broad hooked j an i");
const cPoints=[[340,214],[321,205],[302,209],[288,225],[282,246],
               [284,271],[298,290],[317,297],[338,288]];
const cRegion={box:[282,205,340,297],line:0,space:false};
assert.equal(openCStrokeEvidence(cRegion,[{tool:"pen",points:cPoints}]),true);
const bracket=[[340,205],[282,205],[282,250],[282,297],[340,297]];
assert.equal(openCStrokeEvidence(cRegion,[{tool:"pen",points:bracket}]),false,
 "Square bracket must not be forced to c");
const lowerNeighbor=[{box:[10,55,60,115],line:0,space:false},
 {box:[90,42,105,120],line:0,space:false}];
const shortWord=[{top:[{char:"C",confidence:.56},{char:"c",confidence:.38}]},
 {top:[{char:"i",confidence:.6}]}];
assert.equal(refinedLetterAt(0,lowerNeighbor,shortWord,noDot,[],"C"),"c",
 "Compact c next to actual lowercase i should be lowercase");
const highFirst=[{box:[10,10,60,116],line:0,space:false},lowerNeighbor[1]];
assert.equal(refinedLetterAt(0,highFirst,[
 {top:[{char:"c",confidence:.51},{char:"C",confidence:.4}]},
 shortWord[1]],noDot,[],"c"),"C",
 "A taller C beside lowercase i should preserve uppercase when plausible");
const plainVertical=[{box:[80,25,88,120],line:0,space:false}];
assert.equal(refinedLetterAt(0,plainVertical,[
 {top:[{char:"|",confidence:.5},{char:"i",confidence:.3}]}],noDot,[],"|"),"|");
console.log("PASS: dotted i with offset dot, colon/! guards, lowercase c context, uppercase C preservation, punctuation safety");
