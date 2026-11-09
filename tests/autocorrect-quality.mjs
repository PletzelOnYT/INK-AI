import fs from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";
const html=fs.readFileSync("index.html","utf8");
const source=fs.readFileSync("src/autocorrect_ui.js","utf8");
assert.ok(!html.includes('id="strokeWorkerSource"'),
 "Partial-stroke generator should not be used in autocorrect mode");
const modelText=html.match(/<script id="recognitionModelV3" type="application\/json">([\s\S]*?)<\/script>/)?.[1];
assert.ok(modelText,"Missing offline recognition weights");
const model=JSON.parse(modelText);
assert.equal(model.format,"ink-cnn-int8-v1");
assert.equal(model.labels.length,102);
assert.equal(model.training.finetuned_from,"models/ink-cnn-v2.json");
const text=html.match(/<script id="englishWords" type="text\/plain">([\s\S]*?)<\/script>/)?.[1];
assert.ok(text,"Missing offline dictionary");
const words=text.trim().split(/\s+/);
assert.ok(words.length>=9500,words.length);
const englishRank=new Map(words.map((word,i)=>[word,i+1]));
const englishPrefixes=new Set();
for(const word of words)for(let i=2;i<word.length;i++)englishPrefixes.add(word.slice(0,i));
assert.ok(englishRank.has("hello")&&englishRank.has("help")&&englishRank.has("world"));
const a=source.indexOf("function rankCorrectionCandidates(");
const b=source.indexOf("function correctedContext(",a);
assert.ok(a>=0&&b>a);
const globals={englishRank,englishPrefixes};
vm.createContext(globals);
vm.runInContext(source.slice(a,b),globals);
const rank=globals.rankCorrectionCandidates;
const ambiguous=[{char:"q",confidence:.42},{char:"p",confidence:.38}];
assert.equal(rank(ambiguous,"hel","","q")[0].label,"p",
 "Dictionary should help an ambiguous 'help' letter");
assert.equal(rank(ambiguous,"","","q")[0].label,"q",
 "No context should leave CNN preferred");
const certain=[{char:"q",confidence:.95},{char:"p",confidence:.03}];
assert.equal(rank(certain,"hel","","q")[0].label,"q",
 "Language must not override confident recognition");
const math=[{char:"=",confidence:.45},{char:"e",confidence:.43}];
assert.equal(rank(math,"he","","=")[0].label,"=",
 "Do not change math symbols to dictionary letters");
assert.ok(html.includes('type==="corrected-character"'));
assert.ok(html.includes('window.__inkAcceptedCorrections++'));
assert.ok(html.includes('acceptCorrectionButton.addEventListener("click",acceptGhost)'));
console.log("PASS: embedded offline CNN, 10k words, conservative context correction, whole-letter G acceptance");
