import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const source=readFileSync(new URL("../src/camera_vision_bridge.js",import.meta.url),"utf8");
const calls=[];
let painted=0;
const context={
 setTransform(){},clearRect(){},beginPath(){},roundRect(){},
 rect(){},fill(){painted++},stroke(){},drawImage(){}
};
function canvas(){return {width:0,height:0,getContext:()=>context,
 toBlob:callback=>callback({type:"image/jpeg",size:42188})}}
const window={devicePixelRatio:1};
const document={createElement:type=>{
 assert.equal(type,"canvas");
 return canvas();
}};
const word=(text,x0,x1)=>({text,confidence:.96,box:{x0,y0:22,x1,y1:53}});
const payload={engine:"apple-vision-local",width:1000,height:500,elapsedMs:75,
 lines:[{text:"NY THREADS",confidence:.96,
  box:{x0:120,y0:22,x1:490,y1:53},
  words:[word("NY",120,198),word("THREADS",211,490)]}],
 words:[word("NY",120,198),word("THREADS",211,490)]};
const fetch=async (url,request)=>{
 calls.push({url,request});
 assert.equal(request.headers["X-Ink-Token"],"a".repeat(40));
 if(url.endsWith("/health"))return {ok:true,json:async()=>({engine:"apple-vision-local"})};
 if(url.includes("/ocr?")){
  assert.equal(request.method,"POST");
  assert.equal(request.body.type,"image/jpeg");
  return {ok:true,status:200,json:async()=>payload};
 }
 throw Error("Unexpected endpoint "+url);
};
const contextGlobals={window,document,location:{hash:"#ink-vision-token="+"a".repeat(40)},
 URLSearchParams,fetch,AbortController,setTimeout,clearTimeout,Math,Number,
 Map,Set,Promise,Date};
vm.runInNewContext(source,contextGlobals);
assert.equal(typeof window.InkVisionBridge?.connect,"function");
const client=await window.InkVisionBridge.connect();
assert.ok(client,"Valid token and local helper should activate Vision");
const video={videoWidth:1000,videoHeight:500};
const result=await client.recognize(video);
const first=client.track(result,1000);
assert.equal(first.text,"NY THREADS");
assert.equal(first.words.length,2);
const overlay=canvas(),board={clientWidth:1000,clientHeight:500};
client.paint(overlay,video,board,first);
assert.equal(painted,2,"Only recognized words should get white highlights");
const second=client.track({lines:[],words:[],width:1000,height:500},2550);
assert.equal(second.text,"","Old text must expire when document disappears");
const newPage={...payload,lines:[{text:"THANK YOU",confidence:.94,
 box:{x0:125,y0:90,x1:490,y1:145},
 words:[word("THANK",125,330),word("YOU",340,490)]}]};
assert.equal(client.track(newPage,2800).text,"THANK YOU",
 "New document must not accumulate previous words");
client.reset();
assert.equal(client.track({lines:[],width:1000,height:500},3000).text,"");
assert.ok(calls.every(c=>c.url.startsWith("http://127.0.0.1:17861/")),
 "All frames must stay on the loopback interface");
console.log("PASS: local token handshake, high-confidence text, word highlights, scene expiry, no remote upload");
