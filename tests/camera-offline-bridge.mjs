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
let received=0;
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
  assert.equal(w,1000);
  assert.equal(h,500);
  received++;
  return payload;
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
assert.equal(client.track(empty,2700).text,"","Old document words must expire");
client.reset();
assert.equal(client.track(empty,3000).text,"");
assert.equal(received,1);
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
console.log("PASS: local-only engine, real printed word boxes, stable transcript, no service dependency");
