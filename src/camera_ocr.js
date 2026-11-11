"use strict";
(() => {
  const button=document.getElementById("camera");
  const board=document.querySelector(".board");
  const video=document.getElementById("cameraVideo");
  const overlay=document.getElementById("cameraHighlights");
  const output=document.getElementById("guess");
  if(!button||!board||!video||!overlay||!output)return;

  const highlight=overlay.getContext("2d");
  const capture=document.createElement("canvas");
  const ctx=capture.getContext("2d",{willReadFrequently:true});
  const MIN_CONFIDENCE=67;
  const SINGLE_CHARACTER_CONFIDENCE=88;
  const CONFIRM_FRAMES=2;
  let active=false,stream=null,worker=null,timer=0,reading=false,generation=0;
  let candidates=[],misses=0,loadingPromise=null;
  window.__inkCameraActive=false;
  window.__inkCameraText="";
  window.__inkCameraWords=[];

  function show(message,muted=true){
    if(!active)return;
    output.textContent=message;
    output.dataset.muted=String(muted);
  }
  function clearOverlay(){
    highlight.clearRect(0,0,overlay.width,overlay.height);
  }
  function stop(){
    active=false;generation++;
    clearTimeout(timer);timer=0;
    if(stream)stream.getTracks().forEach(track=>track.stop());
    stream=null;video.pause();video.srcObject=null;
    board.classList.remove("camera-active");
    button.setAttribute("aria-pressed","false");
    window.__inkCameraActive=false;
    window.__inkCameraWords=[];
    window.__inkCameraText="";
    candidates=[];misses=0;clearOverlay();
    // A worker already loading is terminated when its promise resolves.
    if(worker){const old=worker;worker=null;Promise.resolve(old.terminate()).catch(()=>{});}
    output.textContent=window.__inkLastGuess||"Draw a letter";
    output.dataset.muted=String(!window.__inkLastGuess);
  }
  function validBox(box,width,height){
    if(!box)return null;
    const x0=Number(box.x0),y0=Number(box.y0),x1=Number(box.x1),y1=Number(box.y1);
    if(![x0,y0,x1,y1].every(Number.isFinite))return null;
    const w=x1-x0,h=y1-y0;
    if(w<3||h<7||w>width*.98||h>height*.6)return null;
    if(x0<0||y0<0||x1>width+1||y1>height+1)return null;
    return {x0,y0,x1,y1};
  }
  function readWords(result){
    const source=Array.isArray(result?.data?.words)?result.data.words:[];
    const found=[];
    for(const item of source){
      const text=String(item.text||"").trim();
      const confidence=Number(item.confidence);
      const box=validBox(item.bbox,capture.width,capture.height);
      if(!box||!Number.isFinite(confidence)||confidence<MIN_CONFIDENCE)continue;
      if(!/[A-Za-z0-9]/.test(text)||text.length>38)continue;
      // Strong evidence is required for a lone letter: reflections and objects
      // commonly look like an isolated I, O, 1 or l.
      if(text.replace(/[^A-Za-z0-9]/g,"").length<=1&&confidence<SINGLE_CHARACTER_CONFIDENCE)continue;
      if(!/^[A-Za-z0-9][A-Za-z0-9'’.,:;!?()/-]*$/.test(text))continue;
      const letters=text.replace(/[^A-Za-z0-9]/g,"");
      if(letters.length===2&&confidence<77)continue;
      found.push({text,confidence,box});
    }
    return found;
  }
  function sameWord(a,b){
    if(a.text.toLowerCase()!==b.text.toLowerCase())return false;
    const acx=(a.box.x0+a.box.x1)/2,acy=(a.box.y0+a.box.y1)/2;
    const bcx=(b.box.x0+b.box.x1)/2,bcy=(b.box.y0+b.box.y1)/2;
    const aw=a.box.x1-a.box.x0,ah=a.box.y1-a.box.y0;
    return Math.abs(acx-bcx)<Math.max(28,aw*.55)&&
           Math.abs(acy-bcy)<Math.max(22,ah*.85);
  }
  function reconcile(fresh){
    const next=[];
    for(const item of fresh){
      const match=candidates.find(previous=>sameWord(previous,item));
      next.push({...item,hits:match?Math.min(6,match.hits+1):1});
    }
    candidates=next;
    return next.filter(word=>word.hits>=CONFIRM_FRAMES);
  }
  function buildText(words){
    const sorted=[...words].sort((a,b)=>(a.box.y0+a.box.y1-b.box.y0-b.box.y1)/2||
          a.box.x0-b.box.x0);
    const lines=[];
    for(const word of sorted){
      const cy=(word.box.y0+word.box.y1)/2;
      const h=word.box.y1-word.box.y0;
      let line=lines.find(row=>Math.abs(row.cy-cy)<Math.max(10,(row.height+h)*.4));
      if(!line){line={cy,height:h,words:[]};lines.push(line)}
      line.words.push(word);
    }
    return lines.sort((a,b)=>a.cy-b.cy).map(line=>line.words.sort((a,b)=>a.box.x0-b.box.x0)
      .map(word=>word.text).join(" ")).join("\n").slice(0,3000);
  }
  function paint(words){
    // Bounding boxes are measured in captured-video pixels. The camera uses
    // object-fit:contain, so compensate for the black letterbox padding.
    const width=board.clientWidth,height=board.clientHeight;
    overlay.width=Math.max(1,Math.round(width*devicePixelRatio));
    overlay.height=Math.max(1,Math.round(height*devicePixelRatio));
    highlight.setTransform(devicePixelRatio,0,0,devicePixelRatio,0,0);
    clearOverlay();
    if(!words.length||!video.videoWidth||!video.videoHeight)return;
    const scale=Math.min(width/video.videoWidth,height/video.videoHeight);
    const offsetX=(width-video.videoWidth*scale)/2;
    const offsetY=(height-video.videoHeight*scale)/2;
    const sx=video.videoWidth/capture.width;
    const sy=video.videoHeight/capture.height;
    highlight.fillStyle="rgba(255,255,255,0.28)";
    highlight.strokeStyle="rgba(255,255,255,0.88)";
    highlight.lineWidth=1.25;
    for(const {box} of words){
      const x=offsetX+box.x0*sx*scale,y=offsetY+box.y0*sy*scale;
      const w=(box.x1-box.x0)*sx*scale,h=(box.y1-box.y0)*sy*scale;
      const pad=Math.min(5,Math.max(2,h*.10));
      highlight.beginPath();
      highlight.roundRect(x-pad,y-pad,w+pad*2,h+pad*2,Math.min(4,h*.2));
      highlight.fill();
      highlight.stroke();
    }
  }
  async function loadOCR(){
    if(!window.Tesseract){
      await new Promise((resolve,reject)=>{
        const tag=document.createElement("script");
        tag.src="https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js";
        tag.onload=resolve;
        tag.onerror=()=>reject(Error("OCR couldn't load. Connect to the internet and retry."));
        document.head.append(tag);
      });
    }
    const instance=await window.Tesseract.createWorker("eng",1);
    // Sparse text helps find multiple labels/words anywhere in the frame.
    await instance.setParameters({tessedit_pageseg_mode:"11",preserve_interword_spaces:"1"});
    return instance;
  }
  function schedule(id,delay=650){
    clearTimeout(timer);
    if(active&&generation===id)timer=setTimeout(()=>scan(id),delay);
  }
  async function scan(id){
    if(!active||generation!==id||reading||!worker)return;
    if(video.readyState<2||!video.videoWidth){schedule(id,400);return;}
    reading=true;
    try{
      capture.width=Math.min(1600,video.videoWidth);
      capture.height=Math.max(1,Math.round(capture.width*video.videoHeight/video.videoWidth));
      ctx.drawImage(video,0,0,capture.width,capture.height);
      // Tesseract v5 exposes word boxes when word output is requested.
      const result=await worker.recognize(capture,{}, {text:true,words:true});
      if(!active||generation!==id)return;
      const confirmed=reconcile(readWords(result));
      if(confirmed.length){
        misses=0;
        const text=buildText(confirmed);
        window.__inkCameraText=text;
        window.__inkCameraWords=confirmed;
        show(text,false);
        paint(confirmed);
      }else{
        if(++misses>=2){
          window.__inkCameraText="";
          window.__inkCameraWords=[];
          paint([]);
          show("Point your camera at clear, well-lit text.");
        }
      }
    }catch(error){
      if(active&&generation===id)show("Camera OCR encountered an error. Try improving lighting.");
    }finally{reading=false;schedule(id);}
  }
  async function start(){
    if(active)return;
    active=true;
    const id=++generation;
    candidates=[];misses=0;
    window.__inkCameraActive=true;window.__inkCameraText="";window.__inkCameraWords=[];
    board.classList.add("camera-active");
    button.setAttribute("aria-pressed","true");
    show("Requesting camera access…");
    try{
      if(!navigator.mediaDevices?.getUserMedia)
        throw Error("Camera access requires HTTPS or localhost (some browsers also permit local files).");
      const incoming=await navigator.mediaDevices.getUserMedia({
        audio:false,video:{facingMode:{ideal:"environment"},width:{ideal:1920},height:{ideal:1080}}
      });
      if(!active||id!==generation){incoming.getTracks().forEach(track=>track.stop());return;}
      stream=incoming;video.srcObject=stream;
      await video.play();
      show("Loading camera text recognition…");
      const incomingWorker=await loadOCR();
      if(!active||id!==generation){await incomingWorker.terminate();return;}
      worker=incomingWorker;
      show("Point your camera at clear, well-lit text.");
      schedule(id,100);
    }catch(error){
      if(!active||id!==generation)return;
      const reason=error.name==="NotAllowedError"?"Camera permission denied. Allow access and retry.":
        error.name==="NotFoundError"?"No webcam found.":
        String(error.message||"Unable to start camera.");
      stop();output.textContent=reason;output.dataset.muted="true";
    }
  }
  button.addEventListener("click",()=>active?stop():start());
  window.addEventListener("pagehide",()=>{if(active)stop()});
  document.addEventListener("visibilitychange",()=>{if(document.hidden&&active)stop()});
})();