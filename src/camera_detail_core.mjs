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
// Overlapping focus zones allow a camera to recover small form fields even
// when a large headline elsewhere already produced a clear OCR result.
// They are image crops, not guesses about the expected document content.
export function documentFocusCrop(width,height,zone="lower-right"){
 if(!Number.isFinite(width)||!Number.isFinite(height)||width<80||height<80)
  throw Error("Invalid document scan dimensions");
 const zones=new Set(["upper-left","upper-right","lower-left","lower-right"]);
 if(!zones.has(zone))throw Error("Unknown document focus zone");
 const w=Math.round(width*.65),h=Math.round(height*.65);
 const x=zone.endsWith("right")?width-w:0;
 const y=zone.startsWith("lower")?height-h:0;
 return {x,y,width:w,height:h};
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


// Find compact dark display faces (such as a distant digital clock) in
// a tiny 160x90 preview. This only proposes a crop: the pretrained neural
// recognizer and repeated pixel evidence still decide whether text exists.
export function findDarkDisplayRGBA(data,width,height){
 if(data.length!==width*height*4)throw Error("Display preview dimensions mismatch");
 const hist=new Uint32Array(256),gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++){
  const p=i*4;
  const v=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);
  gray[i]=v;hist[v]++;
 }
 let total=0,median=255;
 for(let i=0;i<256;i++){total+=hist[i];if(total>=gray.length*.5){median=i;break}}
 if(median<85)return null; // Avoid scanning every dark wall/scene.
 const threshold=Math.min(145,median-58);
 const visited=new Uint8Array(gray.length);
 let best=null;
 for(let i=0;i<gray.length;i++){
  if(visited[i]||gray[i]>threshold)continue;
  const todo=[i];visited[i]=1;
  let count=0,x0=width,y0=height,x1=0,y1=0;
  for(let j=0;j<todo.length;j++){
   const index=todo[j],x=index%width,y=Math.floor(index/width);
   count++;x0=Math.min(x0,x);x1=Math.max(x1,x);
   y0=Math.min(y0,y);y1=Math.max(y1,y);
   if(todo.length>width*height*.32)break;
   for(const neighbor of [index-1,index+1,index-width,index+width]){
    if(neighbor<0||neighbor>=gray.length||visited[neighbor]||
       gray[neighbor]>threshold)continue;
    const nx=neighbor%width,ny=Math.floor(neighbor/width);
    if(Math.abs(nx-x)+Math.abs(ny-y)!==1)continue;
    visited[neighbor]=1;todo.push(neighbor);
   }
  }
  const bw=x1-x0+1,bh=y1-y0+1,area=bw*bh;
  const density=count/Math.max(1,area),ratio=bw/Math.max(1,bh);
  if(area<width*height*.004||area>width*height*.24||
     density<.49||ratio<1.25||ratio>7.2)continue;
  const cx=(x0+x1)/2/width,cy=(y0+y1)/2/height;
  const distance=(cx-.5)**2+(cy-.5)**2;
  if(distance>.14)continue;
  const merit=count/(1+distance*12);
  if(!best||merit>best.merit)best={x0,y0,x1,y1,merit};
 }
 if(!best)return null;
 const padX=Math.max(1,Math.round((best.x1-best.x0)*.045));
 const padY=Math.max(1,Math.round((best.y1-best.y0)*.085));
 const x0=Math.max(0,best.x0-padX),y0=Math.max(0,best.y0-padY);
 const x1=Math.min(width,best.x1+1+padX),y1=Math.min(height,best.y1+1+padY);
 return {x:x0,y:y0,width:x1-x0,height:y1-y0};
}

export function isCompactNumericRead(lines){
 return (lines||[]).some(line=>(line.words||[]).some(word=>{
  const token=String(word.text||"").trim();
  return /^\d{1,2}(?::\d{2})?$/.test(token) &&
   Number(word.confidence)>=.78 &&
   (word.box?.y1-word.box?.y0)>=7;
 }));
}



