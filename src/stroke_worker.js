"use strict";
/* INK AI online handwriting generator: actual autoregressive GRU / MDN.
 * Each output is a pen trajectory. NO pixel reconstruction, glyph references,
 * raster skeletonization, nearest-neighbor, font templates or geometry paths.
 */
let network=null,characters=[],embedding=null,layers=[],outputWeight=null,outputBias=null;
let hiddenSize=0,embedSize=0,kCount=0,outputRows=0,maxSteps=48;
function unpack(obj){
 const bytes=atob(obj.weights),out=new Float32Array(bytes.length);
 for(let i=0;i<bytes.length;i++){
  const v=bytes.charCodeAt(i);out[i]=(v>127?v-256:v)*obj.scale;
 }
 return {w:out,shape:obj.shape};
}
function product(mat,x,row){
 const w=mat.w,n=mat.shape[1],offset=row*n;
 let sum=0;
 for(let i=0;i<n;i++)sum+=w[offset+i]*x[i];
 return sum;
}
function sig(v){return v>=0?1/(1+Math.exp(-v)):Math.exp(v)/(1+Math.exp(v))}
function step(token,states,characterEmbedding){
 const in0=new Float32Array(3+embedSize);
 in0.set(token);in0.set(characterEmbedding,3);
 let input=in0;
 for(let layer=0;layer<layers.length;layer++){
  const L=layers[layer],old=states[layer],H=hiddenSize;
  const gi=new Float32Array(H*3),gh=new Float32Array(H*3);
  const inputRows=L.ih.shape[1];
  // GRU weights follow PyTorch gate ordering (reset, update, candidate).
  for(let r=0;r<3*H;r++){
   const wi=r*inputRows,wh=r*H;
   let a=L.bi[r],b=L.bh[r];
   for(let j=0;j<inputRows;j++)a+=L.ih.w[wi+j]*input[j];
   for(let j=0;j<H;j++)b+=L.hh.w[wh+j]*old[j];
   gi[r]=a;gh[r]=b;
  }
  const next=new Float32Array(H);
  for(let j=0;j<H;j++){
   const reset=sig(gi[j]+gh[j]);
   const update=sig(gi[H+j]+gh[H+j]);
   const candidate=Math.tanh(gi[H*2+j]+reset*gh[H*2+j]);
   next[j]=candidate*(1-update)+old[j]*update;
  }
  states[layer]=next;input=next;
 }
 const output=new Float32Array(outputRows);
 for(let i=0;i<outputRows;i++){
  let value=outputBias[i],offset=i*hiddenSize;
  for(let j=0;j<hiddenSize;j++)value+=outputWeight.w[offset+j]*input[j];
  output[i]=value;
 }
 return output;
}
function hash(seed,label,serial){
 let x=((seed+serial*7919+label.charCodeAt(0)*6269)|0)^0x6c7d1f3b;
 return x||1729;
}
function rng(seed){
 let x=seed|0;
 return ()=>{x^=x<<13;x^=x>>>17;x^=x<<5;return (x>>>0)/4294967296};
}
function normal(random){
 return Math.sqrt(-2*Math.log(Math.max(1e-8,random())))*
   Math.cos(6.283185307179586*random());
}
function sample(output,random,variation){
 const K=kCount;
 let mx=-Infinity;
 for(let j=0;j<K;j++)mx=Math.max(mx,output[j]);
 const weights=new Float32Array(K),temperature=variation?0.88:0.55;
 let sum=0;
 for(let j=0;j<K;j++){weights[j]=Math.exp((output[j]-mx)/temperature);sum+=weights[j]}
 let u=random()*sum,choice=K-1;
 for(let j=0;j<K;j++){u-=weights[j];if(u<=0){choice=j;break}}
 const jitter=variation?.34:.13;
 const sdX=Math.exp(Math.max(-5,Math.min(.6,output[3*K+choice])));
 const sdY=Math.exp(Math.max(-5,Math.min(.6,output[4*K+choice])));
 const dx=output[K+choice]+normal(random)*sdX*jitter;
 const dy=output[2*K+choice]+normal(random)*sdY*jitter;
 // Pen-up is a learned Bernoulli random variable, not an argmax gate.
 // This is essential for multi-stroke characters whose lift events are rare.
 const draw=random()<sig(output[5*K]);
 const stop=sig(output[5*K+1])>0.56;
 return {dx,dy,draw,stop};
}
// Class likelihood of the user's *real ordered prefix*, evaluated by the
// generative model itself; no retrieved reference images or templates.
function likelihood(output,actual){
 const k=kCount,dx=actual[0],dy=actual[1];
 let maxLogit=-Infinity;
 for(let i=0;i<k;i++)maxLogit=Math.max(maxLogit,output[i]);
 let norm=0;
 for(let i=0;i<k;i++)norm+=Math.exp(output[i]-maxLogit);
 let maxDensity=-Infinity;
 const values=[];
 for(let i=0;i<k;i++){
  const sx=Math.max(-5,Math.min(1,output[3*k+i]));
  const sy=Math.max(-5,Math.min(1,output[4*k+i]));
  const mx=output[k+i],my=output[2*k+i];
  const z=-Math.log(2*Math.PI)-sx-sy-
    .5*((dx-mx)*(dx-mx)*Math.exp(-2*sx)+
       (dy-my)*(dy-my)*Math.exp(-2*sy));
  const joint=output[i]-maxLogit-Math.log(norm)+z;
  values.push(joint);maxDensity=Math.max(maxDensity,joint);
 }
 let sum=0;for(const v of values)sum+=Math.exp(v-maxDensity);
 const draw=sig(output[5*k]),actualDraw=actual[2]>0.5;
 return maxDensity+Math.log(sum)+
   Math.log(Math.max(1e-5,actualDraw?draw:1-draw));
}
function completeGlyph(prefix,label,seed,variation,limitSteps=maxSteps){
 const index=characters.indexOf(label);
 if(index<0)throw Error("Unknown handwritten glyph: "+label);
 const charEmbedding=embedding.subarray(index*embedSize,(index+1)*embedSize);
 const states=layers.map(()=>new Float32Array(hiddenSize));
 let last=null,x=0,y=0,score=0;
 for(let j=0;j<prefix.length;j++){
  const token=prefix[j];
  if(token.length!==3||!token.every(Number.isFinite))throw Error("Invalid pen prefix");
  if(j>0)score+=likelihood(last,token);
  x+=token[0];y+=token[1];
  last=step(token,states,charEmbedding);
 }
 score/=Math.max(1,prefix.length-1);
 // Stable input-conditioned seed avoids flashing unrelated previews on
 // repeated repainting of identical user strokes.
 // The generation seed belongs to the current pen gesture, not to
 // a changing prefix hash. Otherwise each new point completely reshuffles
 // the Gaussian noise and makes the assistant flicker/jitter.
 const rand=rng(hash(seed,label,variation?19:0));
 let active=[[x,y]],paths=[],moves=0,penUps=0;
 for(let j=0;j<limitSteps;j++){
  if(!last)break;
  const predicted=sample(last,rand,variation);
  let {dx,dy,draw}=predicted;
  if(!Number.isFinite(dx)||!Number.isFinite(dy))break;
  // Reject unphysical pen-down leaps without inventing a continuation line.
  const length=Math.hypot(dx,dy);
  if(draw&&length>.12){dx*=.12/length;dy*=.12/length}
  if(!draw&&length>.8){dx*=.8/length;dy*=.8/length}
  const nx=x+dx,ny=y+dy;
  if(nx<-.08||nx>1.08||ny<-.08||ny>1.08)break;
  x=nx;y=ny;
  if(draw){
   active.push([x,y]);moves++;
  }else{
   if(active.length>1)paths.push(active);
   active=[[x,y]];penUps++;
  }
  last=step([dx,dy,draw?1:0],states,charEmbedding);
  if(predicted.stop&&j>=4)break;
 }
 if(active.length>1)paths.push(active);
 // Never emit empty previews or arbitrary shapes disconnected from input.
 return {paths,moves,penUps,prefixScore:score};
}
self.onmessage=e=>{
 const m=e.data;
 try{
  if(m.cmd==="init"){
   const o=m.model;
   if(o?.format!=="ink-online-stroke-mdn-v1")throw Error("Expected actual online stroke generator");
   if(o.architecture?.input!==3||o.architecture?.mixtures!==5||
      o.architecture?.layers!==2)throw Error("Unsupported GRU trajectory model");
   network=o;characters=o.labels;
   hiddenSize=o.architecture.hidden;embedSize=o.architecture.embed;
   kCount=o.architecture.mixtures;
   maxSteps=Math.min(64,o.architecture.max_generate||48);
   if(hiddenSize<24||hiddenSize>384||characters.length<100)
    throw Error("Unvalidated neural trajectory model dimensions");
   embedding=Float32Array.from(o.embedding.flat());
   layers=o.gru.map(l=>({ih:unpack(l.ih),hh:unpack(l.hh),
      bi:Float32Array.from(l.bias_ih),bh:Float32Array.from(l.bias_hh)}));
   outputWeight=unpack(o.head_weight);
   outputBias=Float32Array.from(o.head_bias);
   outputRows=5*kCount+2;
   for(let k=0;k<layers.length;k++){
    const expected=k===0?3+embedSize:hiddenSize;
    if(layers[k].ih.shape[0]!==3*hiddenSize||
       layers[k].ih.shape[1]!==expected||
       layers[k].hh.shape[1]!==hiddenSize)throw Error("Corrupt GRU weights");
   }
   if(outputWeight.shape[0]!==outputRows||
      outputWeight.shape[1]!==hiddenSize)throw Error("Corrupt trajectory head");
   self.postMessage({type:"ready",engine:"stroke-gru-mdn",
     parameters:o.parameter_count,classes:characters.length,
     realSamples:o.training.real_training_glyphs});
  }else if(m.cmd==="generate"){
   if(!network)throw Error("Neural generator is not initialized");
   const prefix=m.prefix,serial=m.serial,epoch=m.epoch;
   const live=m.live===true;
   const gestureSeed=(Number(m.seed)||0)|0;
   const steps=Math.max(12,Math.min(maxSteps,Number(m.maxSteps)||maxSteps));
   if(!Array.isArray(prefix)||prefix.length<2||prefix.length>120)
    throw Error("Insufficient genuine pen coordinates");
   const options=(m.options||[]).filter(o=>characters.includes(o.char))
     .slice(0,live?2:4);
   const results=[];
   let j=0;
   for(const choice of options){
    // Deterministic class-conditioned sample for identical pen prefixes;
    // do NOT reseed every time the UI asks for an update.
    const result=completeGlyph(prefix,choice.char,gestureSeed+j*571,false,steps);
    if(result.moves>2&&result.paths.length)results.push({
      label:choice.char,paths:result.paths,
      penUps:result.penUps,confidence:choice.confidence||0,
      score:result.prefixScore+0.25*Math.log((choice.confidence||0)+.03)
    });
    j++;
    // Stream the first available vector trajectory without waiting for
    // additional neural samples to finish. Main thread is free to paint.
    if(results.length===1&&j===1)self.postMessage({
      type:"preview",serial,epoch,alternatives:results.slice(),
      neural:true,engine:"stroke-gru-mdn"
    });
   }
   // Provide a second learned sample for Tab cycling when classifier
   // candidates are too ambiguous to yield two usable vector trajectories.
   if(results.length===1&&!live){
    const alt=completeGlyph(prefix,results[0].label,gestureSeed+31,true,steps);
    if(alt.moves>2&&alt.paths.length){
     results.push({label:results[0].label,paths:alt.paths,
       penUps:alt.penUps,confidence:results[0].confidence,
       score:results[0].score-.15,variant:"stochastic"});
    }
   }
   results.sort((a,b)=>b.score-a.score);
   self.postMessage({type:"completion",serial,epoch,
       alternatives:results,neural:true,engine:"stroke-gru-mdn"});
  }else throw Error("Unknown neural generation command");
 }catch(error){
  self.postMessage({type:"error",serial:m.serial,epoch:m.epoch,
    message:String(error?.message||error)});
 }
};
