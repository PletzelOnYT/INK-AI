// Shape checks for letters that look very similar to punctuation or one another.
// Uses actual drawn pixels and ordered pen coordinates. Never generates ink.
function dottedStemEvidence(region,pixels){
 if(!region?.box||!pixels?.data)return false;
 const [rx0,ry0,rx1,ry1]=region.box, width=pixels.width;
 const x0=Math.max(0,Math.floor(rx0)),x1=Math.min(width-1,Math.ceil(rx1));
 const y0=Math.max(0,Math.floor(ry0)),y1=Math.min(pixels.height-1,Math.ceil(ry1));
 if(x1<x0||y1-y0<47)return false;
 const rows=[];
 for(let y=y0;y<=y1;y++){
  let n=0,low=Infinity,high=-Infinity,sumX=0;
  for(let x=x0;x<=x1;x++){
   const p=(y*width+x)*4;
   if(pixels.data[p]+pixels.data[p+1]+pixels.data[p+2]>=620)continue;
   n++;low=Math.min(low,x);high=Math.max(high,x);sumX+=x;
  }
  rows.push({y,n,low,high,sumX});
 }
 const runs=[];let first=-1,last=-1;
 for(let i=0;i<=rows.length;i++){
  if(i<rows.length&&rows[i].n){
   if(first<0)first=i;last=i;
  }else if(first>=0&&(i===rows.length||i-last>2)){
   runs.push(rows.slice(first,last+1));first=-1;last=-1;
  }
 }
 if(runs.length!==2)return false;
 const upper=runs[0],lower=runs[1];
 const topH=upper.length,bodyH=lower.length;
 const gap=lower[0].y-upper.at(-1).y-1;
 if(bodyH<34||topH>Math.min(23,bodyH*.35)||gap<9||gap>105)return false;
 const stats=run=>{
  let minX=Infinity,maxX=-Infinity,total=0,sx=0;
  for(const row of run){
   if(!row.n)continue;
   minX=Math.min(minX,row.low);maxX=Math.max(maxX,row.high);
   total+=row.n;sx+=row.sumX;
  }
  return {width:maxX-minX+1,center:sx/Math.max(1,total),area:total};
 };
 const dot=stats(upper),body=stats(lower);
 if(dot.width>Math.min(27,bodyH*.40)||
    body.width>Math.max(24,bodyH*.29)||
    dot.area>body.area*.5)return false;
 return Math.abs(dot.center-body.center)<=Math.max(24,bodyH*.25);
}
function openCStrokeEvidence(region,recordedStrokes){
 if(!region?.box||!recordedStrokes)return false;
 const [x0,y0,x1,y1]=region.box,w=x1-x0,h=y1-y0;
 // A c-shaped curve has an open mouth at the right, not the square turns
 // of a bracket or the narrow aspect ratio of most parentheses.
 if(w<26||h<30||w/h<.47||w/h>1.2)return false;
 const compatible=recordedStrokes.filter(s=>s.tool==="pen"&&!s.type&&s.points?.length>=6)
   .filter(s=>{
    const pts=s.points;
    return pts.every(([x,y])=>x>=x0-12&&x<=x1+12&&y>=y0-12&&y<=y1+12);
   });
 if(compatible.length!==1)return false;
 const pts=compatible[0].points;
 const start=pts[0],end=pts.at(-1);
 if(start[0]<x0+w*.58||end[0]<x0+w*.58||
    start[1]>y0+h*.40||end[1]<y0+h*.60)return false;
 let left=pts[0];
 for(const p of pts)if(p[0]<left[0])left=p;
 if(left[1]<y0+h*.19||left[1]>y0+h*.81)return false;
 // The first arm curves left into the bowl, the second returns right.
 return Math.abs(start[0]-end[0])<w*.37&&
   pts.some(p=>p[0]<x0+w*.26&&p[1]>y0+h*.25&&p[1]<y0+h*.75);
}
function refinedLetterAt(i,regions,predictions,pixels,strokes,initial){
 const options=predictions[i]?.top||[];
 if(!options.length)return initial;
 let ch=initial,confidence=options[0].confidence;
 const dot=dottedStemEvidence(regions[i],pixels);
 const iOption=options.find(o=>o.char==="i");
 if(dot&&iOption&&iOption.confidence>=.025&&
    (confidence<.94||ch==="i")){
  // A small dot ABOVE an upright stem is direct pen evidence. A semicolon
  // has two small components; an exclamation mark has its dot below.
  ch="i";confidence=iOption.confidence;
 }
 const cOption=options.find(o=>o.char==="c");
 const COption=options.find(o=>o.char==="C");
 if(!/^[cC]$/.test(ch)&&/^[\[\(]$/.test(ch)&&
    options[0].confidence<.75&&
    Math.max(cOption?.confidence||0,COption?.confidence||0)>=.12&&
    openCStrokeEvidence(regions[i],strokes)){
  ch=(cOption?.confidence||0)>=(COption?.confidence||0)?"c":"C";
 }
 if(!/^[cC]$/.test(ch))return ch;
 // C and c are often the same handwritten curve. Case can only be inferred
 // when other actual letters provide a height and lowercase reference.
 const here=regions[i],height=here.box[3]-here.box[1];
 const neighbors=[];
 for(const j of [i-1,i+1]){
  if(j<0||j>=regions.length||regions[j].line!==here.line)continue;
  if(j<i&&here.space||j>i&&regions[j].space)continue;
  const next=predictions[j]?.top?.[0];
  if(!next)continue;
  const letter=next.char;
  const isLower=(/^[abdeghijknpqrty]$/.test(letter)&&next.confidence>=.25)||
    (letter==="i"&&next.confidence>=.15)||
    dottedStemEvidence(regions[j],pixels);
  if(isLower)neighbors.push(regions[j].box[3]-regions[j].box[1]);
 }
 if(!neighbors.length)return ch;
 const nearH=neighbors.sort((a,b)=>a-b)[Math.floor(neighbors.length/2)];
 if(!nearH)return ch;
 if(height<=nearH*1.09&&ch==="C"&&
   cOption?.confidence>=Math.max(.08,(COption?.confidence||0)*.10)&&
   (COption?.confidence||0)<.92)return "c";
 if(height>nearH*1.34&&ch==="c"&&
   COption?.confidence>=Math.max(.10,(cOption?.confidence||0)*.16)&&
   (cOption?.confidence||0)<.9)return "C";
 return ch;
}
