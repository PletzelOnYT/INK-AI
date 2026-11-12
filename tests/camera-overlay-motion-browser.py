#!/usr/bin/env python3
"""Regression: bottle-label highlight must follow actual captured pixels.

Use a synthetic bottle in a local Chrome webcam stream. OCR text/boxes are
controlled so this test isolates image -> crop -> tracker -> overlay geometry.
Never insert the user's personal screenshot into a public repository.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts=Options()
for arg in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
            "--autoplay-policy=no-user-gesture-required",
            "--window-size=1400,900"):
    opts.add_argument(arg)
driver=webdriver.Chrome(options=opts)
try:
    driver.set_script_timeout(110)
    driver.get(Path("index.html").resolve().as_uri())
    answer=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const feed=document.createElement("canvas");
        feed.width=960;feed.height=540;
        const g=feed.getContext("2d");
        const fixture={x:70,y:85,phase:"old",exposure:0};
        const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
        function draw(){
          g.filter=fixture.exposure?"brightness(1.12)":"none";
          g.fillStyle="#d6d0c1";g.fillRect(0,0,960,540);
          g.fillStyle="#286331";g.fillRect(fixture.x,fixture.y,255,275);
          g.fillStyle="#e9e7db";
          g.fillRect(fixture.x+12,fixture.y+32,231,135);
          g.fillStyle="#145c88";g.font="bold 29px Arial";
          g.fillText("PELLEGRINO",fixture.x+23,fixture.y+91);
          g.filter="none";
        }
        draw();
        const loop=setInterval(draw,50);
        const word=()=>({
          text:"PELLEGRINO",confidence:.98,
          box:{x0:fixture.x+21,y0:fixture.y+60,
               x1:fixture.x+226,y1:fixture.y+103}});
        window.InkOfflineOCR={create:async()=>({
          recognize:async(canvas,width,height)=>{
            if(fixture.phase==="blank")return {width,height,lines:[],words:[]};
            const w=word();
            return {width,height,lines:[{
              text:w.text,confidence:.98,box:w.box,words:[w]
            }],words:[w],elapsedMs:12};
          }
        })};
        // This test targets coordinate correctness, not OCR confidence;
        // separate tests exercise the actual visual-evidence thresholds.
        window.InkTextEvidence.evidence=()=>({
          ok:true,score:.97,contrast:200,
          edgeRate:.3,verticalStrokeRate:.2,bands:6});
        navigator.mediaDevices.getUserMedia=async()=>feed.captureStream(18);
        const started=performance.now();
        document.getElementById("camera").click();
        async function until(check,ms=8500){
          const start=performance.now();
          while(performance.now()-start<ms){
            const value=check();if(value)return value;
            await sleep(75);
          }
          throw Error("Timed out: "+String(check).slice(0,120));
        }
        await until(()=>window.__inkCameraActive&&
           window.__inkCameraOverlayStats?.visibleBoxes>0);
        function overlayStats(x,y){
          const b=document.querySelector(".board");
          const o=document.getElementById("cameraHighlights");
          const fit=Math.min(b.clientWidth/960,b.clientHeight/540);
          const offsetX=(b.clientWidth-960*fit)/2;
          const offsetY=(b.clientHeight-540*fit)/2;
          const box={x0:x+21,y0:y+60,x1:x+226,y1:y+103};
          const px=o.getContext("2d").getImageData(0,0,o.width,o.height).data;
          const ratio=o.width/b.clientWidth;
          const left=Math.max(0,Math.floor((offsetX+box.x0*fit)*ratio));
          const right=Math.min(o.width,Math.ceil((offsetX+box.x1*fit)*ratio));
          const top=Math.max(0,Math.floor((offsetY+box.y0*fit)*ratio));
          const bottom=Math.min(o.height,Math.ceil((offsetY+box.y1*fit)*ratio));
          let marked=0;
          for(let row=top;row<bottom;row+=3)
           for(let col=left;col<right;col+=3)
            if(px[(row*o.width+col)*4+3]>0)marked++;
          return {marked,sourceBox:box,offsetX,offsetY,
                  fit,overlayWidth:o.width,boardWidth:b.clientWidth};
        }
        const initially=overlayStats(70,85);
        if(initially.marked<12)
          throw Error("Original text box was not on the bottle: "+
            JSON.stringify(initially));
        // Exposure fluctuations must not make valid white boxes disappear.
        fixture.exposure=1;
        await sleep(430);
        const exposure=overlayStats(70,85);
        if(exposure.marked<12)
          throw Error("Camera auto-exposure incorrectly hid recognized white boxes: "+
            JSON.stringify(exposure));
        // Move bottle far away, but keep transcript text for clarity.
        // Old rectangles must be hidden, not painted on the arm/wall.
        fixture.phase="blank";fixture.x=575;fixture.y=190;
        await until(()=>window.__inkCameraOverlayStats?.visibleBoxes===0,3000);
        const afterMove=overlayStats(70,85);
        const transcriptAfterMove=window.__inkCameraText;
        if(afterMove.marked>3)throw Error("Ghost highlight on old wall: "+
           JSON.stringify(afterMove));
        if(!transcriptAfterMove.includes("PELLEGRINO"))
          throw Error("Text history should be separate from box persistence");
        fixture.phase="new";
        await until(()=>window.__inkCameraOverlayStats?.visibleBoxes>0,8500);
        const newPosition=overlayStats(575,190);
        const stale=overlayStats(70,85);
        document.getElementById("camera").click();
        clearInterval(loop);
        if(newPosition.marked<12)
          throw Error("New bottle label highlight missing: "+
           JSON.stringify(newPosition));
        if(stale.marked>3)
          throw Error("Old box remains after recognition at new position: "+
            JSON.stringify(stale));
        done({ok:true,initially,exposure,afterMove,newPosition,
          stale,elapsedMs:Math.round(performance.now()-started)});
      })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert answer.get("ok"),answer.get("error")
    print("PASS: camera overlay moves with real label pixels, never reanchors stale transcript boxes on new frames",answer,flush=True)
finally:
    driver.quit()
