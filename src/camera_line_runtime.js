"use strict";
/* INK AI native CNN-BiGRU-CTC line recognizer.
 * The browser worker runs ONLY repository-trained weights. No online OCR.
 */
(()=>{
function workerMain(){
 "use strict";
 let layers=null,rnn=null,out=null,labels=null;
 function decodeMatrix(value){
  const raw=atob(value.weights);
  const weights=new Float32Array(raw.length);
  for(let i=0;i<raw.length;i++){
   const b=raw.charCodeAt(i);
   weights[i]=(b>127?b-256:b)*value.scale;
  }
  return {shape:value.shape,w:weights};
 }
 function convolution(input,layer,h,w,sy,sx){
  const sh=layer.weight.shape,outputs=sh[0],inputs=sh[1];
  const kernel=sh[2],oh=Math.ceil(h/sy),ow=Math.ceil(w/sx);
  const result=new Float32Array(outputs*oh*ow);
  const weights=layer.weight.w,bias=layer.bias,pad=(kernel-1)/2;
  for(let oc=0;oc<outputs;oc++)
   for(let yy=0;yy<oh;yy++)
    for(let xx=0;xx<ow;xx++){
     let sum=bias[oc];
     const iy=yy*sy,ix=xx*sx;
     for(let ic=0;ic<inputs;ic++)
      for(let ky=0;ky<kernel;ky++){
       const py=iy+ky-pad;
       if(py<0||py>=h)continue;
       for(let kx=0;kx<kernel;kx++){
        const px=ix+kx-pad;
        if(px<0||px>=w)continue;
        sum+=weights[((oc*inputs+ic)*kernel+ky)*kernel+kx]*
             input[(ic*h+py)*w+px];
       }
      }
     result[(oc*oh+yy)*ow+xx]=Math.max(0,sum);
    }
  return result;
 }
 function sigmoid(value){
  return 1/(1+Math.exp(-Math.max(-25,Math.min(25,value))));
 }
 function gruDirection(sequence,reverse){
  const prefix=reverse?"_reverse":"";
  const wi=rnn["weight_ih_l0"+prefix].w;
  const wh=rnn["weight_hh_l0"+prefix].w;
  const bi=rnn["bias_ih_l0"+prefix].w;
  const bh=rnn["bias_hh_l0"+prefix].w;
  const hidden=new Float32Array(64),result=new Array(64);
  for(let step=0;step<64;step++){
   const t=reverse?63-step:step;
   const x=sequence[t],gi=new Float32Array(192),gh=new Float32Array(192);
   for(let gate=0;gate<192;gate++){
    let v1=bi[gate],v2=bh[gate],o=gate*64;
    for(let j=0;j<64;j++){
     v1+=wi[o+j]*x[j];
     v2+=wh[o+j]*hidden[j];
    }
    gi[gate]=v1;gh[gate]=v2;
   }
   const next=new Float32Array(64);
   for(let j=0;j<64;j++){
    const reset=sigmoid(gi[j]+gh[j]);
    const update=sigmoid(gi[64+j]+gh[64+j]);
    const candidate=Math.tanh(gi[128+j]+reset*gh[128+j]);
    next[j]=(1-update)*candidate+update*hidden[j];
   }
   hidden.set(next);result[t]=next;
  }
  return result;
 }
 function recognize(image){
  if(!layers)throw Error("Native text-line model is not initialized");
  let x=Float32Array.from(image);
  x=convolution(x,layers[0],32,256,2,2);
  x=convolution(x,layers[1],16,128,2,2);
  x=convolution(x,layers[2],8,64,2,1);
  x=convolution(x,layers[3],4,64,2,1);
  const sequence=Array.from({length:64},(_,t)=>{
   const features=new Float32Array(64);
   for(let c=0;c<64;c++)
    features[c]=(x[(c*2)*64+t]+x[(c*2+1)*64+t])/2;
   return features;
  });
  const forward=gruDirection(sequence,false);
  const backward=gruDirection(sequence,true);
  const classes=labels.length,predictions=[];
  const W=out.weight.w,b=out.bias;
  for(let t=0;t<64;t++){
   let index=0,best=-Infinity,runner=-Infinity;
   const logits=new Float32Array(classes);
   for(let c=0;c<classes;c++){
    let value=b[c],start=c*128;
    for(let j=0;j<64;j++)
     value+=W[start+j]*forward[t][j]+W[start+64+j]*backward[t][j];
    logits[c]=value;
    if(value>best){runner=best;best=value;index=c}
    else if(value>runner)runner=value;
   }
   let denominator=0;
   for(const v of logits)denominator+=Math.exp(v-best);
   const confidence=1/denominator;
   predictions.push({index,confidence});
  }
  let last=0,words="",logp=0,count=0;
  for(const token of predictions){
   if(token.index!==last&&token.index!==0){
    words+=labels[token.index];
    logp+=Math.log(Math.max(.00001,token.confidence));
    count++;
   }
   last=token.index;
  }
  const text=words.trim().replace(/\s+/g," ");
  return {text,confidence:count?Math.exp(logp/count):0,
    characters:count,steps:64};
 }
 onmessage=e=>{
  const {id,type}=e.data;
  try{
   if(type==="init"){
    const model=e.data.model;
    if(model.format!=="ink-line-ctc-v1"||
       model.input?.[1]!==32||model.input?.[2]!==256||
       model.convolutions?.length!==4||!Array.isArray(model.labels))
      throw Error("Wrong native line model");
    layers=model.convolutions.map(l=>({
     weight:decodeMatrix(l.weight),bias:Float32Array.from(l.bias)
    }));
    rnn={};
    for(const [k,v] of Object.entries(model.rnn))rnn[k]=decodeMatrix(v);
    out={weight:decodeMatrix(model.out.weight),
      bias:Float32Array.from(model.out.bias)};
    labels=model.labels;
    postMessage({id,result:{ready:true,labels:labels.length}});
   }else if(type==="read"){
    postMessage({id,result:e.data.images.map(recognize)});
   }else throw Error("Unknown line OCR operation");
  }catch(error){postMessage({id,error:String(error?.message||error)})}
 };
}
async function create(model){
 const source="("+workerMain.toString()+")();";
 const url=URL.createObjectURL(new Blob([source],{type:"text/javascript"}));
 const worker=new Worker(url);URL.revokeObjectURL(url);
 let id=0;
 const pending=new Map();
 worker.onmessage=e=>{
  const {id,result,error}=e.data;
  const item=pending.get(id);if(!item)return;
  pending.delete(id);
  if(error)item.reject(Error(error));else item.resolve(result);
 };
 worker.onerror=e=>{
  for(const task of pending.values())task.reject(Error("Line OCR worker crashed"));
  pending.clear();
 };
 const request=(type,data={})=>new Promise((resolve,reject)=>{
  const number=++id;
  pending.set(number,{resolve,reject});
  worker.postMessage({id:number,type,...data});
 });
 try{await request("init",{model})}
 catch(e){worker.terminate();throw e}
 return {
  read:images=>request("read",{images}),
  terminate:()=>{worker.terminate();for(const task of pending.values())
   task.reject(Error("Line OCR stopped"));pending.clear()}
 };
}
window.InkLineRuntime={create};
})();
