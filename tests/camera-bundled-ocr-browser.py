#!/usr/bin/env python3
"""Real browser acceptance: ONE local index.html, no HTTP requests or server.
Uses a generated fixture, not any uploaded personal screenshots.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1400,900"):
    options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
    driver.set_script_timeout(125)
    driver.get(Path("index.html").resolve().as_uri())
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.emulateNetworkConditions",{
        "offline": True,"latency":0,"downloadThroughput":0,"uploadThroughput":0
    })
    result=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
       if(!window.InkOfflineOCR?.create)
        throw Error("Compiled Tesseract offline bundle missing from index.html");
       const engine=await window.InkOfflineOCR.create();
       const canvas=document.createElement("canvas");
       canvas.width=1120;canvas.height=280;
       const ctx=canvas.getContext("2d");
       ctx.fillStyle="#f5f5f5";ctx.fillRect(0,0,1120,280);
       ctx.fillStyle="#101010";ctx.font="bold 100px Arial";
       ctx.fillText("NY THREADS",60,130);
       ctx.font="38px Arial";
       ctx.fillText("Torrey Pines High School",65,205);
       const start=performance.now();
       const read=await engine.recognize(canvas,1120,280);
       const result={
        text:read.text,elapsedMs:performance.now()-start,
        lines:read.lines.length,words:read.words.length,
        engine:read.engine
       };
       done({ok:true,result});
      })().catch(e=>done({ok:false,error:String(e?.stack||e)}));
    """)
    assert result.get("ok"),result.get("error")
    payload=result["result"]
    print("OFFLINE OCR RESULT:",payload,flush=True)
    text=payload["text"].upper().replace("\n"," ")
    assert "THREADS" in text, "Offline printed-label OCR did not read THREADS"
    assert "NY" in text, "Offline printed-label OCR missed short abbreviation"
    assert payload["words"]>=2, "No recognized word highlight boxes"
    assert payload["engine"]=="bundled-tesseract-wasm"
    print("PASS: GitHub index.html reads real printed text while completely offline")
finally:
    driver.quit()
