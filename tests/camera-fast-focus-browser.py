#!/usr/bin/env python3
"""Measure bounded OCR latency and validate distant native-focus in offline Chrome."""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,900"):
    options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
    driver.set_script_timeout(190)
    driver.get(Path("index.html").resolve().as_uri())
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.emulateNetworkConditions",{
      "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        if(!window.InkCameraMotion?.create)
          throw Error("Fast frame tracker is missing from downloaded HTML");
        const video=document.createElement("canvas");
        video.width=1920;video.height=1080;
        Object.defineProperty(video,"videoWidth",{value:1920});
        Object.defineProperty(video,"videoHeight",{value:1080});
        const g=video.getContext("2d");
        g.fillStyle="#eeeee9";g.fillRect(0,0,1920,1080);
        g.fillStyle="#fff";g.fillRect(1380,145,480,225);
        g.fillStyle="#222";g.font="bold 26px Arial";
        g.fillText("REMOTE LABEL 857",1435,242);
        g.font="bold 40px Arial";
        g.fillText("ROOM INFORMATION",220,520);
        const camera=await window.InkOfflineCamera.connect();
        const frames=[];
        for(let i=0;i<7;i++){
          const started=performance.now();
          const result=await camera.recognize(video);
          const stable=camera.track(result,Date.now()+i*320);
          frames.push({
           index:i+1,ms:Math.round(performance.now()-started),
           mode:window.__inkCameraDetailRecovery?.enhancement,
           width:window.__inkCameraDetailRecovery?.captureWidth,
           words:result.words.map(w=>({
             text:w.text,x:Math.round(w.box.x0),y:Math.round(w.box.y0)})),
           transcript:stable.text
          });
        }
        camera.reset();
        done({ok:true,frames});
      })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert result.get("ok"),result.get("error")
    frames=result["frames"]
    for f in frames:
        print("CAMERA SPEED",{
          "index":f["index"],"ms":f["ms"],"mode":f["mode"],
          "capture_width":f["width"],"words":f["words"][:16]
        },flush=True)
    assert all(f["width"]<=1280 for f in frames)
    assert sum("native-focus" in (f["mode"] or "") for f in frames)>=4
    native_words=[w for frame in frames
      if "native-focus" in (frame["mode"] or "")
      for w in frame["words"] if w["x"]>1250 and w["y"]<390]
    assert any("REMOTE" in word["text"].upper() for word in native_words),(
      "Native-resolution OCR did not recover distant off-center label: "+
      repr(frames))
    assert max(f["ms"] for f in frames)<11000, (
      "Single OCR pass took unacceptably long")
    print("PASS: far-away label read from native camera pixels with bounded per-pass OCR size",flush=True)
finally:
    driver.quit()
