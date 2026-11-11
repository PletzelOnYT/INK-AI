#!/usr/bin/env python3
"""Test CAMERA PIPELINE, not just raw OCR, on diagonally rotated labels.
Fixture is drawn by Chromium and processed entirely offline.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1400,900"):
    opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.set_script_timeout(240)
    driver.get(Path("index.html").resolve().as_uri())
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.emulateNetworkConditions",{
      "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    report=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
       const camera=await window.InkOfflineCamera.connect();
       const canvas=document.createElement("canvas");
       canvas.width=960;canvas.height=540;
       Object.defineProperty(canvas,"videoWidth",{value:960});
       Object.defineProperty(canvas,"videoHeight",{value:540});
       const g=canvas.getContext("2d");
       const tests=[
        ...[-90,-75,-60,-45,-30,-20,-12,0,12,20,30,45,60,75,90,135,180]
          .map(angle=>({angle,bg:"#ffffff",ink:"#111111"})),
        {angle:-35,bg:"#17191c",ink:"#fafafa"},
        {angle:25,bg:"#f8d94b",ink:"#103cd0"},
        {angle:65,bg:"#17191c",ink:"#fafafa"}
       ];
       const results=[];
       for(const test of tests){
        camera.reset();
        g.fillStyle=test.bg;g.fillRect(0,0,960,540);
        g.save();g.translate(480,270);
        g.rotate(test.angle*Math.PI/180);
        g.fillStyle=test.ink;
        g.textAlign="center";g.textBaseline="middle";
        g.font="bold 72px Arial";g.fillText("NY THREADS",0,0);
        g.restore();
        let match=null,readings=[];
        for(let attempt=0;attempt<5;attempt++){
         const payload=await camera.recognize(canvas);
         const text=payload.lines.map(line=>line.text).join(" ");
         readings.push({text,rotation:payload.rotationDegrees,
           hint:payload.projectionAngle,source:payload.angleSource,
           passMs:payload.elapsedMs,evidence:window.__inkCameraEvidence});
         const state=camera.track(payload,Date.now()+attempt*100);
         if(text.toUpperCase().includes("THREADS") &&
             state.words.some(word=>word.text.toUpperCase().includes("THREADS"))){
          const words=state.words.map(word=>({text:word.text,box:word.box,
            points:word.points}));
          match={angle:test.angle,bg:test.bg,pass:attempt+1,
             rotation:payload.rotationDegrees,source:payload.angleSource,
             ms:payload.elapsedMs,words,text:state.text};break;
         }
        }
        results.push(match||{angle:test.angle,bg:test.bg,
          failure:"WORD_NOT_RECOGNIZED_AFTER_FIVE_PASSES",readings});
       }
       g.fillStyle="#d6d1cd";g.fillRect(0,0,960,540);
       camera.reset();
       const blank=await camera.recognize(canvas);
       const empty=camera.track(blank,Date.now()).text;
       done({ok:true,results,blank:empty});
      })().catch(err=>done({ok:false,error:String(err.stack||err)}))
    """)
    assert report.get("ok"),report.get("error")
    failed=[]
    for case in report["results"]:
        print("OBLIQUE CAMERA",{
            k:v for k,v in case.items() if k not in ("words","readings")
        },flush=True)
        if "failure" in case:
            print("OBLIQUE FAIL FRAMES",case["angle"],case["readings"],flush=True)
            failed.append(case)
            continue
        assert "THREADS" in case["text"].upper(),case
        assert case["pass"]<=5,case
        for word in case["words"]:
            box=word["box"]
            assert box["x0"]>=-4 and box["y0"]>=-4,case
            assert box["x1"]<=964 and box["y1"]<=544,case
            if case["angle"] and word["text"].upper()=="THREADS":
                assert len(word["points"])==4,case
    assert not report["blank"].strip(),report["blank"]
    assert not failed, f"{len(failed)} angled OCR fixtures failed: "+str(
        [(x["angle"],x["bg"]) for x in failed])
    print("PASS: camera recognizes angled print (-90..180 degrees), white-on-black, blue-on-yellow and blank walls offline",flush=True)
finally:
    driver.quit()
