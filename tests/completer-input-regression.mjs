import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
const bounds=stroke=>{
 const x=stroke.points.map(p=>p[0]),y=stroke.points.map(p=>p[1]);
 return {l:Math.min(...x),r:Math.max(...x),t:Math.min(...y),b:Math.max(...y)};
};
function load(path,strokes){
 const code=fs.readFileSync(path,"utf8");
 const i=code.indexOf("function completionInput(){");
 const j=code.indexOf("function createGlyphWorker(){",i);
 assert.ok(i>0&&j>i,"Must find real app's completionInput function");
 const env={strokes,current:null,bounds,Math};
 vm.createContext(env);
 vm.runInContext(code.slice(i,j),env);
 return env.completionInput();
}
function test(path){
 const stem={tool:"pen",points:[
  [210,100],[210,125],[210,150],[209,175],[209,200],[209,225]]};
 const arch={tool:"pen",points:[
  [210,171],[230,145],[250,147],[260,170],[261,194]]};
 const h=load(path,[stem,arch]);
 assert.ok(h&&h.group.length===2,
  "Overlapping strokes of an unfinished h must be grouped");
 assert.equal(h.prefix.filter(t=>t[2]===0).length,2,
  "Neural model must see both pen-up stroke beginnings");
 let xx=0,yy=0,spanX=[Infinity,-Infinity],spanY=[Infinity,-Infinity];
 for(const item of h.prefix){
  xx+=item[0];yy+=item[1];
  spanX=[Math.min(spanX[0],xx),Math.max(spanX[1],xx)];
  spanY=[Math.min(spanY[0],yy),Math.max(spanY[1],yy)];
 }
 assert.ok(Math.abs((spanX[0]+spanX[1])/2-.5)<.02);
 assert.ok(Math.abs((spanY[0]+spanY[1])/2-.5)<.02,
  "Input positions must be centered like the actual neural training data");
 const next={tool:"pen",points:[
  [290,145],[304,132],[323,137],[329,165],[325,191]]};
 const adjacent=load(path,[stem,arch,next]);
 assert.ok(adjacent&&adjacent.group.length===1,
  "Neighboring letters in a word must never become one combined glyph");
 const many=[];
 for(let stroke=0;stroke<5;stroke++){
  const points=[];
  for(let k=0;k<50;k++){
   const x=200+((k%8)*7)+stroke;
   const y=145+Math.floor(k/8)*9+stroke;
   points.push([x,y]);
  }
  many.push({tool:"pen",points});
 }
 const dense=load(path,many);
 assert.ok(dense&&dense.prefix.length<=85);
 assert.ok(dense.prefix.filter(p=>p[2]===0).length>=4,
  "Dense input must not erase all previous strokes");
 assert.equal(dense.group.length,5);
 console.log("PASS:",path,"training-aligned frame, adjacent-glyph separation, and dense multi-stroke retention");
}
test("src/app.js");
test("src/stroke_assist_ui.js");
