import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source=fs.readFileSync(new URL("../src/camera_offline_bridge.js",import.meta.url),"utf8");
const draws=[],reads=[];
const context2d={
 drawImage(...args){draws.push(args)},getImageData(){return {data:new Uint8ClampedArray(0)}}
};
const document={createElement(){return {
 width:0,height:0,getContext(){return context2d}
}}};
const window={
 InkOfflineOCR:{create:async()=>({recognize:async(canvas,width,height,options)=>{
  reads.push({width,height,options});
  const word={text:"DISTANT",confidence:.97,
   box:{x0:10,y0:12,x1:80,y1:36}};
  return {width,height,elapsedMs:80,lines:[{
   text:"DISTANT",confidence:.96,box:word.box,words:[word]
  }]};
 }})}
};
vm.runInNewContext(source,{window,document,
 Math,Number,Date,Map,Set,Uint8ClampedArray});
const client=await window.InkOfflineCamera.connect();
const video={videoWidth:1920,videoHeight:1080};
const readsOut=[];
for(let i=0;i<7;i++)readsOut.push(await client.recognize(video));
assert.ok(reads.every(x=>x.width<=1280),
 "A full 1920px neural pass must not block camera responsiveness");
assert.equal(reads[0].width,1280,"First pass discovers words over entire preview");
assert.equal(reads[1].width,1267,"Second pass preserves native small-glyph pixels");
assert.equal(reads[1].options.fastRegion,true);
assert.equal(reads[1].options.documentMode,false);
assert.equal(reads[2].options.fastRegion,true);
assert.equal(reads[3].options.fastRegion,undefined);
const xy=readsOut.map(x=>[Math.round(x.words[0].box.x0),
 Math.round(x.words[0].box.y0)]);
assert.deepEqual(xy[0],[15,18]);
assert.ok(xy[1][0]>650&&xy[1][1]>360,JSON.stringify(xy));
assert.ok(xy[2][0]<30&&xy[2][1]>360,JSON.stringify(xy));
assert.ok(xy[4][0]>650&&xy[4][1]<50,JSON.stringify(xy));
assert.ok(xy[5][0]<30&&xy[5][1]<50,JSON.stringify(xy));
assert.ok(readsOut.every(x=>x.width===1920&&x.height===1080),
 "All results must use stable native preview coordinates");
assert.ok(draws.some(args=>args.length===9),
 "Native focus must be cropped from actual video pixels");
console.log("PASS: faraway text uses native pixels, all regions covered, Tesseract passes bounded to 1280px, and boxes remain in native coordinates");
