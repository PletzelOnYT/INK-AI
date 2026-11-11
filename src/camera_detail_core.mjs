"use strict";
/* Camera detail recovery. Geometry and pixel operations; OCR inference is
 * performed by the bundled, pretrained neural text reader, never by this code.
 */
export function centerDetailCrop(width,height,fraction=.58){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<40||height<40)
  throw Error("Invalid camera size");
 const w=Math.round(width*fraction),h=Math.round(height*fraction);
 return {x:Math.round((width-w)/2),y:Math.round((height-h)/2),
  width:w,height:h};
}
export function detailSize(width,height,maxWidth=1920){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<=0||height<=0)
  throw Error("Invalid camera dimensions");
 const w=Math.min(width,maxWidth);
 return {width:Math.round(w),height:Math.max(1,Math.round(height*w/width))};
}
export function remapDetailLines(lines,crop,outputWidth,outputHeight){
 const sx=crop.width/outputWidth,sy=crop.height/outputHeight;
 const transform=({x,y})=>({x:crop.x+x*sx,y:crop.y+y*sy});
 const bounds=points=>({x0:Math.min(...points.map(p=>p.x)),
  y0:Math.min(...points.map(p=>p.y)),
  x1:Math.max(...points.map(p=>p.x)),
  y1:Math.max(...points.map(p=>p.y))});
 function project(obj){
  if(!obj?.box)return obj;
  const b=obj.box,source=Array.isArray(obj.points)&&obj.points.length===4?
   obj.points:[{x:b.x0,y:b.y0},{x:b.x1,y:b.y0},
    {x:b.x1,y:b.y1},{x:b.x0,y:b.y1}];
  const points=source.map(transform);
  return {...obj,points,box:bounds(points)};
 }
 return lines.map(line=>({...project(line),
  words:(line.words||[]).map(project)}));
}
/* Enhance faint pencil and equal-luminance colored ink by comparing each
 * RGB channel with nearby background. This does not invent high-frequency
 * details or generate characters. It only makes captured strokes easier for
 * the trained OCR engine to perceive.
 */
export function enhanceInkRGBA(rgba,width,height,block=28){
 if(width*height*4!==rgba.length)throw Error("Pixel dimensions mismatch");
 const cell=Math.max(12,Math.min(64,Math.round(block)));
 const cols=Math.ceil(width/cell),rows=Math.ceil(height/cell);
 const means=new Float32Array(cols*rows*3),counts=new Uint32Array(cols*rows);
 const at=(x,y)=>Math.floor(y/cell)*cols+Math.floor(x/cell);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,j=at(x,y);
  for(let k=0;k<3;k++)means[j*3+k]+=rgba[i+k];
  counts[j]++;
 }
 for(let j=0;j<counts.length;j++)for(let k=0;k<3;k++)
  means[j*3+k]/=Math.max(1,counts[j]);
 const output=new Uint8ClampedArray(width*height*4);
 let contrastPixels=0;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const i=(y*width+x)*4,j=at(x,y)*3;
  const r=rgba[i],g=rgba[i+1],b=rgba[i+2];
  const delta=Math.max(Math.abs(r-means[j]),Math.abs(g-means[j+1]),
   Math.abs(b-means[j+2]));
  // A weak offset is ignored rather than turning compression noise into ink.
  const darkness=Math.max(0,delta-7)*3.2;
  const lum=Math.round(Math.max(0,255-Math.min(245,darkness)));
  output[i]=output[i+1]=output[i+2]=lum;
  output[i+3]=255;
  if(delta>15)contrastPixels++;
 }
 return {data:output,contrastPixels,hasDetail:contrastPixels>=Math.max(10,width*height*.00025)};
}
export function isCompactNumericRead(lines){
 return (lines||[]).some(line=>(line.words||[]).some(word=>{
  const token=String(word.text||"").trim();
  return /^\d{1,2}(?::\d{2})?$/.test(token) &&
   Number(word.confidence)>=.78 &&
   (word.box?.y1-word.box?.y0)>=7;
 }));
}
