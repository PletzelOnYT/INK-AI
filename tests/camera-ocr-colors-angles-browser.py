#!/usr/bin/env python3
"""Additional real-Chrome OCR regression: contrast, modest tilt, and clutter.
All examples are generated in browser; no user image, network, or server.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1400,900"):
    opts.add_argument(flag)
browser=webdriver.Chrome(options=opts)
try:
    browser.set_script_timeout(125)
    browser.get(Path("index.html").resolve().as_uri())
    browser.execute_cdp_cmd("Network.enable",{})
    browser.execute_cdp_cmd("Network.emulateNetworkConditions",{
        "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0
    })
    outcomes=browser.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
       const engine=await window.InkOfflineOCR.create();
       const c=document.createElement("canvas");
       c.width=1120;c.height=340;
       const g=c.getContext("2d");
       const all=[];
       for(const cfg of [
        {name:"white-on-black",bg:"#0e0e0e",fg:"#ffffff",angle:0},
        {name:"dark-on-white-angle-12",bg:"#f9f9f9",fg:"#121212",angle:12},
        {name:"blue-on-yellow",bg:"#ffe6a0",fg:"#132e9e",angle:0}
       ]){
        g.fillStyle=cfg.bg;g.fillRect(0,0,c.width,c.height);
        g.save();g.translate(560,180);
        g.rotate(cfg.angle*Math.PI/180);
        g.font="bold 96px Arial";g.textAlign="center";
        g.fillStyle=cfg.fg;g.fillText("NY THREADS",0,25);g.restore();
        const o=await engine.recognize(c,c.width,c.height);
        all.push({name:cfg.name,text:o.text,words:o.words.length,ms:o.elapsedMs});
       }
       // No text: straight cabinet lines and box edges alone must not
       // create high-confidence whole words.
       g.fillStyle="#e0ddd7";g.fillRect(0,0,c.width,c.height);
       g.strokeStyle="#999999";g.lineWidth=5;
       for(let x=100;x<1020;x+=125){
        g.strokeRect(x,20,80,280);
        g.beginPath();g.moveTo(x+35,85);g.lineTo(x+35,250);g.stroke();
       }
       const empty=await engine.recognize(c,c.width,c.height);
       all.push({name:"empty-cabinet-geometry",text:empty.text,
         words:empty.words.length,ms:empty.elapsedMs});
       done({ok:true,cases:all});
      })().catch(error=>done({ok:false,error:String(error.stack||error)}))
    """)
    assert outcomes.get("ok"),outcomes.get("error")
    for record in outcomes["cases"]:
        print("SCENE",record,flush=True)
        if record["name"]=="empty-cabinet-geometry":
            assert not any(len(token)>3 for token in record["text"].split()),(
                "Geometric background hallucinated a long word",record)
        else:
            assert "THREADS" in record["text"].upper(),(
                "Failed printed text test",record)
    print("PASS: offline OCR handles white-on-black, color and angled labels",flush=True)
finally:
    browser.quit()
