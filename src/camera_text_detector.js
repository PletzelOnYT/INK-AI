"use strict";
/* First-party scene-text segmentation. No OCR libraries, services or templates. */
(()=>{
 const median=values=>{
  if(!values.length)return 0;
  const sorted=[...values].sort((a,b)=>a-b);
  return sorted[Math.floor(sorted.length/2)];
 };
 function findTextLines(mask,width,height,allowShort=false){
  const n=mask.length,visited=new Uint8Array(n),queue=new Int32Array(n);
  const comps=[];
  for(let origin=0;origin<n;origin++){
   if(!mask[origin]||visited[origin])continue;
   let head=0,tail=1;queue[0]=origin;visited[origin]=1;
   let minX=width,maxX=-1,minY=height,maxY=-1,area=0;
   while(head<tail){
    const i=queue[head++],y=(i/width)|0,x=i-y*width;
    area++;if(x<minX)minX=x;if(x>maxX)maxX=x;
    if(y<minY)minY=y;if(y>maxY)maxY=y;
    for(let dy=-1;dy<=1;dy++){
     const ny=y+dy;if(ny<0||ny>=height)continue;
     for(let dx=-1;dx<=1;dx++){
      const nx=x+dx;if(nx<0||nx>=width||(!dx&&!dy))continue;
      const j=ny*width+nx;
      if(mask[j]&&!visited[j]){visited[j]=1;queue[tail++]=j}
     }
    }
   }
   const w=maxX-minX+1,h=maxY-minY+1;
   if(w<2||h<6||h>Math.min(65,height*.16)||
      w>Math.max(70,h*2.4)||area<5||area/(w*h)<.07||
      area/(w*h)>.86||w/h<.065||w/h>2.4)continue;
   comps.push({x0:minX,y0:minY,x1:maxX,y1:maxY,
    width:w,height:h,area,cx:(minX+maxX)/2,cy:(minY+maxY)/2,mask});
  }
  // Connect neighboring glyph components with locally compatible baselines.
  // Unlike horizontal-row histograms, this handles slanted document text.
  if(comps.length>500)return [];
  const indices=comps.map((_,i)=>i).sort((a,b)=>comps[a].x0-comps[b].x0);
  const parent=comps.map((_,i)=>i);
  function find(i){while(i!==parent[i]){parent[i]=parent[parent[i]];i=parent[i]}return i}
  function join(i,j){const a=find(i),b=find(j);if(a!==b)parent[b]=a}
  for(let k=0;k<indices.length;k++){
   const i=indices[k],a=comps[i];
   for(let m=k+1;m<indices.length;m++){
    const j=indices[m],b=comps[j];
    if(b.x0-a.x0>Math.max(40,2.5*a.height))break;
    const h=Math.max(a.height,b.height);
    if(Math.min(a.height,b.height)/h<.44)continue;
    const gap=b.x0-a.x1-1;
    if(gap<-.4*Math.min(a.width,b.width)||gap>Math.max(12,h*1.4))continue;
    if(Math.abs(b.cy-a.cy)>h*.65)continue;
    join(i,j);
   }
  }
  const groups=new Map();
  for(let i=0;i<comps.length;i++){
   const root=find(i);
   if(!groups.has(root))groups.set(root,[]);
   groups.get(root).push(comps[i]);
  }
  const lines=[];
  for(const components of groups.values()){
   if(components.length<(allowShort?2:4)||components.length>44)continue;
   components.sort((a,b)=>a.x0-b.x0);
   const heights=components.map(c=>c.height),medH=median(heights);
   const span=components[components.length-1].x1-components[0].x0+1;
   if(span<(components.length<4?1.15:3.6)*medH)continue;
   const cx=components.reduce((a,c)=>a+c.cx,0)/components.length;
   const cy=components.reduce((a,c)=>a+c.cy,0)/components.length;
   let numerator=0,denominator=0;
   for(const c of components){numerator+=(c.cx-cx)*(c.cy-cy);denominator+=(c.cx-cx)**2}
   const slope=denominator?numerator/denominator:0;
   if(Math.abs(slope)>1.1)continue;
   const deviations=components.map(c=>Math.abs(c.cy-(cy+slope*(c.cx-cx))));
   const residual=median(deviations);
   if(residual>Math.max(2.8,.47*medH))continue;
   let valid=0,extreme=0;
   for(const c of components){
    if(c.height/medH>=.48&&c.height/medH<=1.9&&
       c.width/medH>=.075&&c.width/medH<=1.9)valid++;
    if(c.width/medH<.10||c.width/medH>1.7)extreme++;
   }
   if(valid/components.length<.73||extreme/components.length>.34)continue;
   const gaps=[];
   for(let i=1;i<components.length;i++)gaps.push(Math.max(0,components[i].x0-components[i-1].x1-1));
   if(median(gaps)>Math.max(6,medH*.86))continue;
   const score=(valid/components.length)+Math.min(1,components.length/10)-residual/(3*medH);
   lines.push({letters:components,score,slope,medianHeight:medH});
  }
  return lines;
 }
 function makeMasks(image,w,h){
  const p=image.data,stride=w+1,n=(w+1)*(h+1),R=new Uint32Array(n),G=new Uint32Array(n),B=new Uint32Array(n);
  for(let y=0;y<h;y++){
   let r=0,g=0,b=0;
   for(let x=0;x<w;x++){
    const j=(y*w+x)*4,i=(y+1)*stride+x+1,a=y*stride+x+1;
    r+=p[j];g+=p[j+1];b+=p[j+2];
    R[i]=R[a]+r;G[i]=G[a]+g;B[i]=B[a]+b;
   }
  }
  const area=(arr,x0,y0,x1,y1)=>arr[(y1+1)*stride+x1+1]-arr[y0*stride+x1+1]-arr[(y1+1)*stride+x0]+arr[y0*stride+x0];
  const masks=[new Uint8Array(w*h),new Uint8Array(w*h),new Uint8Array(w*h),new Uint8Array(w*h)];
  const radius=8;
  for(let y=0;y<h;y++){
   const y0=Math.max(0,y-radius),y1=Math.min(h-1,y+radius);
   for(let x=0;x<w;x++){
    const x0=Math.max(0,x-radius),x1=Math.min(w-1,x+radius);
    const size=(x1-x0+1)*(y1-y0+1),j=(y*w+x)*4;
    const rr=area(R,x0,y0,x1,y1)/size,gg=area(G,x0,y0,x1,y1)/size,bb=area(B,x0,y0,x1,y1)/size;
    const dr=p[j]-rr,dg=p[j+1]-gg,db=p[j+2]-bb;
    const luminosity=.299*dr+.587*dg+.114*db;
    const contrast=Math.max(Math.abs(dr),Math.abs(dg),Math.abs(db));
    const idx=y*w+x;
    if(luminosity<-14&&contrast>17)masks[0][idx]=1;
    else if(luminosity>14&&contrast>17)masks[1][idx]=1;
    else if(Math.abs(luminosity)<=14&&contrast>31)masks[2][idx]=1;
    // Strong white lettering on dark surfaces (e.g. glossy garment tags):
    // a narrow high-contrast mask separates compact uppercase strokes that
    // the broader local adaptive mask may merge into one component.
    const pixelLum=.299*p[j]+.587*p[j+1]+.114*p[j+2];
    if(pixelLum>165&&luminosity>36&&contrast>42)masks[3][idx]=1;
   }
  }
  return masks;
 }
 function detect(image,w,h){
  const masks=makeMasks(image,w,h);
  const lines=[];
  for(let i=0;i<masks.length;i++)
   lines.push(...findTextLines(masks[i],w,h,i===3));
  return lines;
 }
 const api={detect,makeMasks,findTextLines};
 if(typeof window!=="undefined")window.InkCameraDetector=api;
 if(typeof module!=="undefined"&&module.exports)module.exports=api;
})();