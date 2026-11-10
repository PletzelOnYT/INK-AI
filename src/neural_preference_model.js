"use strict";
/* INK AI's on-device learned preference critic.
 * Small 14 -> 12 -> 1 tanh network trained with rewarded feedback from G
 * acceptances and pairwise SGD when alternatives exist. It ranks real GRU
 * proposals, never draws glyphs.
 * Only numeric weights are saved locally; no ink coordinates are persisted.
 * The model starts neutral, so it cannot spoil a fresh installation.
 */
(function(root){
 const INPUT=14,HIDDEN=12,KEY="ink-ai-preferences-v1",VERSION=1;
 const bound=(n,lo,hi)=>Math.max(lo,Math.min(hi,Number.isFinite(n)?n:0));
 const dot=(a,b)=>a[0]*b[0]+a[1]*b[1];
 function features(candidate,pending){
  const paths=Array.isArray(candidate?.paths)?candidate.paths:[];
  const points=paths.flat().filter(p=>Array.isArray(p)&&p.length>=2&&
    Number.isFinite(p[0])&&Number.isFinite(p[1]));
  let length=0,maxJump=0,bends=0,straight=0,totalSegments=0;
  for(const path of paths){
   let old=null,prev=null,travel=0;
   for(const p of path){
    if(old){
     const dx=p[0]-old[0],dy=p[1]-old[1],jump=Math.hypot(dx,dy);
     length+=jump;travel+=jump;maxJump=Math.max(maxJump,jump);
     if(prev&&jump>.003){
      bends+=Math.atan2(Math.abs(prev[0]*dy-prev[1]*dx),dot(prev,[dx,dy]))/Math.PI;
     }
     if(jump>.003){prev=[dx,dy];totalSegments++}
    }
    old=p;
   }
   if(path.length>1&&travel>.04){
    const a=path[0],z=path[path.length-1];
    straight=Math.max(straight,Math.hypot(z[0]-a[0],z[1]-a[1])/travel);
   }
  }
  const first=points[0]||[0,0],last=points[points.length-1]||first;
  const frame=pending?.frame,ink=pending?.lastInk;
  const disconnected=frame&&ink?Math.hypot(
    frame.x+first[0]*frame.size-ink[0],
    frame.y+first[1]*frame.size-ink[1])/Math.max(1,frame.size):0;
  const label=String(candidate?.label||"");
  const curved=/^[abcegopqrsu238690]$/i.test(label)?1:0;
  return [
   bound(candidate?.quality/4,-2,2),
   bound(candidate?.rolloutLogLikelihood/10,-2,2),
   bound(candidate?.score/7,-2,2),
   bound(candidate?.confidence,0,1),
   bound(candidate?._finishedConfidence,0,1),
   bound(length,-.1,2),
   bound(last[0]-first[0],-1,1),
   bound(last[1]-first[1],-1,1),
   bound(maxJump*6,0,2),
   bound(bends/Math.max(1,totalSegments)*2,0,2),
   bound(straight,0,1),
   bound(disconnected*3,0,2),
   bound(paths.length/4,0,2),
   curved
  ];
 }
 function create(storage){
  let w1=Array.from({length:INPUT*HIDDEN},(_,i)=>
   Math.sin((i+1)*.89)*.065),b1=Array(HIDDEN).fill(0),
   w2=Array(HIDDEN).fill(0),seen=0;
  const load=()=>{
   if(!storage)return;
   try{
    const x=JSON.parse(storage.getItem(KEY)||"null");
    if(!x||x.version!==VERSION||
      !Number.isSafeInteger(x.seen)||x.seen<0||x.seen>100000||
      !Array.isArray(x.w1)||x.w1.length!==INPUT*HIDDEN||
      !Array.isArray(x.w2)||x.w2.length!==HIDDEN||
      !Array.isArray(x.b1)||x.b1.length!==HIDDEN)return;
    if(![...x.w1,...x.w2,...x.b1].every(t=>
        Number.isFinite(t)&&Math.abs(t)<=3))return;
    w1=x.w1;b1=x.b1;w2=x.w2;seen=x.seen;
   }catch(_){}
  };
  const persist=()=>{
   if(!storage)return;
   try{storage.setItem(KEY,JSON.stringify({
    version:VERSION,w1,w2,b1,seen
   }))}catch(_){}
  };
  function snapshot(){
   return {version:VERSION,seen,w1:w1.slice(),w2:w2.slice(),b1:b1.slice()};
  }
  function restore(x){
   if(!x||x.version!==VERSION||
      !Number.isSafeInteger(x.seen)||x.seen<0||x.seen>100000||
      !Array.isArray(x.w1)||x.w1.length!==INPUT*HIDDEN||
      !Array.isArray(x.w2)||x.w2.length!==HIDDEN||
      !Array.isArray(x.b1)||x.b1.length!==HIDDEN||
      ![...x.w1,...x.w2,...x.b1].every(v=>
       Number.isFinite(v)&&Math.abs(v)<=3))return false;
   w1=x.w1.slice();w2=x.w2.slice();b1=x.b1.slice();seen=x.seen;
   persist();return true;
  }
  function evaluate(x){
   const hidden=[];
   for(let j=0;j<HIDDEN;j++){
    let s=b1[j];
    for(let i=0;i<INPUT;i++)s+=w1[j*INPUT+i]*x[i];
    hidden[j]=Math.tanh(s);
   }
   let score=0;
   for(let j=0;j<HIDDEN;j++)score+=w2[j]*hidden[j];
   return {score,hidden};
  }
  function predict(candidate,pending){
   return bound(evaluate(features(candidate,pending)).score,-3,3);
  }
  function rank(candidates,pending){
   if(!Array.isArray(candidates)||seen<3||candidates.length<2)
    return candidates;
   const strength=Math.min(.7,.12+seen*.025);
   return [...candidates].sort((a,b)=>{
    const priorA=Number.isFinite(a._combinedScore)?a._combinedScore:a.score||0;
    const priorB=Number.isFinite(b._combinedScore)?b._combinedScore:b.score||0;
    return (priorB+strength*predict(b,pending))-
           (priorA+strength*predict(a,pending));
   });
  }
  function learn(accepted,alternatives,pending){
   if(!accepted||!Array.isArray(alternatives)||!alternatives.includes(accepted))
    return false;
   const negatives=alternatives.filter(c=>c!==accepted).slice(0,5);
   const positive=features(accepted,pending),lr=.045;
   if(!negatives.length){
    // A single accepted suggestion is still human feedback. Teach a weak
    // positive reward for its real GRU trajectory without inventing a
    // rejected glyph or pretending this is a pairwise preference.
    const a=evaluate(positive),g=.35/(1+Math.exp(bound(a.score,-12,12)));
    const old=w2.slice();
    for(let j=0;j<HIDDEN;j++){
     w2[j]=bound(w2[j]+lr*g*a.hidden[j],-2,2);
     const effect=lr*g*old[j]*(1-a.hidden[j]*a.hidden[j]);
     for(let i=0;i<INPUT;i++)w1[j*INPUT+i]=bound(
      w1[j*INPUT+i]+effect*positive[i],-1,1);
    }
   }
   for(const rejected of negatives){
    const negative=features(rejected,pending),a=evaluate(positive),b=evaluate(negative);
    const diff=bound(a.score-b.score,-12,12);
    const grad=1/(1+Math.exp(diff));
    const old=w2.slice();
    for(let j=0;j<HIDDEN;j++){
     const d=grad*(a.hidden[j]-b.hidden[j]);
     w2[j]=bound(w2[j]+lr*d,-2,2);
     const gateP=grad*old[j]*(1-a.hidden[j]*a.hidden[j]);
     const gateN=grad*old[j]*(1-b.hidden[j]*b.hidden[j]);
     for(let i=0;i<INPUT;i++){
      const k=j*INPUT+i;
      w1[k]=bound(w1[k]+lr*(gateP*positive[i]-gateN*negative[i]),-1,1);
     }
    }
   }
   seen=Math.min(100000,seen+1);
   persist();return true;
  }
  function reset(){
   w1=Array.from({length:INPUT*HIDDEN},(_,i)=>
    Math.sin((i+1)*.89)*.065);
   b1=Array(HIDDEN).fill(0);w2=Array(HIDDEN).fill(0);seen=0;
   try{storage?.removeItem(KEY)}catch(_){}
  }
  load();
  return {features,predict,rank,learn,reset,snapshot,restore,
   get examples(){return seen}};
 }
 root.InkPreferenceAI={create,features,version:VERSION};
})(typeof window!=="undefined"?window:self);
