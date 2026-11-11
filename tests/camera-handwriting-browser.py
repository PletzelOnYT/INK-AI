#!/usr/bin/env python3
"""Exercise the shipped handwriting CNN on a real local HTML file in offline Chrome.

This proves browser inference is connected. Text quality is diagnostic until
tested against independent handwritten photographs with ground-truth labels.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1366,900"):
    options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
    driver.set_script_timeout(150)
    driver.get(Path("index.html").resolve().as_uri())
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.emulateNetworkConditions",{
        "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        for(let i=0;i<80&&!window.__inkHandwritingReady;i++)
          await new Promise(resolve=>setTimeout(resolve,125));
        if(!window.__inkHandwritingReady)throw Error("Handwriting CNN not ready");
        if(!window.InkCameraHandwriting)
          throw Error("Camera handwriting pipeline missing from standalone");
        const canvas=document.createElement("canvas");
        canvas.width=960;canvas.height=540;
        const g=canvas.getContext("2d");
        const modelRead=window.__inkCameraRecognizeHandwriting;
        let modelCalls=0,modelGlyphs=0;
        window.__inkCameraRecognizeHandwriting=async images=>{
          modelCalls++;modelGlyphs+=images.length;
          return modelRead(images);
        };
        const results=[];
        for(const font of ["bold 56px sans-serif","italic 56px cursive"]){
          g.fillStyle="#f9f9f5";g.fillRect(0,0,960,540);
          g.font=font;g.fillStyle="#1a2430";
          g.fillText("handwriting example",125,260);
          const read=await window.InkCameraHandwriting.recognize(
            canvas,960,540);
          results.push({font,regions:read.regions||0,
            glyphs:read.glyphs||0,
            text:read.lines.map(line=>line.text).join(" ")});
        }
        g.fillStyle="#f9f9f5";g.fillRect(0,0,960,540);
        const blank=await window.InkCameraHandwriting.recognize(
          canvas,960,540);
        done({ok:true,modelCalls,modelGlyphs,results,
          blankLines:blank.lines.length,
          version:window.__inkRecognitionVersion});
      })().catch(error=>done({ok:false,error:String(error.stack||error)}));
    """)
    assert result.get("ok"),result.get("error")
    assert result["modelCalls"]>=1, result
    assert result["modelGlyphs"]>=3, result
    assert result["blankLines"]==0, result
    print("PASS: offline Chrome invokes shipped handwriting CNN on actual camera-style glyph pixels", flush=True)
    print("HANDWRITING_DIAGNOSTICS",result,flush=True)
finally:
    driver.quit()
