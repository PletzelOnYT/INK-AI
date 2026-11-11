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
export function remapDetailLines(lines,crop,outputWidth,outputHeight,quad=null){
 const sx=crop.width/outputWidth,sy=crop.height/outputHeight;
 const quadPoint=quad?quadMapper(quad):null;
 const transform=({x,y})=>{
  const p=quadPoint?quadPoint(x/outputWidth,y/outputHeight):{x,y};
  return {x:crop.x+p.x*sx,y:crop.y+p.y*sy};
 };
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

// Rectangle-to-quadrilateral homography, used for a bounded perspective
// recovery candidate when printed text is viewed obliquely in 3D.
export function perspectiveQuad(width,height,axis="yaw",direction=1){
 const near=.09,far=.23;
 const a=direction>=0?near:far,b=direction>=0?far:near;
 if(axis==="yaw")return [
  {x:width*.07,y:height*b},{x:width*.93,y:height*a},
  {x:width*.93,y:height*(1-a)},{x:width*.07,y:height*(1-b)}
 ];
 return [
  {x:width*b,y:height*.07},{x:width*(1-b),y:height*.07},
  {x:width*(1-a),y:height*.93},{x:width*a,y:height*.93}
 ];
}
export function quadMapper(quad){
 if(!Array.isArray(quad)||quad.length!==4||quad.some(p=>!Number.isFinite(p.x+p.y)))
  throw Error("Invalid four-corner perspective");
 const [p0,p1,p2,p3]=quad;
 const dx1=p1.x-p2.x,dx2=p3.x-p2.x,dx3=p0.x-p1.x+p2.x-p3.x;
 const dy1=p1.y-p2.y,dy2=p3.y-p2.y,dy3=p0.y-p1.y+p2.y-p3.y;
 const den=dx1*dy2-dx2*dy1;
 let g=0,h=0;
 if(Math.abs(dx3)+Math.abs(dy3)>1e-6){
  if(Math.abs(den)<1e-9)throw Error("Degenerate perspective quadrilateral");
  g=(dx3*dy2-dx2*dy3)/den;
  h=(dx1*dy3-dx3*dy1)/den;
 }
 const a=p1.x-p0.x+g*p1.x,b=p3.x-p0.x+h*p3.x,c=p0.x;
 const d=p1.y-p0.y+g*p1.y,e=p3.y-p0.y+h*p3.y,f=p0.y;
 return (u,v)=>{
  const divisor=g*u+h*v+1;
  if(Math.abs(divisor)<1e-9)throw Error("Invalid perspective projection");
  return {x:(a*u+b*v+c)/divisor,y:(d*u+e*v+f)/divisor};
 };
}
export function rectifyPerspectiveRGBA(rgba,width,height,quad){
 if(rgba.length!==width*height*4)throw Error("Perspective bitmap mismatch");
 const map=quadMapper(quad);
 const result=new Uint8ClampedArray(rgba.length);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const at=(y*width+x)*4;
  const p=map((x+.5)/width,(y+.5)/height);
  const xx=Math.max(0,Math.min(width-1,p.x));
  const yy=Math.max(0,Math.min(height-1,p.y));
  const x0=Math.floor(xx),x1=Math.min(width-1,x0+1),tx=xx-x0;
  const y0=Math.floor(yy),y1=Math.min(height-1,y0+1),ty=yy-y0;
  for(let channel=0;channel<3;channel++){
   const v00=rgba[(y0*width+x0)*4+channel],v10=rgba[(y0*width+x1)*4+channel];
   const v01=rgba[(y1*width+x0)*4+channel],v11=rgba[(y1*width+x1)*4+channel];
   result[at+channel]=(v00*(1-tx)+v10*tx)*(1-ty)+
     (v01*(1-tx)+v11*tx)*ty;
  }
  result[at+3]=255;
 }
 return result;
}

export function isCompactNumericRead(lines){
 return (lines||[]).some(line=>(line.words||[]).some(word=>{
  const token=String(word.text||"").trim();
  return /^\d{1,2}(?::\d{2})?$/.test(token) &&
   Number(word.confidence)>=.78 &&
   (word.box?.y1-word.box?.y0)>=7;
 }));
}
