"use strict";
/* Lightweight camera overlay motion tracking. No character guesses, neural
 * model, network calls or OCR. This only moves boxes already verified by OCR.
 * The reference is sampled BEFORE OCR starts so matching is frame-grounded.
 */
(()=>{
 function greyPixels(image,width,height){
  if(!image?.data||image.data.length!==width*height*4)
   throw Error("Invalid camera tracking frame");
  const output=new Uint8Array(width*height);
  for(let i=0;i<output.length;i++){
   const k=i*4;
   output[i]=Math.round(image.data[k]*.299+
    image.data[k+1]*.587+image.data[k+2]*.114);
  }
  return output;
 }
 function gradient(g,w,h,x,y){
  x=Math.max(1,Math.min(w-2,x|0));
  y=Math.max(1,Math.min(h-2,y|0));
  const k=y*w+x;
  return Math.min(255,Math.abs(g[k+1]-g[k-1])+
   Math.abs(g[k+w]-g[k-w]));
 }
 function anchorsFor(words,sourceW,sourceH,w,h){
  const anchors=[],sx=w/sourceW,sy=h/sourceH;
  const sorted=(words||[]).filter(v=>v?.box&&v.text)
   .slice().sort((a,b)=>String(b.text).length-String(a.text).length);
  for(const word of sorted){
   const b=word.box,cx=(b.x0+b.x1)*sx/2,
    cy=(b.y0+b.y1)*sy/2,
    rx=Math.max(5,Math.min(24,(b.x1-b.x0)*sx*.42)),
    ry=Math.max(5,Math.min(17,(b.y1-b.y0)*sy*.9));
   if(cx-rx<28||cy-ry<28||cx+rx>w-28||cy+ry>h-28)continue;
   if(anchors.some(a=>Math.hypot(cx-a.cx,cy-a.cy)<24))continue;
   const spots=[];
   for(let y=-3;y<=3;y++)for(let x=-4;x<=4;x++)
    spots.push([Math.round(cx+x*rx/4),Math.round(cy+y*ry/3)]);
   anchors.push({cx,cy,spots});
   if(anchors.length===5)break;
  }
  return anchors;
 }
 function matchTranslation(reference,current,width,height,anchors,maxShift=22){
  if(!reference||!current||!anchors?.length||
     reference.length!==width*height||current.length!==width*height)
   return {valid:false,dx:0,dy:0};
  const chosen=[];
  for(const anchor of anchors){
   const values=anchor.spots.map(([x,y])=>gradient(reference,width,height,x,y));
   const variation=values.reduce((a,b)=>a+b,0)/values.length;
   if(variation<8)continue;
   chosen.push({spots:anchor.spots,values,variation});
  }
  if(!chosen.length)return {valid:false,dx:0,dy:0};
  const cost=(dx,dy)=>{
   let error=0,base=0;
   for(const a of chosen)for(let i=0;i<a.spots.length;i++){
    const [x,y]=a.spots[i];
    error+=Math.abs(a.values[i]-gradient(current,width,height,x+dx,y+dy));
    base+=a.values[i];
   }
   return error/Math.max(1,base);
  };
  // 3px coarse search plus local 1px refinement: bounded, low CPU cost.
  let best=Infinity,bx=0,by=0;
  const radius=Math.max(3,Math.min(28,Math.round(maxShift)));
  for(let dy=-radius;dy<=radius;dy+=3)
   for(let dx=-radius;dx<=radius;dx+=3){
    const score=cost(dx,dy);
    if(score<best){best=score;bx=dx;by=dy}
   }
  let optimal=best,ox=bx,oy=by;
  for(let dy=Math.max(-radius,by-3);dy<=Math.min(radius,by+3);dy++)
   for(let dx=Math.max(-radius,bx-3);dx<=Math.min(radius,bx+3);dx++){
    const score=cost(dx,dy);
    if(score<optimal){optimal=score;ox=dx;oy=dy}
   }
  // Reject substantial scene changes rather than drawing stale boxes.
  return {valid:optimal<.72,dx:ox,dy:oy,error:optimal,
   anchorCount:chosen.length};
 }
 function create(){
  const canvas=document.createElement("canvas");
  const ctx=canvas.getContext("2d",{willReadFrequently:true});
  const WIDTH=400;
  let reference=null,referenceW=0,referenceH=0,
   words=[],sourceW=0,sourceH=0,anchors=[],last=null;
  let lastSample=0;
  function capture(video){
   const sw=Number(video?.videoWidth)||Number(video?.width);
   const sh=Number(video?.videoHeight)||Number(video?.height);
   if(sw<80||sh<60)return null;
   const w=WIDTH,h=Math.max(64,Math.round(sh*w/sw));
   if(canvas.width!==w||canvas.height!==h){
    canvas.width=w;canvas.height=h;
   }
   ctx.drawImage(video,0,0,w,h);
   return {pixels:greyPixels(ctx.getImageData(0,0,w,h),w,h),
    width:w,height:h,sourceW:sw,sourceH:sh};
  }
  function staticMatch(next){
   if(!reference||!next||reference.length!==next.length)return false;
   let changed=0,count=0,total=0;
   const stride=Math.max(1,Math.floor(next.length/600));
   for(let i=0;i<next.length;i+=stride){
    const delta=Math.abs(next[i]-reference[i]);
    total+=delta;changed+=Number(delta>26);count++;
   }
   return total/Math.max(1,count)<8&&changed/Math.max(1,count)<.13;
  }
  return {
   capture,
   setReference(frame,recognized,srcWidth,srcHeight){
    if(!frame||!recognized?.length){reference=null;words=[];last=null;return}
    reference=frame.pixels;referenceW=frame.width;referenceH=frame.height;
    sourceW=srcWidth||frame.sourceW;sourceH=srcHeight||frame.sourceH;
    words=recognized;
    anchors=anchorsFor(words,sourceW,sourceH,referenceW,referenceH);
    last={valid:true,dx:0,dy:0};
    lastSample=0;
   },
   update(video,now=0){
    if(!reference)return {valid:false,dx:0,dy:0};
    if(now-lastSample<65&&last)return last;
    lastSample=now;
    const frame=capture(video);
    if(!frame||frame.width!==referenceW||frame.height!==referenceH||
       frame.sourceW!==sourceW||frame.sourceH!==sourceH){
     return last={valid:false,dx:0,dy:0};
    }
    let result=matchTranslation(reference,frame.pixels,
     referenceW,referenceH,anchors);
    // Tiny far-away words may not yield usable motion anchors. Holding
    // the same picture should still hold a verified rectangle in place.
    if(!result.valid&&staticMatch(frame.pixels))
     result={valid:true,dx:0,dy:0,error:0,stationary:true};
    last={...result,dx:result.dx*sourceW/referenceW,
     dy:result.dy*sourceH/referenceH};
    return last;
   },
   reset(){reference=null;words=[];anchors=[];last=null;lastSample=0}
  };
 }
 window.InkCameraMotion={create,greyPixels,anchorsFor,matchTranslation};
 if(typeof module!=="undefined"&&module.exports)
  module.exports={greyPixels,anchorsFor,matchTranslation};
})();
