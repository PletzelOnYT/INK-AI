#!/usr/bin/env python3
"""Offline Chrome: colorful code printing and poster heading visibility.

Synthetic canvas text represents user-reported use cases, not user photos.
The goal is to check meaningful recognition and transcript persistence after
the engine alternates between native central/corner focus regions.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,900"):
    opts.add_argument(flag)
d=webdriver.Chrome(options=opts)
try:
    d.set_script_timeout(210)
    d.get(Path("index.html").resolve().as_uri())
    d.execute_cdp_cmd("Network.enable",{})
    d.execute_cdp_cmd("Network.emulateNetworkConditions",{
       "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=d.execute_async_script("""
    const done=arguments[arguments.length-1];
    (async()=>{
      const img=document.createElement("canvas");
      img.width=1920;img.height=1080;
      Object.defineProperty(img,"videoWidth",{value:1920});
      Object.defineProperty(img,"videoHeight",{value:1080});
      const c=img.getContext("2d");
      const draw=(text,x,y,font,color)=>{
       c.font=font;c.fillStyle=color;c.fillText(text,x,y);
      };
      async function sweep(name){
       const reader=await window.InkOfflineCamera.connect();
       const items=[];
       for(let i=0;i<11;i++){
        const started=performance.now();
        const value=await reader.recognize(img);
        const stable=reader.track(value,Date.now()+i*250);
        items.push({step:i+1,ms:Math.round(performance.now()-started),
         mode:window.__inkCameraDetailRecovery?.enhancement,
         words:value.words.map(w=>w.text),
         transcript:stable.text});
       }
       reader.reset();
       return {name,items};
      }
      c.fillStyle="#e8e4d8";c.fillRect(0,0,1920,1080);
      c.fillStyle="#21242a";c.fillRect(370,200,1110,760);
      draw("var",660,494,"bold 51px monospace","#42c7a0");
      draw("middleFinger",792,494,"bold 51px monospace","#a7dcfa");
      draw("=",1220,494,"bold 51px monospace","#ffffff");
      draw("hand.fingers[2];",652,574,
       "bold 53px monospace","#91d8f0");
      draw("extend",652,656,"bold 56px monospace","#e6df5d");
      draw("(middleFinger);",855,656,"bold 56px monospace","#9acde9");
      const shirt=await sweep("colored-code-shirt");
      c.fillStyle="#e4e3d9";c.fillRect(0,0,1920,1080);
      c.fillStyle="#fdfcf9";c.fillRect(540,140,840,840);
      c.fillStyle="#315982";c.fillRect(605,205,700,350);
      c.fillStyle="#67a4c5";c.fillRect(605,555,700,360);
      draw("Notre Dame Academy",665,296,
       "bold 51px Georgia","#eaf2f4");
      draw("One Family Always United",700,337,
       "bold 26px Georgia","#e8e6dc");
      draw("Open House",735,445,"bold 82px Arial","#ffffff");
      draw("For Prospective Families",681,495,
       "30px Arial","#f6f6ed");
      draw("OCTOBER 21ST",695,690,
       "bold 43px Arial","#d6e7f0");
      draw("Register to attend",889,801,
       "bold 29px Arial","#ffffff");
      const poster=await sweep("blue-and-white-flyer");
      done({ok:true,shirt,poster});
    })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert result.get("ok"),result.get("error")
    for case in (result["shirt"],result["poster"]):
        print("COLOR MULTILINE OCR",{
            "case":case["name"],
            "frames":[{
                "step":x["step"],"ms":x["ms"],"mode":x["mode"],
                "text":x["transcript"][:210]} for x in case["items"]]
        },flush=True)
    shirt="\n".join(x["transcript"].lower() for x in result["shirt"]["items"])
    assert "middlefinger" in shirt, "Code identifier not recognized"
    assert "extend" in shirt or "fingers" in shirt, (
        "Camera found only one word instead of neighboring code lines: "+repr(shirt))
    flyer="\n".join(x["transcript"].lower() for x in result["poster"]["items"])
    assert "open house" in flyer, "Large poster headline was missed"
    assert "notre" in flyer and "academy" in flyer,(
       "Poster title above the main headline was missed: "+repr(flyer))
    assert all(x["ms"]<11000 for case in (result["shirt"],result["poster"])
       for x in case["items"]),"An OCR pass stalled excessively"
    print("PASS: colored printed code and blue-white poster headings remain readable across rotating native-focus scans",flush=True)
finally:
    d.quit()
