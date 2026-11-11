"use strict";
(()=>{
const button=document.getElementById('camera'), board=document.querySelector('.board'), video=document.getElementById('cameraVideo'), output=document.getElementById('guess');
if(!button||!board||!video||!output)return;
let active=false,stream=null,worker=null,timer=0,reading=false,epoch=0,lastText='';
const canvas=document.createElement('canvas'),ctx=canvas.getContext('2d',{willReadFrequently:true});
window.__inkCameraActive=false;window.__inkCameraText='';
function show(t,muted=true){if(active){output.textContent=t;output.dataset.muted=String(muted)}}
function stop(){
active=false;epoch++;clearTimeout(timer);timer=0;
if(stream){stream.getTracks().forEach(t=>t.stop());stream=null}
video.pause();video.srcObject=null;board.classList.remove('camera-active');
button.setAttribute('aria-pressed','false');window.__inkCameraActive=false;
if(worker){const w=worker;worker=null;Promise.resolve(w.terminate()).catch(()=>{})}
output.textContent=window.__inkLastGuess||'Draw a letter';output.dataset.muted=String(!window.__inkLastGuess);
}
async function loadOCR(){
if(!window.Tesseract)await new Promise((resolve,reject)=>{
const tag=document.createElement('script');tag.src='https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
tag.onload=resolve;tag.onerror=()=>reject(Error('Could not load OCR. Connect to the internet and retry.'));document.head.append(tag)
});
return window.Tesseract.createWorker('eng',1);
}
async function scan(id){
if(!active||id!==epoch||reading||!worker)return;
if(video.readyState<2){timer=setTimeout(()=>scan(id),400);return}
reading=true;
try{
canvas.width=Math.min(1280,video.videoWidth);canvas.height=Math.max(1,Math.round(video.videoHeight*canvas.width/video.videoWidth));
ctx.drawImage(video,0,0,canvas.width,canvas.height);
const result=await worker.recognize(canvas);
if(!active||id!==epoch)return;
const words=String(result.data.text||'').split('\n').map(s=>s.trim().replace(/\s+/g,' ')).filter(Boolean).join('\n').slice(0,3000);
if(words&&result.data.confidence>=24){lastText=words;window.__inkCameraText=words;show(words,false)}
else if(!lastText)show('Point your camera at clear, well-lit text.');
}catch(e){if(active&&id===epoch)show('Reading failed. Try moving closer or improving the lighting.')}
finally{reading=false;if(active&&id===epoch)timer=setTimeout(()=>scan(id),1100)}
}
async function start(){
if(active)return;active=true;const id=++epoch;lastText='';window.__inkCameraText='';
window.__inkCameraActive=true;board.classList.add('camera-active');button.setAttribute('aria-pressed','true');show('Requesting camera access…');
try{
if(!navigator.mediaDevices?.getUserMedia)throw Error('Camera access needs HTTPS, localhost, or a compatible local-file browser.');
const s=await navigator.mediaDevices.getUserMedia({audio:false,video:{facingMode:{ideal:'environment'},width:{ideal:1280}}});
if(!active||id!==epoch){s.getTracks().forEach(t=>t.stop());return}
stream=s;video.srcObject=s;await video.play();show('Loading text recognition…');
const w=await loadOCR();if(!active||id!==epoch){await w.terminate();return}worker=w;
show('Point your camera at clear, well-lit text.');scan(id);
}catch(e){
if(active&&id===epoch){const reason=e.name==='NotAllowedError'?'Camera permission denied. Allow camera access and retry.':e.name==='NotFoundError'?'No camera found.':String(e.message||e);stop();output.textContent=reason;output.dataset.muted='true'}
}
}
button.addEventListener('click',()=>active?stop():start());
window.addEventListener('pagehide',()=>{if(active)stop()});
document.addEventListener('visibilitychange',()=>{if(document.hidden&&active)stop()});
})();