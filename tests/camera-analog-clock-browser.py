#!/usr/bin/env python3
"""Real offline Chrome analog-clock recognition, not just circle geometry."""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,900"):opts.add_argument(flag)
d=webdriver.Chrome(options=opts)
try:
    d.set_script_timeout(240)
    d.get(Path("index.html").resolve().as_uri())
    d.execute_cdp_cmd("Network.enable",{})
    d.execute_cdp_cmd("Network.emulateNetworkConditions",{
       "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    data=d.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const frame=document.createElement("canvas");
        frame.width=1920;frame.height=1080;
        Object.defineProperty(frame,"videoWidth",{value:1920});
        Object.defineProperty(frame,"videoHeight",{value:1080});
        const g=frame.getContext("2d"),cx=850,cy=348,r=105;
        g.fillStyle="#d8d1bc";g.fillRect(0,0,1920,1080);
        g.fillStyle="#f4f0e4";g.fillRect(210,180,1380,810);
        g.beginPath();g.arc(cx,cy,r,0,Math.PI*2);
        g.fillStyle="#765641";g.fill();
        g.beginPath();g.arc(cx,cy,r-9,0,Math.PI*2);
        g.fillStyle="#f7f6f0";g.fill();
        g.font="bold 22px Arial";g.fillStyle="#292a29";
        g.textAlign="center";g.textBaseline="middle";
        for(let n=1;n<=12;n++){
          const theta=(n*30-90)*Math.PI/180;
          g.fillText(String(n),cx+Math.cos(theta)*r*.75,
             cy+Math.sin(theta)*r*.75);
        }
        g.strokeStyle="#393a3a";g.lineWidth=4;
        g.beginPath();g.moveTo(cx,cy);g.lineTo(cx-37,cy-53);g.stroke();
        g.lineWidth=2;
        g.beginPath();g.moveTo(cx,cy);g.lineTo(cx-63,cy-65);g.stroke();
        const api=await window.InkOfflineCamera.connect(),frames=[];
        for(let n=0;n<23;n++){
          const start=performance.now();
          const result=await api.recognize(frame);
          const stable=api.track(result,Date.now()+n*240);
          frames.push({scan:n+1,
            ms:Math.round(performance.now()-start),
            zone:window.__inkCameraDetailRecovery?.zone,
            words:result.words.map(w=>w.text),
            text:stable.text});
        }
        api.reset();
        done({ok:true,frames,error:window.__inkClockOCRLastError||null});
      })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert data.get("ok"),data.get("error")
    frames=data["frames"]
    print("ANALOG CLOCK OCR",{
      "error":data["error"],
      "observations":[{
        "scan":f["scan"],"zone":f["zone"],"ms":f["ms"],
        "words":f["words"][:18]} for f in frames]
    },flush=True)
    digits=set()
    for frame in frames:
        for word in frame["words"]:
            if word.isdigit() and 1<=int(word)<=12:
                digits.add(word)
    assert len(digits)>=3, (
      "Clock reader must produce actual verified numeral pixels, not just a rim: "+
      repr({"digits":sorted(digits),"error":data["error"]}))
    print("PASS: analog clock produces OCR-verified dial numerals in a fully offline Chrome camera",flush=True)
finally:
    d.quit()
