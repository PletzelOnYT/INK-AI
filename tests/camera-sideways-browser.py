#!/usr/bin/env python3
"""Real Chrome offline OCR for sideways labels; normal print must stay fast.
All test frames are synthetic and remain inside the standalone HTML.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
opt=Options()
for a in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
          "--window-size=1400,900"):
    opt.add_argument(a)
d=webdriver.Chrome(options=opt)
try:
    d.set_script_timeout(150)
    d.get(Path("index.html").resolve().as_uri())
    d.execute_cdp_cmd("Network.enable",{})
    d.execute_cdp_cmd("Network.emulateNetworkConditions",{
      "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=d.execute_async_script("""
     const done=arguments[arguments.length-1];
     (async()=>{
      const engine=await window.InkOfflineOCR.create();
      const canvas=document.createElement("canvas");
      canvas.width=960;canvas.height=540;
      const ctx=canvas.getContext("2d"),cases=[];
      for(const angle of [0,90,-90,180]){
       ctx.fillStyle="#fff";ctx.fillRect(0,0,960,540);
       ctx.save();ctx.translate(480,270);ctx.rotate(angle*Math.PI/180);
       ctx.font="bold 72px Arial";ctx.fillStyle="#111";
       ctx.textAlign="center";ctx.textBaseline="middle";
       ctx.fillText("NY THREADS",0,0);
       ctx.restore();
       let match=null;
       for(let attempt=0;attempt<7;attempt++){
        const read=await engine.recognize(canvas,960,540);
        if(read.text.toUpperCase().includes("THREADS")){
         match={text:read.text,angle,detected:read.quarterTurn,
           words:read.words,ms:read.elapsedMs,attempt:attempt+1};break;
        }
       }
       cases.push(match||{angle,error:"No THREADS within seven scans"});
      }
      done({ok:true,cases});
     })().catch(error=>done({ok:false,error:String(error.stack||error)}))
    """)
    assert result.get("ok"),result.get("error")
    for entry in result["cases"]:
        print("SIDEWAYS OCR",{
            k:v for k,v in entry.items() if k!="words"},flush=True)
        assert "THREADS" in entry.get("text","").upper(),entry
        assert entry.get("words"),entry
        for word in entry["words"]:
            b=word["box"]
            assert b["x0"]>=-2 and b["y0"]>=-2,word
            assert b["x1"]<=962 and b["y1"]<=542,word
        if entry["angle"]:
            assert entry["detected"]!=0,entry
        else:
            assert entry["detected"]==0,entry
    print("PASS: offline OCR reads upright and 90/180-degree sideways text with mapped boxes")
finally:
    d.quit()
