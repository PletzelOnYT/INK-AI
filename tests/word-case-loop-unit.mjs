import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const source=fs.readFileSync("src/word_case_refinement.js","utf8");
const html=fs.readFileSync("index.html","utf8");
assert.ok(html.includes(source.trim()),"Standalone HTML and source must match");
assert.ok(!html.includes("drawCorrectionGlyph")&&!html.includes("correction-bar"),
 "Never restore printed-font corrections or extra controls");
assert.ok(html.includes('window.__inkGhostSource="neural-stroke-sequence"'));
const ctx={Math};vm.createContext(ctx);vm.runInContext(source,ctx);
const {inkLoopGeometry,caseAwareWordReading}=ctx;
const W=500,H=240,data=new Uint8ClampedArray(W*H*4);data.fill(255);
const ink=(x,y)=>{
 x=Math.round(x);y=Math.round(y);
 if(x<0||x>=W||y<0||y>=H)return;
 const k=(y*W+x)*4;data[k]=data[k+1]=data[k+2]=0;
};
const circle=(cx,cy,rx,ry)=>{
 for(let t=0;t<360;t+=.35){
  const angle=t*Math.PI/180;
  for(let w=-2;w<=2;w++)
   ink(cx+(rx+w)*Math.cos(angle),cy+(ry+w)*Math.sin(angle));
 }
};
const diagonal=(x0,y0,x1,y1)=>{
 for(let t=0;t<=1;t+=.005)for(let z=-2;z<=2;z++)
  ink(x0+(x1-x0)*t+z,y0+(y1-y0)*t);
};
circle(252,135,25,24);
const pixels={width:W,height:H,data};
const r=(box,space=false)=>({box,line:0,space});
const boxes=[r([50,60,108,160]),r([150,70,164,159]),r([225,109,279,161])];
const top=(arr)=>({top:arr.map(([char,confidence])=>({char,confidence}))});
const pred=[
 top([["h",.84],["k",.12]]),top([["i",.77],["j",.2]]),
 top([["Q",.41],["0",.2],["o",.15],["O",.1]])
];
const read=(regions,ps,chars,dict=new Set())=>
 Array.from(caseAwareWordReading(regions,ps,pixels,[],Array.from(chars),dict)).join("");
assert.equal(read(boxes,pred,"hiQ"),"hio",
 "Compact loop in lowercase handwriting should beat false uppercase Q");
assert.equal(inkLoopGeometry(boxes[2],pixels).round,true);
const whyBoxes=[r([50,100,100,150]),r([130,50,195,151]),r([222,100,300,211])];
const whyPred=[top([["w",.56],["W",.41]]),
 top([["h",.85]]),top([["Y",.60],["y",.37]])];
assert.equal(read(whyBoxes,whyPred,"whY",new Set(["why"])),"why");
assert.equal(read(whyBoxes,whyPred,"whY",new Set()),"whY",
 "Do not arbitrarily lowercase uppercase letters without word evidence");
const xBoxes=[r([30,65,110,151]),r([150,100,202,149]),r([255,50,300,154])];
const xPred=[top([["X",.45],["x",.24]]),
 top([["×",.68],["x",.055],["X",.045]]),top([["h",.92]])];
assert.equal(read(xBoxes,xPred,"X×h"),"Xxh");
const mathBoxes=[r([30,65,110,151]),r([150,100,202,149]),r([255,50,300,154])];
const mathPred=[top([["a",.95]]),xPred[1],top([["b",.92]])];
assert.equal(read(mathBoxes,mathPred,"a×b"),"a×b",
 "Never replace an actual multiplication symbol just because letters surround it");
assert.equal(read(mathBoxes,[top([["2",.97]]),xPred[1],top([["h",.92]])],"2×h"),
 "2×h","Numeric expression must retain multiplication");
const spaced=[xBoxes[0],r(xBoxes[1].box,true),xBoxes[2]];
assert.equal(read(spaced,xPred,"X×h"),"X×h",
 "Whitespace should preserve the explicit operator");
const tallX=[xBoxes[0],r([150,50,202,151]),xBoxes[2]];
assert.equal(read(tallX,xPred,"X×h"),"X×h","Large math symbol not a small handwritten x");
assert.equal(read(whyBoxes,whyPred,"WHY",new Set(["why"])),"WHY",
 "Uppercase word must remain uppercase");
console.log("PASS: compact o vs Q, why/y case, x vs multiplication, math safety and no UI changes");
