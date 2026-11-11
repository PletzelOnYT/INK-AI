// This module is compiled by GitHub Actions into one self-contained JS IIFE.
// Tesseract.js and its English model are bundled; ZERO runtime network calls.
// Tesseract.js and Tesseract are open-source third-party OCR engines (Apache-2.0).
// INK AI's handwriting recognizer and completer remain first-party systems.
import tesseract from "tesseract.js";
import {set} from "idb-keyval";
import {simd} from "wasm-feature-detect";
import workerCode from "../.ocr-build/worker.bin";
import baselineCore from "../.ocr-build/core.bin";
import simdCore from "../.ocr-build/core-simd.bin";
import engData from "../.ocr-build/eng.bin";

const CACHE="ink-offline-v1";
let singleton=null,creation=null;
const urls=[];
function blobURL(bytes){
 const url=URL.createObjectURL(new Blob([bytes],{type:"text/javascript"}));
 urls.push(url);
 return url;
}
function extractWords(data){
 const blocks=data?.blocks||[];
 const lines=[];
 for(const block of blocks){
  for(const paragraph of block.paragraphs||[]){
   for(const line of paragraph.lines||[]){
    const words=(line.words||[])
      .filter(word=>word&&word.bbox&&typeof word.text==="string"&&
        /[A-Za-z0-9]/.test(word.text)&&Number(word.confidence)>=25)
      .map(word=>({
       text:word.text.trim(),
       confidence:Math.min(1,Math.max(0,Number(word.confidence)/100)),
       box:{
        x0:Number(word.bbox.x0),y0:Number(word.bbox.y0),
        x1:Number(word.bbox.x1),y1:Number(word.bbox.y1)
       }
      }));
    if(!words.length)continue;
    const bounds=line.bbox||{
     x0:Math.min(...words.map(w=>w.box.x0)),
     y0:Math.min(...words.map(w=>w.box.y0)),
     x1:Math.max(...words.map(w=>w.box.x1)),
     y1:Math.max(...words.map(w=>w.box.y1))
    };
    const text=words.map(w=>w.text).join(" ").trim();
    lines.push({
     text,confidence:Math.max(0,Math.min(1,Number(line.confidence||60)/100)),
     box:{x0:Number(bounds.x0),y0:Number(bounds.y0),
       x1:Number(bounds.x1),y1:Number(bounds.y1)},
     words
    });
   }
  }
 }
 return lines;
}
async function create(){
 if(singleton)return singleton;
 if(creation)return creation;
 creation=(async()=>{
  // Tesseract worker uses the same IndexedDB key/value store as idb-keyval.
  // If this fails, do NOT silently fetch traineddata from the internet.
  await set(CACHE+"/eng.traineddata",engData);
  const workerPath=blobURL(workerCode);
  const corePath=blobURL((await simd())?simdCore:baselineCore)+"#core.js";
  let worker=null;
  try{
   worker=await tesseract.createWorker("eng",1,{
    workerPath,corePath,workerBlobURL:false,
    cachePath:CACHE,cacheMethod:"readOnly",
    langPath:"offline://disabled",gzip:false,
    logger:()=>{}
   });
   await worker.setParameters({
    tessedit_pageseg_mode:String(tesseract.PSM.SPARSE_TEXT),
    preserve_interword_spaces:"1"
   });
   const engine={
    kind:"bundled-tesseract-wasm",
    async recognize(image,width,height){
     const now=performance.now();
     const {data}=await worker.recognize(image,{}, {blocks:true});
     const lines=extractWords(data);
     return {engine:engine.kind,width,height,
      elapsedMs:Math.round(performance.now()-now),
      lines,words:lines.flatMap(x=>x.words),
      text:lines.map(x=>x.text).join("\n")};
    },
    async terminate(){
     await worker.terminate();
     if(singleton===engine)singleton=null;
     creation=null;
     for(const url of urls.splice(0))URL.revokeObjectURL(url.split("#")[0]);
    }
   };
   singleton=engine;
   return engine;
  }catch(error){
   await worker?.terminate().catch(()=>{});
   for(const url of urls.splice(0))URL.revokeObjectURL(url.split("#")[0]);
   throw error;
  }
 })().catch(error=>{creation=null;throw error});
 return creation;
}
export {create};
export const source="bundled-open-source-tesseract";
