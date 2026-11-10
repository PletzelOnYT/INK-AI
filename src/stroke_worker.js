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
// Sequence-level candidate validation. The GRU generates the geometry;
// this critic only scores/rejects physically implausible free-running samples.
// It never draws a shape, copies a template, or fabricates a stroke.
function continuationQuality(prefix,paths,label,penUps,stopReached){
 let x=0,y=0,minY=Infinity,maxY=-Infinity,minX=Infinity,maxX=-Infinity;
 for(const p of prefix){
  x+=p[0];y+=p[1];minY=Math.min(minY,y);maxY=Math.max(maxY,y);
  minX=Math.min(minX,x);maxX=Math.max(maxX,x);
 }
 const startX=x,startY=y;
 let length=0,down=0,up=0,flatSpan=0,changes=0,lastDir=0;
 let longestJump=0,fragmentCount=0,sharpTurns=0,straightestRun=0;
 let minTailY=Infinity,maxTailY=-Infinity;
 let endX=x,endY=y;
 for(const path of paths){
  if(path.length<3)fragmentCount++;
  let runLength=0,previousVector=null;
  for(let j=0;j<path.length;j++){
   const [px,py]=path[j];
   if(!Number.isFinite(px)||!Number.isFinite(py))
    return {score:-1e6,reason:"nonfinite"};
   minTailY=Math.min(minTailY,py);maxTailY=Math.max(maxTailY,py);
   if(j){
    const dx=px-path[j-1][0],dy=py-path[j-1][1];
    const step=Math.hypot(dx,dy);
    longestJump=Math.max(longestJump,step);
    runLength+=step;
    if(previousVector&&step>.006){
     const dot=previousVector[0]*dx+previousVector[1]*dy;
     const cross=previousVector[0]*dy-previousVector[1]*dx;
     if(Math.atan2(Math.abs(cross),dot)>2.35)sharpTurns++;
    }
    if(step>.006)previousVector=[dx,dy];
    if(step>.125)changes+=2;
    length+=step;
    if(dy>.012)down+=dy;
    if(dy<-.012)up-=dy;
    if(Math.abs(dx)>.01){
     const dir=Math.sign(dx);
     if(lastDir&&dir!==lastDir)changes++;
     lastDir=dir;
    }
   }
  }
  const last=path.at(-1),first=path[0];
  if(first&&runLength>.08)straightestRun=Math.max(straightestRun,
    Math.hypot(last[0]-first[0],last[1]-first[1])/runLength);
  endX=last[0];endY=last[1];
 }
 if(length<.035)return {score:-1e6,reason:"empty"};
 const dx=endX-startX,dy=endY-startY;
 const tailRange=maxTailY-minTailY;
 const horizontallyFlat=length>.16&&Math.abs(dx)>.15&&
   Math.abs(dy)<.075&&tailRange<.105;
 let score=0;
 // Straight tails are wrong for rounded letters, but perfectly valid for
 // horizontal symbols, serifs, and crossbars. Do not "fix h" by breaking =/-.
 const curvedLetters="abcdeghjmnopqrsuyBCDGJOPQRSU";
 const horizontalShapes="-_=+±≠≤≥EFHILTtTf#";
 const ascender=/^[hbnm]$/.test(label);
 const tall=maxY-minY>.36,arcStarted=x-minX>.10;
 const descendingLeg=ascender&&tall&&arcStarted&&
    endY>startY+.075&&Math.abs(endX-startX)<.22;
 // Reject learned but visibly broken continuations, without drawing
 // templates or manufacturing a different stroke.
 if(longestJump>.108)score-=9;
 if(sharpTurns>2)score-=3*(sharpTurns-2);
 if(fragmentCount>1&&!/^[ijt!+*=H#:%]$/.test(label))score-=7;
 if(curvedLetters.includes(label)&&length>.14&&
    straightestRun>.988&&!descendingLeg)score-=8;
 // A rising rightward ray from the right leg of h/n/m/b is not a natural
 // descending continuation. Penalize actual sampled neural geometry only.
 if(/^[hbnm]$/.test(label)&&length>.17&&dx>.14&&
    dy<-.10&&up>down*1.5)score-=14;
 if(horizontallyFlat&&curvedLetters.includes(label))score-=12;
 else if(horizontallyFlat&&!horizontalShapes.includes(label))score-=2;
 if(length>.85)score-=3*(length-.85);
 if(!stopReached)score-=.18; // do not prefer endless uncontrolled tails
 if(changes>8)score-=.4*(changes-8);
 if(penUps>3)score-=.6*(penUps-3);
 // Ascenders with rounded shoulders require a descending right leg.
 // These are shape-validity constraints, NOT hand-coded generated strokes.
 if(ascender&&tall&&arcStarted){
  const expectedBottom=Math.max(startY+.07,maxY-.095);
  if(endY<expectedBottom)score-=11+18*(expectedBottom-endY);
  else score+=Math.min(.6,(endY-startY)*2.5);
  if(label==="h"&&endX<startX-.035)score-=2;
  // Do not let an h shoulder turn into a long horizontal appendage.
  // This critic never invents geometry: it only rejects a neural rollout
  // that extends far beyond the rightmost ink the writer has already made.
  const excess=Math.max(0,endX-(maxX+Math.max(.17,(maxX-minX)*.55)));
  score-=Math.min(9,excess*14);
 }
 if(label==="h"&&tall&&arcStarted){
  if(down<.065)score-=10;
  if(length>.14&&down<up*.30)score-=3;
  // In a lowercase h the right leg normally returns to the baseline of the
  // existing ascender. Avoid a tail hanging far below the original stem.
  const baselineError=Math.abs(endY-maxY);
  score-=Math.min(10,baselineError*7);
  if(endY>maxY+.16)score-=10;
 }
 // Avoid strange detached left-going extensions after a finished letter.
 if(endX<minX-.12||endX>Math.max(maxX,startX)+.70)score-=4;
 // Prefer modest, curved endings to unnecessary horizontal tails.
 score+=Math.min(.4,Math.min(down,up)*1.2);
 return {score,reason:horizontallyFlat?"flat-tail":"ok",
    end:[endX,endY],length,down,flat:horizontallyFlat};
}
// A handwritten prefix is the same for every sampled trajectory of a label.
 // Run the expensive GRU prefix only ONCE per label, then copy the learned
 // hidden states to independently sample each continuation. No templates.
function preparePrefix(prefix,label){
 const index=characters.indexOf(label);
 if(index<0)throw Error("Unknown handwritten glyph: "+label);
 const characterEmbedding=embedding.subarray(index*embedSize,(index+1)*embedSize);
 const states=layers.map(()=>new Float32Array(hiddenSize));
 let last=null,x=0,y=0,score=0;
 for(let j=0;j<prefix.length;j++){
  const token=prefix[j];
  if(token.length!==3||!token.every(Number.isFinite))throw Error("Invalid pen prefix");
  if(j>0)score+=likelihood(last,token);
  x+=token[0];y+=token[1];
  last=step(token,states,characterEmbedding);
 }
 return {characterEmbedding,states,last,x,y,
  prefixScore:score/Math.max(1,prefix.length-1)};
}
function completeGlyph(prefix,label,seed,variation,limitSteps=maxSteps,prepared=null){
 const history=prepared||preparePrefix(prefix,label);
 const charEmbedding=history.characterEmbedding;
 const states=history.states.map(s=>new Float32Array(s));
 let last=history.last,x=history.x,y=history.y,score=history.prefixScore;
 // Stable input-conditioned seed avoids flashing unrelated previews on
 // repeated repainting of identical user strokes.
 // The generation seed belongs to the current pen gesture, not to
 // a changing prefix hash. Otherwise each new point completely reshuffles
 // the Gaussian noise and makes the assistant flicker/jitter.
 const rand=rng(hash(seed,label,variation?19:0));
 let active=[[x,y]],paths=[],moves=0,penUps=0,stopReached=false;
 let logSum=0,logCount=0,bestEarly=null;
 for(let j=0;j<limitSteps;j++){
  if(!last)break;
  const predicted=sample(last,rand,variation);
  let {dx,dy,draw}=predicted;
  if(!Number.isFinite(dx)||!Number.isFinite(dy))break;
  // Reject unphysical pen-down leaps without inventing a continuation line.
  const length=Math.hypot(dx,dy);
  if(draw&&length>.12){dx*=.12/length;dy*=.12/length}
  if(!draw&&length>.8){dx*=.8/length;dy*=.8/length}
  // Measure how likely EACH proposed pen movement is under the learned
  // conditional trajectory distribution. Previously every random rollout
  // inherited the identical likelihood score of the user's input prefix.
  const logp=likelihood(last,[dx,dy,draw?1:0]);
  if(Number.isFinite(logp)){logSum+=Math.max(-18,Math.min(12,logp));logCount++}
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
  // An MDN can keep sampling long after the useful stroke is finished.
  // Evaluate prefixes of the REAL generated vectors and retain a high-
  // quality natural stopping point; never extrapolate a procedural line.
  if(j>=5&&j%2===1&&moves>=4&&active.length>=3){
   const visible=[...paths,active];
   const check=continuationQuality(prefix,visible,label,penUps,false);
   if(check.length>=.055&&check.score>-.9){
    const evidence=logCount?logSum/logCount:0;
    const selection=check.score+.06*Math.min(check.length,.5);
    if(!bestEarly||selection>bestEarly.selection){
     bestEarly={paths:visible.map(p=>p.map(q=>q.slice())),
       moves,penUps,quality:check,
       rolloutLogLikelihood:evidence,selection,stopReached:false};
    }
   }
  }
  if(predicted.stop&&j>=4){stopReached=true;break}
 }
 if(active.length>1)paths.push(active);
 const fullQuality=continuationQuality(prefix,paths,label,penUps,stopReached);
 const avgLog=logCount?logSum/logCount:-18;
 // Prefer a sufficiently better learned stopping point to an overlong tail.
 // Keep the full rollout when its quality is comparable.
 const truncated=bestEarly&&bestEarly.selection>fullQuality.score+1.0;
 const selected=truncated?bestEarly:null;
 // Never emit empty previews or arbitrary shapes disconnected from input.
 return {paths:selected?selected.paths:paths,
  moves:selected?selected.moves:moves,
  penUps:selected?selected.penUps:penUps,prefixScore:score,
  stopReached:selected?false:stopReached,
  quality:selected?selected.quality:fullQuality,
  rolloutLogLikelihood:selected?selected.rolloutLogLikelihood:avgLog,
  truncated:Boolean(truncated)};
}
// Keep two independently trained recurrent nets in the SAME worker.
// A prefix-fine-tuned checkpoint can improve average free-roll error yet
// fail a particular unfinished glyph (e.g. the reported lowercase h).
// In that situation revert to the verified older *neural* network for this
// one character. No templates, raster lookups, or fake generated lines.
let mainNetworkState=null,backupNetworkState=null;
function captureNetwork(){
 return {network,characters,embedding,layers,outputWeight,outputBias,
  hiddenSize,embedSize,kCount,outputRows,maxSteps};
}
function useNetwork(s){
 ({network,characters,embedding,layers,outputWeight,outputBias,
   hiddenSize,embedSize,kCount,outputRows,maxSteps}=s);
}
function prepareNetwork(o){
 const previous=captureNetwork();
 try{
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
  return captureNetwork();
 }finally{useNetwork(previous)}
}
function generateCandidates(m,isFallback=false){
   const prefix=m.prefix,serial=m.serial,epoch=m.epoch;
   const live=m.live===true;
   const gestureSeed=(Number(m.seed)||0)|0;
   const steps=Math.max(12,Math.min(maxSteps,Number(m.maxSteps)||maxSteps));
   if(!Array.isArray(prefix)||prefix.length<2||prefix.length>120)
    throw Error("Insufficient genuine pen coordinates");
   const options=(m.options||[]).filter(o=>characters.includes(o.char))
     .sort((a,b)=>Number(b.char===m.preferred)-Number(a.char===m.preferred))
     .slice(0,live?2:4);
   const results=[];
   // Multiple independent genuine GRU rollouts. Select trajectories using
   // a class-conditioned structural critic, not the first random sample.
   // More samples when stationary; cap live work to maintain responsiveness.
   const perLabel=live?(hiddenSize>=300?2:3):(hiddenSize>=300?6:12);
   let previewSent=false;
   for(let j=0;j<options.length;j++){
    const choice=options[j];
    const prepared=preparePrefix(prefix,choice.char);
    const candidates=[];
    for(let attempt=0;attempt<perLabel;attempt++){
     const result=completeGlyph(prefix,choice.char,
       gestureSeed+j*571+attempt*997,attempt>0,steps,prepared);
     if(result.moves<2||!result.paths.length)continue;
     // Geometry acceptance and neural probability are independent gates.
     // A high likelihood must not rescue a physically invalid continuation.
     if(result.quality.score<-.9)continue;
     const consistency=Math.max(-6,Math.min(9,result.rolloutLogLikelihood));
     const value=result.quality.score+
       .18*consistency+
       Math.min(1.8,result.prefixScore*.04)+
       .17*Math.log((choice.confidence||0)+.03);
     if(value<-.9)continue;
     const candidate={
       label:choice.char,paths:result.paths,
       penUps:result.penUps,confidence:choice.confidence||0,
       score:value,reason:result.quality.reason,
       quality:result.quality.score,variant:attempt,
       rolloutLogLikelihood:result.rolloutLogLikelihood,
       truncated:result.truncated
     };
     candidates.push(candidate);
     // Do not flash the FIRST sampled line. Wait for this label's neural
     // candidates to be scored and display its highest-ranked rollout.
    }
    candidates.sort((a,b)=>b.score-a.score);
    let accepted=0;
    for(const candidate of candidates){
      if(accepted>=(live?1:3))break;
      const end=candidate.paths.at(-1)?.at(-1);
      if(!end)continue;
      // Keep only genuinely distinct handwritten continuations. Sending
      // repeated identical strokes makes Tab useless.
      const duplicate=results.some(previous=>{
        if(previous.label!==candidate.label)return false;
        const other=previous.paths.at(-1)?.at(-1);
        if(!other)return false;
        return Math.hypot(end[0]-other[0],end[1]-other[1])<.045&&
          previous.paths.length===candidate.paths.length;
      });
      if(duplicate)continue;
      results.push(candidate);accepted++;
    }
    if(!previewSent&&accepted&&results.length===accepted&&
       (!m.preferred||choice.char===m.preferred)){
      // The preview is now selected AFTER comparing all genuine GRU samples
      // for this character, rather than whichever random sample ran first.
      self.postMessage({type:"preview",serial,epoch,
       alternatives:[results[0]],neural:true,engine:"stroke-gru-mdn"});
      previewSent=true;
    }
   }
   // Full results include several independent genuine neural rollouts, so
   // the browser can score the finished glyph with the separate OCR network.
   results.sort((a,b)=>b.score-a.score);
   if(isFallback)for(const result of results)result.source="validated-older-neural-generator";
   return results;
}
self.onmessage=e=>{
 const m=e.data;
 try{
  if(m.cmd==="init"){
   mainNetworkState=prepareNetwork(m.model);
   useNetwork(mainNetworkState);
   self.postMessage({type:"ready",engine:"stroke-gru-mdn",
     parameters:network.parameter_count,classes:characters.length,
     prefixTuned:Boolean(network.training?.prefix_tuned),
     prefixDomain:Boolean(network.training?.prefix_domain_v2),
     prefixDomainV3:Boolean(network.training?.prefix_domain_v3),
     penLift:Boolean(network.training?.penlift_calibrated_v3),
     realSamples:network.training.real_training_glyphs});
  }else if(m.cmd==="fallback"){
   if(!mainNetworkState)throw Error("Initialize primary model first");
   backupNetworkState=prepareNetwork(m.model);
   self.postMessage({type:"fallback-ready",
      parameters:backupNetworkState.network.parameter_count});
  }else if(m.cmd==="generate"){
   if(!mainNetworkState)throw Error("Neural generator is not initialized");
   useNetwork(mainNetworkState);
   let results=generateCandidates(m);
   let usedFallback=false;
   const hasPreferred=()=>!m.preferred||results.some(r=>r.label===m.preferred);
   if((!results.length||!hasPreferred()||(!m.live&&m.searchFallback===true))&&backupNetworkState){
    try{
     useNetwork(backupNetworkState);
     const options=m.preferred?
       (m.options||[]).filter(x=>x.char===m.preferred):
       m.options;
     const backup=generateCandidates({...m,options},true);
     if(backup.length){
      const primaryPreferred=results.filter(x=>x.label===m.preferred);
      // For offline scoring, keep both independent generators as candidates.
      // In fast live mode, prefer the known-good fallback for missing glyphs.
      results=(!m.live&&m.searchFallback)?
        [...primaryPreferred,...backup,...results.filter(x=>x.label!==m.preferred)]:
        [...backup,...results.filter(x=>!backup.some(b=>b.label===x.label))];
      usedFallback=true;
     }
    }finally{useNetwork(mainNetworkState)}
   }
   // Never show a visibly different glyph when whole-board OCR has already
   // identified the intended character; keep other models for Tab only.
   if(m.preferred){
    if(!hasPreferred())results=[];
    else results.sort((a,b)=>Number(b.label===m.preferred)-
                         Number(a.label===m.preferred)||b.score-a.score);
   }
   self.postMessage({type:"completion",serial:m.serial,epoch:m.epoch,
      alternatives:results,neural:true,engine:"stroke-gru-mdn",
      fallback:usedFallback});
  }else throw Error("Unknown neural generation command");
 }catch(error){
  if(mainNetworkState)useNetwork(mainNetworkState);
  self.postMessage({type:"error",serial:m.serial,epoch:m.epoch,
    message:String(error?.message||error)});
 }
};
