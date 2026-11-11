import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const layout=fs.readFileSync(new URL("../src/camera_document_layout.js",import.meta.url),"utf8");
const source=fs.readFileSync(new URL("../src/camera_offline_bridge.js",import.meta.url),"utf8");
let polygonPoints=0;
const canvas={width:0,height:0,getContext:()=>({
 drawImage(){},setTransform(){},clearRect(){},beginPath(){},
 moveTo(){polygonPoints++},lineTo(){polygonPoints++},closePath(){},
 rect(){},roundRect(){},fill(){},stroke(){}
})};
const doc={createElement:type=>{
 assert.equal(type,"canvas");
 return {...canvas};
}};
let received=0,forceEmpty=false;
const capturedWidths=[];
const payload={width:1000,height:500,elapsedMs:125,lines:[
 {text:"NY THREADS",confidence:.95,box:{x0:90,y0:30,x1:490,y1:65},
  words:[
   {text:"NY",confidence:.99,box:{x0:90,y0:30,x1:180,y1:65},
    points:[{x:90,y:30},{x:180,y:27},{x:180,y:62},{x:90,y:65}]},
   {text:"THREADS",confidence:.97,box:{x0:200,y0:30,x1:490,y1:65}}
  ]}
]};
const engine={create:async()=>({
 recognize:async(c,w,h)=>{
  if(!forceEmpty){assert.equal(w,1000);assert.equal(h,500);}
  capturedWidths.push(w);
  received++;
  return forceEmpty?{width:w,height:h,lines:[],words:[]}:payload;
 }
})};
const context={window:{InkOfflineOCR:engine,devicePixelRatio:1},
 document:doc,Math,Number,Map,Set,Date};
vm.runInNewContext(layout,context);
vm.runInNewContext(source,context);
const api=context.window.InkOfflineCamera;
assert.equal(typeof api.connect,"function");
const client=await api.connect();
assert.equal(client.engine,"offline-tesseract-wasm");
const cam={videoWidth:1000,videoHeight:500};
let first=await client.recognize(cam);
let tracked=client.track(first,1000);
assert.equal(tracked.text,"NY THREADS","High-confidence real words appear immediately");
assert.equal(tracked.words.length,2);
client.paint({...canvas},cam,{clientWidth:1000,clientHeight:500},tracked);
assert.equal(polygonPoints,4,"Angled word highlighter must follow all four rotated text corners");
const empty={width:1000,height:500,lines:[]};
assert.equal(client.track(empty,4300).text,"","Old document words must expire after bounded OCR latency");
client.reset();
assert.equal(client.track(empty,4600).text,"");
assert.equal(received,1);
// A repeatedly unreadable 1920px frame must trigger full native detail,
// without imposing 1080p cost on clear normal scans.
forceEmpty=true;
client.reset();
for(let i=0;i<9;i++)await client.recognize({videoWidth:1920,videoHeight:1080});
assert.equal(capturedWidths[0],1000);
assert.ok(capturedWidths.slice(1).includes(1280));
assert.ok(capturedWidths.slice(1).includes(1267),"Native-resolution focus must preserve distant glyph pixels without full 1080p OCR");
assert.ok(capturedWidths.slice(1).every(w=>w<=1280),"Per-pass OCR width should remain bounded for speed");
const reader=api.createTracker();
const wrapped=reader.update({
 width:1000,height:500,
 lines:[
  {text:"This is the first part of a paragraph that",
   confidence:.95,visualQuality:.95,
   blockIndex:0,paragraphIndex:0,lineIndex:0,
   box:{x0:40,y0:20,x1:750,y1:45},
   words:[{text:"This is the first part of a paragraph that",
    confidence:.95,box:{x0:40,y0:20,x1:750,y1:45}}]},
  {text:"continues on another printed line.",
   confidence:.95,visualQuality:.95,
   blockIndex:0,paragraphIndex:0,lineIndex:1,
   box:{x0:40,y0:50,x1:680,y1:75},
   words:[{text:"continues on another printed line.",
    confidence:.95,box:{x0:40,y0:50,x1:680,y1:75}}]}
 ]
},4000);
assert.equal(wrapped.text,
 "This is the first part of a paragraph that continues on another printed line.",
 "Camera transcript should use OCR paragraphs, not blindly print a newline per OCR line");

const source2=fs.readFileSync(new URL("../src/camera_offline_engine_entry.mjs",import.meta.url),"utf8");
assert.doesNotMatch(source2,/\bfetch\s*\(/,
 "In-browser bundled engine must NEVER fetch code, weights or data");
assert.match(source2,/cacheMethod:"readOnly"/);
assert.match(source2,/workerBlobURL:false/);
assert.match(source2,/workerPath,corePath/);

// Compact real numerals were previously discarded despite 96% OCR certainty
// and strong visual ink. The exception must NOT allow arbitrary high-contrast
// garbage or isolated nonnumeric hallucinations.
const metrics={ok:false,score:.928,contrast:225,edgeRate:.79,
 verticalStrokeRate:.59,bands:2,reason:"too-many-edges"};
const fakeContext={getImageData(){return {data:new Uint8ClampedArray(0)}}};
const scoped={
 window:{InkTextEvidence:{
  plausibleWord:()=>true,
  evidence:(_ctx,box)=>{
   if(box.x0>=400)return {...metrics,contrast:10,score:.30,bands:0};
   if(box.x0>=200)return {...metrics,bands:1,score:.904,edgeRate:.71};
   return metrics;
  }
 }},
 document:{createElement:()=>({getContext:()=>fakeContext})},
 Math,Number,Map,Set,Date
};
vm.runInNewContext(source,scoped);
const numericWord={text:"22567",confidence:.96,
 box:{x0:10,y0:10,x1:67,y1:23}};
const addressWords=[
 {text:"San",confidence:.96,box:{x0:220,y0:65,x1:252,y1:79}},
 {text:"Diego",confidence:.96,box:{x0:253,y0:65,x1:302,y1:79}},
 {text:"CA",confidence:.95,box:{x0:303,y0:65,x1:326,y1:79}}
];
const rejectedWord={text:"texture",confidence:.96,
 box:{x0:100,y0:105,x1:174,y1:118}};
const rejectedLowContrast={text:"noise",confidence:.96,
 box:{x0:420,y0:105,x1:485,y1:118}};
const checked=scoped.window.InkOfflineCamera.checkedPayload({
 lines:[
  {text:"22567",confidence:.96,words:[numericWord],box:numericWord.box},
  {text:"San Diego CA",confidence:.95,words:addressWords,
   box:{x0:220,y0:65,x1:326,y1:79}},
  {text:"texture",confidence:.96,words:[rejectedWord],box:rejectedWord.box},
  {text:"noise",confidence:.96,words:[rejectedLowContrast],box:rejectedLowContrast.box}
 ]
},1000,500);
assert.ok(checked.words.some(w=>w.text==="22567"),
 "High-confidence compact five-digit receipt number needs visible recognition");
assert.ok(checked.words.some(w=>w.text==="San"),
 "High-confidence word supported by a neighboring printed line should survive");
assert.ok(!checked.words.some(w=>w.text==="texture"),
 "No general exception for isolated alphabetic texture guesses");
assert.ok(!checked.words.some(w=>w.text==="noise"),
 "Low-contrast background must remain excluded");

console.log("PASS: local-only engine, real printed word boxes, stable transcript, no service dependency");
