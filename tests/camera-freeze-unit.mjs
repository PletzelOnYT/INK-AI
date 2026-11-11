import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const source=fs.readFileSync(new URL("../src/camera_ocr.js",import.meta.url),"utf8");
const listeners={window:{},document:{},button:{}};
const classes=new Set();
const classList={
 add(...values){for(const v of values)classes.add(v)},
 remove(...values){for(const v of values)classes.delete(v)},
 contains(value){return classes.has(value)}
};
const context2d={clearRect(){},drawImage(){snapshotDraws++}};
let snapshotDraws=0,stoppedTracks=0,entries=0,exits=0;
const makeCanvas=()=>({width:0,height:0,getContext:()=>context2d});
const frozen=makeCanvas();
const overlay=makeCanvas();
const board={classList,clientWidth:960,clientHeight:540};
const video={
 videoWidth:960,videoHeight:540,readyState:4,paused:false,srcObject:null,
 play:async()=>{video.paused=false},
 pause:()=>{video.paused=true},
};
const button={setAttribute:(name,val)=>{button[name]=val},
 addEventListener:(name,handler)=>{listeners.button[name]=handler},
 title:"Camera"};
const output={textContent:"",dataset:{}};
const elements={camera:button,cameraVideo:video,cameraHighlights:overlay,
 cameraFrozen:frozen,guess:output};
const document={
 hidden:false,
 getElementById:id=>elements[id]||null,
 querySelector:selector=>selector===".board"?board:null,
 createElement:name=>makeCanvas(),
 addEventListener:(name,handler)=>{listeners.document[name]=handler}
};
const w={
 InkCameraCore:{
 createTracker:()=>({reset(){},snapshot:()=>({words:[],text:"",activeAngle:null})}),
 createGlyphEvidenceTracker:()=>({reset(){}}),
 createRegionTracker:()=>({reset(){}}),
 createSceneMonitor:()=>({reset(){}})
 },
 InkCameraDetector:{},
 __inkEnterCameraMode:()=>{entries++},
 __inkLeaveCameraMode:()=>{exits++},
 __inkLastGuess:"",
 addEventListener:(name,handler)=>{listeners.window[name]=handler}
};
const stream={getTracks:()=>[{stop:()=>{stoppedTracks++}}]};
const navigator={mediaDevices:{getUserMedia:async()=>stream}};
class HTMLInputElement{}
class HTMLTextAreaElement{}
vm.runInNewContext(source,{
 window:w,document,navigator,HTMLInputElement,HTMLTextAreaElement,
 performance:{now:()=>100},setTimeout:()=>1,clearTimeout:()=>{},
 Math,Date,Number,Uint8Array,Float32Array,Array,Map,Set
});
async function flush(){for(let i=0;i<10;i++)await Promise.resolve()}
listeners.button.click();
await flush();
assert.equal(w.__inkCameraActive,true);
assert.equal(entries,1);
assert.equal(button["aria-pressed"],"true");
assert.equal(output.dataset.camera,"true");
const key=(key)=>listeners.window.keydown({
 key,repeat:false,ctrlKey:false,metaKey:false,altKey:false,target:button,
 preventDefault(){this.prevented=true}
});
key("c");
assert.equal(w.__inkCameraFrozen,true);
assert.equal(frozen.width,960);
assert.equal(frozen.height,540);
assert.ok(snapshotDraws>0,"Freezing should save an actual video frame");
assert.ok(classes.has("camera-frozen"),"Frozen canvas must replace video");
document.hidden=true;
listeners.document.visibilitychange();
assert.equal(w.__inkCameraActive,true,"Switching tabs must not turn off Camera");
assert.equal(stoppedTracks,0,"A hidden tab must retain the MediaStream");
document.hidden=false;
listeners.document.visibilitychange();
assert.equal(w.__inkCameraActive,true);
assert.equal(w.__inkCameraFrozen,true,"Frozen state remains after tab return");
key("c");
assert.equal(w.__inkCameraFrozen,false,"Second C must resume live preview");
assert.ok(!classes.has("camera-frozen"));
assert.equal(w.__inkCameraActive,true);
listeners.button.click();
assert.equal(w.__inkCameraActive,false);
assert.equal(stoppedTracks,1,"Stream must stop when Camera is deliberately closed");
assert.equal(exits,1,"Drawing tool state must be restored when leaving Camera");
assert.equal(output.dataset.camera,undefined);
console.log("PASS: real camera module freezes on C, survives tab switches, unfreezes, restores tool state");