// Find an analog clock by its curved dark rim and brighter dial. Geometry
// proposes a region; it never guesses which characters are printed on it.
export function findAnalogClockRGBA(data,width,height){
 if(data.length!==width*height*4)throw Error("Clock preview dimensions mismatch");
 if(width<80||height<70)return null;
 const gray=new Uint8Array(width*height);
 for(let i=0;i<gray.length;i++){
  const p=i*4;
  gray[i]=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);
 }
 const directions=Array.from({length:24},(_,i)=>{
  const a=2*Math.PI*i/24;return [Math.cos(a),Math.sin(a)];
 });
 const get=(x,y)=>gray[Math.round(y)*width+Math.round(x)];
 let best=null;
 const minR=Math.max(10,Math.round(width*.032));
 const maxR=Math.min(Math.floor(Math.min(width,height)/3),Math.round(width*.15));
 function score(cx,cy,r){
  let support=0,contrast=0,innerSum=0,outerSum=0;
  for(const [dx,dy] of directions){
   const x=cx+dx*r,y=cy+dy*r;
   const inner=get(cx+dx*r*.74,cy+dy*r*.74);
   const outer=get(cx+dx*r*1.15,cy+dy*r*1.15);
   const ring=Math.min(get(cx+dx*r*.92,cy+dy*r*.92),
    get(cx+dx*r*.98,cy+dy*r*.98),get(x+dx*r*.045,y+dy*r*.045));
   const delta=Math.min(inner,outer)-ring;
   if(delta>17)support++;
   contrast+=Math.max(0,Math.min(100,delta));
   innerSum+=inner;outerSum+=outer;
  }
  const fraction=support/24;
  if(fraction<.63||innerSum/24<145||outerSum/24<130)return null;
  return {score:contrast/24*(fraction-.28),support:fraction};
 }
 for(let r=minR;r<=maxR;r+=2){
  const margin=Math.ceil(r*1.2)+1;
  for(let cy=margin;cy<height-margin;cy+=3)
   for(let cx=margin;cx<width-margin;cx+=3){
    const interior=(get(cx+r*.48,cy)+get(cx-r*.48,cy)+
      get(cx,cy+r*.48)+get(cx,cy-r*.48))*.25;
    if(interior<146)continue;
    const metric=score(cx,cy,r);
    if(metric?.score>Math.max(12,best?.score||0))
     best={cx,cy,radius:r,score:metric.score,support:metric.support};
   }
 }
 if(!best)return null;
 // Subpixel-scale refinement matters when the original webcam is 1080p.
 const old=best;
 for(let r=Math.max(minR,old.radius-2);r<=Math.min(maxR,old.radius+2);r++){
  for(let cy=old.cy-4;cy<=old.cy+4;cy++)
   for(let cx=old.cx-4;cx<=old.cx+4;cx++){
    if(cx-r*1.2<1||cy-r*1.2<1||
       cx+r*1.2>=width-1||cy+r*1.2>=height-1)continue;
    const metric=score(cx,cy,r);
    if(metric?.score>best.score)
     best={cx,cy,radius:r,score:metric.score,support:metric.support};
   }
 }
 return best;
}

