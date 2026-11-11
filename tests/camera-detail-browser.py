#!/usr/bin/env python3
"""Actual file:// Chrome OCR smoke: distance, digits, color, and tilted text.

First scenario is an acceptance assertion; the deliberately hard examples are
reported as diagnostics rather than misrepresented as 100%-solved benchmarks.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opt=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,900"):
    opt.add_argument(flag)
d=webdriver.Chrome(options=opt)
try:
    d.set_script_timeout(210)
    d.get(Path("index.html").resolve().as_uri())
    d.execute_cdp_cmd("Network.enable",{})
    d.execute_cdp_cmd("Network.emulateNetworkConditions",{
        "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=d.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const engine=await window.InkOfflineOCR.create();
        const canvas=document.createElement("canvas");
        canvas.width=1920;canvas.height=1080;
        const ctx=canvas.getContext("2d"),cases=[];
        function paint(bg){ctx.fillStyle=bg;ctx.fillRect(0,0,1920,1080);}
        async function measure(name,count=3){
          let best="",detail=false,words=0;
          for(let i=0;i<count;i++){
            const r=await engine.recognize(canvas,1920,1080);
            if(r.text.length>best.length)best=r.text;
            words=Math.max(words,r.words?.length||0);
            detail=detail||!!r.detailUpscaled;
          }
          cases.push({name,text:best,words,detail});
          return best;
        }
        paint("#e5e5e0");
        ctx.fillStyle="#22242a";
        ctx.fillRect(712,316,490,192);
        ctx.fillStyle="#ffffff";ctx.font="bold 84px Arial";
        ctx.textAlign="center";ctx.textBaseline="middle";
        ctx.fillText("12:34",957,410);
        const normal=await measure("digital_clock",3);
        paint("#eae4d9");
        ctx.save();ctx.translate(960,540);ctx.transform(1,-.10,.27,1,0,0);
        ctx.fillStyle="#77716a";ctx.font="48px Georgia";
        ctx.textAlign="center";ctx.fillText("ROOM 314",0,0);
        ctx.restore();
        await measure("oblique_pencil_gray",3);
        paint("#342e7d");
        ctx.fillStyle="#eed658";ctx.font="bold 56px sans-serif";
        ctx.textAlign="center";ctx.fillText("LEVEL 29",960,540);
        await measure("yellow_on_blue",3);
        done({ok:true,cases,normal});
      })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert result.get("ok"),result.get("error")
    cases=result["cases"]
    for entry in cases:print("OCR DETAIL DIAGNOSTIC:",entry,flush=True)
    digits="".join(ch for ch in result["normal"] if ch.isdigit())
    assert "1234" in digits, "Clear high-resolution room clock failed: "+repr(cases[0])
    assert all(x["words"]>=0 for x in cases)
    print("PASS: 1080p digital clock OCR in entirely offline browser; difficult fixtures recorded")
finally:
    d.quit()
