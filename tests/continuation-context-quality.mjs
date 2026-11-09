import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const html=fs.readFileSync("index.html","utf8");
const ui=fs.readFileSync("src/stroke_assist_ui.js","utf8");
assert.ok(html.includes('id="strokeWorkerSource"'),"Neural pen generator must render vectors");
assert.ok(!html.includes("drawCorrectionGlyph"),"Do not overlay printed font letters");
assert.ok(!html.includes("correction-bar"),"Keep the original INK interface");
assert.ok(!html.includes('id="acceptCorrection"'),"G remains the existing accept key");
assert.ok(html.includes("rgba(55,55,55,0.30)"),"Ghost ink must be light translucent gray");
assert.ok(html.includes('type:"vector-completion"'),"Acceptance appends real pen vectors");
for(const name of ["inkRecognitionModel","inkStrokeModel","inkStrokeBackup"]){
 const re=new RegExp('<script id="'+name+'" type="application/json">([\\s\\S]*?)<\\/script>');
 const match=html.match(re);
 assert.ok(match,"Missing offline "+name);
 const json=JSON.parse(match[1]);
 assert.ok(json.format.startsWith("ink-"),name);
}
const english=html.match(/<script id="inkEnglishWords" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
assert.ok(english,"Embedded dictionary missing");
const words=english.trim().split(/\s+/);
assert.equal(words.length,10000);
assert.ok(words.includes("help")&&words.includes("hello"));
const ranks=new Map(words.map((w,i)=>[w,i+1]));
const prefixes=new Set();
for(const w of words)for(let n=2;n<w.length;n++)prefixes.add(w.slice(0,n));
const begin=ui.indexOf("function dictionaryRankOptions(");
const end=ui.indexOf("function completedLowercaseH(",begin);
const end2=ui.indexOf("\nconst STROKE_URL=",end);
assert.ok(begin>0&&end>begin&&end2>end);
const ctx={window:{__inkWordRegions:[
 {box:[100,100,140,200],line:0,space:false},
 {box:[160,100,200,200],line:0,space:false},
 {box:[220,100,260,200],line:0,space:false},
 {box:[280,100,320,200],line:0,space:false}
],__inkTopCandidates:[
 [{char:"h"}],[{char:"e"}],[{char:"l"}],[{char:"q"}]
]},englishRanks:ranks,englishPrefixes:prefixes,Math,Map,Set,Array};
vm.createContext(ctx);
vm.runInContext(ui.slice(begin,end2),ctx);
const choices=[{char:"q",confidence:.42},{char:"p",confidence:.38}];
const contextRanked=ctx.dictionaryRankOptions(choices,{l:280,r:320,t:100,b:200});
assert.equal(contextRanked[0].char,"p","help should win only if written letters support it");
const confident=ctx.dictionaryRankOptions([{char:"q",confidence:.94},{char:"p",confidence:.06}],{l:280,r:320,t:100,b:200});
assert.equal(confident[0].char,"q","No dictionary override for strong visual evidence");
ctx.window.__inkWordRegions=[];
assert.equal(ctx.dictionaryRankOptions(choices,{l:280,r:320,t:100,b:200})[0].char,"q");
const incomplete={box:{t:100,b:310},group:[
 {points:[[200,100],[200,310]]},
 {points:[[200,220],[245,225],[260,250]]}
]};
assert.equal(ctx.completedLowercaseH(incomplete),false);
const finished={...incomplete,group:[
 incomplete.group[0],{points:[[200,220],[245,225],[260,304]]}
]};
assert.equal(ctx.completedLowercaseH(finished),true);
assert.equal(ctx.isLiveCandidateRequired(finished,"h",false),false);
assert.equal(ctx.isLiveCandidateRequired(incomplete,"h",false),true);
assert.equal(ctx.isLiveCandidateRequired(finished,"h",true),true,
 "Don't freeze mid-stroke just because pen reaches baseline");
console.log("PASS: actual gray neural pen continuation, offline models, dictionary-aware OCR and completed h gating");