// Localize actual dark glyph components around a detected dial. These are
// candidate bounding boxes only: the offline OCR must recognize the pixels.
export function findDialGlyphRegionsRGBA(data,width,height,clock){
 if(data.length!==width*height*4)throw Error("Clock glyph bitmap mismatch");
 if(!clock||clock.radius<13)return [];
 const {cx,cy,radius:r}=clock;
 const ox=Math.max(0,Math.floor(cx-r*1.16));
 const oy=Math.max(0,Math.floor(cy-r*1.16));
 const right=Math.min(width,Math.ceil(cx+r*1.16));
 const bottom=Math.min(height,Math.ceil(cy+r*1.16));
 const w=right-ox,h=bottom-oy;
 if(w<20||h<20||w*h>500000)return [];
 const lum=new Uint8Array(w*h),visited=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const p=((y+oy)*width+x+ox)*4;
  lum[y*w+x]=Math.round(.299*data[p]+.587*data[p+1]+.114*data[p+2]);
 }
 const at=(x,y)=>lum[Math.max(0,Math.min(h-1,Math.round(y-oy)))*w+
  Math.max(0,Math.min(w-1,Math.round(x-ox)))];
 const face=(at(cx+r*.36,cy)+at(cx-r*.36,cy)+
  at(cx,cy+r*.36)+at(cx,cy-r*.36))/4;
 if(face<132)return [];
 // Keep the threshold conservative: a too-generous threshold merges
 // numeral 7/8 with the surrounding clock frame.
 const threshold=Math.min(160,Math.max(92,face-62));
 const queue=new Int32Array(w*h),glyphs=[];
 for(let i=0;i<w*h;i++){
  if(visited[i]||lum[i]>=threshold)continue;
  visited[i]=1;queue[0]=i;
  let head=0,tail=1,x0=w,y0=h,x1=0,y1=0;
  while(head<tail){
   const p=queue[head++],x=p%w,y=(p-x)/w;
   x0=Math.min(x0,x);x1=Math.max(x1,x);
   y0=Math.min(y0,y);y1=Math.max(y1,y);
   for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
    if(!dx&&!dy)continue;
    const nx=x+dx,ny=y+dy;
    if(nx<0||ny<0||nx>=w||ny>=h)continue;
    const k=ny*w+nx;
    if(visited[k]||lum[k]>=threshold)continue;
    visited[k]=1;queue[tail++]=k;
   }
  }
  const bw=x1-x0+1,bh=y1-y0+1,area=tail;
  if(bw<r*.018||bh<r*.055||bw>r*.23||bh>r*.31||
     area<Math.max(5,r*.065)||area>r*r*.065)continue;
  const gx=ox+(x0+x1)/2,gy=oy+(y0+y1)/2;
  const radial=Math.hypot(gx-cx,gy-cy)/r;
  if(radial<.47||radial>1.13)continue;
  glyphs.push({cx:gx,cy:gy,box:{x0:ox+x0,y0:oy+y0,
   x1:ox+x1+1,y1:oy+y1+1}});
 }
 if(glyphs.length<7||glyphs.length>36)return [];
 const xs=glyphs.map(g=>g.cx).sort((a,b)=>a-b);
 const ys=glyphs.map(g=>g.cy).sort((a,b)=>a-b);
 const estimatedX=(xs[0]+xs[xs.length-1])/2;
 const estimatedY=(ys[0]+ys[ys.length-1])/2;
 const centerX=Math.abs(estimatedX-cx)<r*.19?estimatedX:cx;
 const centerY=Math.abs(estimatedY-cy)<r*.19?estimatedY:cy;
 // Calibrate the clock's phase from actual printed components; mildly
 // oblique clock faces can shift all nominal hour angles by 5-15 degrees.
 let re=0,im=0;
 for(const g of glyphs){
  const angle=Math.atan2(g.cy-centerY,g.cx-centerX);
  re+=Math.cos(12*angle);im+=Math.sin(12*angle);
 }
 const phase=Math.atan2(im,re)/12;
 const groups=new Map();
 for(const g of glyphs){
  const angle=Math.atan2(g.cy-centerY,g.cx-centerX);
  const slot=(angle-phase+Math.PI/2)/(Math.PI/6);
  const nearest=Math.round(slot);
  if(Math.abs(slot-nearest)*30>16)continue;
  const hour=((nearest%12)+12)%12||12;
  if(!groups.has(hour))groups.set(hour,[]);
  groups.get(hour).push(g);
 }
 const result=[];
 for(let hour=1;hour<=12;hour++){
  const parts=groups.get(hour)||[];
  if(!parts.length||parts.length>3)continue;
  let x0=Math.min(...parts.map(p=>p.box.x0));
  let y0=Math.min(...parts.map(p=>p.box.y0));
  let x1=Math.max(...parts.map(p=>p.box.x1));
  let y1=Math.max(...parts.map(p=>p.box.y1));
  if(x1-x0>r*.44||y1-y0>r*.33)continue;
  if(hour>=10&&parts.length<2)continue;
  const px=Math.max(2,Math.round(r*.038));
  const py=Math.max(2,Math.round(r*.045));
  result.push({hour,box:{x0:Math.max(0,x0-px),
   y0:Math.max(0,y0-py),x1:Math.min(width,x1+px),
   y1:Math.min(height,y1+py)}});
 }
 return result;
}
