#!/usr/bin/env node
// Build a single OFFLINE browser OCR bundle for the checked-in index.html.
// Downloads licensed Tesseract packages/model ONLY in GitHub Actions at build
// time. At runtime, all code, WASM and traineddata live inside index.html.
// No CDN requests, server, API key or external worker dependencies.
import fs from "node:fs/promises";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { build } from "esbuild";

const ROOT=process.cwd();
const dir=path.join(ROOT,".ocr-build");
await fs.mkdir(dir,{recursive:true});
const copy=async(from,to)=>fs.copyFile(path.join(ROOT,from),path.join(dir,to+".bin"));
await copy("node_modules/tesseract.js/dist/worker.min.js","worker");
await copy("node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js","core");
await copy("node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js","core-simd");

// The English LSTM trained data is a known, public, pretrained Tesseract
// model. It is NOT represented as a model created by this project's author.
// GitHub Actions has internet; users opening the resulting HTML do not need it.
const languageURL="https://github.com/naptha/tessdata/raw/refs/heads/gh-pages/4.0.0_best_int/eng.traineddata.gz";
let response;
for(let attempt=0;attempt<3;attempt++){
 try{
  response=await fetch(languageURL);
  if(response.ok)break;
  throw Error("HTTP "+response.status);
 }catch(error){
  if(attempt===2)throw Error("Can't fetch English OCR data during GitHub packaging: "+error.message);
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
}
if(!response?.ok)throw Error("English traineddata unavailable");
const gz=new Uint8Array(await response.arrayBuffer());
const language=gunzipSync(gz);
if(language.length<100_000)throw Error("Traineddata appears corrupted");
await fs.writeFile(path.join(dir,"eng.bin"),language);
console.log("Bundling pretrained English OCR:",language.length,"bytes");

await build({
 entryPoints:["src/camera_offline_engine_entry.mjs"],
 outfile:"dist/ink-offline-ocr.js",
 bundle:true,
 platform:"browser",
 format:"iife",
 globalName:"InkOfflineOCR",
 target:["chrome110","safari17"],
 minify:true,
 legalComments:"none",
 loader:{".bin":"binary"},
 logLevel:"info"
});
const built=await fs.stat("dist/ink-offline-ocr.js");
if(built.size<2_000_000)throw Error("Offline OCR appears to be missing trained weights");
console.log("Built completely offline OCR engine:",built.size,"bytes");
// No language/model may be fetched at runtime; cache is pre-populated in
// IndexedDB before the WASM worker is started.
