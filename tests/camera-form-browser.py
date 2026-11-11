#!/usr/bin/env python3
"""Offline Chrome acceptance for mixed-size form fields and inverted text.

No user photographs are stored in the repository. This recreates the
placement, relative sizes, table rules and tiny serial/date typography of a
room-camera receipt with ordinary canvas text.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1366,900"):
    opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.set_script_timeout(260)
    driver.get(Path("index.html").resolve().as_uri())
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.emulateNetworkConditions",{
      "offline":True,"latency":0,"downloadThroughput":0,"uploadThroughput":0})
    result=driver.execute_async_script("""
      const done=arguments[arguments.length-1];
      (async()=>{
        const engine=await window.InkOfflineOCR.create();
        const canvas=document.createElement("canvas");
        canvas.width=1280;canvas.height=720;
        const c=canvas.getContext("2d");
        const set=(bg="#dfdcd4")=>{c.fillStyle=bg;c.fillRect(0,0,1280,720)};
        const text=(str,x,y,font,color="#1b2024")=>{
          c.fillStyle=color;c.font=font;c.textAlign="left";
          c.fillText(str,x,y);
        };
        const border=(x,y,w,h,color="#6b6867")=>{
          c.strokeStyle=color;c.lineWidth=2;c.strokeRect(x,y,w,h);
        };
        const collected=[];
        async function readFrames(n){
          const seen=[],sources=[],focus=[];
          for(let i=0;i<n;i++){
            const output=await engine.recognize(canvas,1280,720);
            seen.push(output.text);
            sources.push(output.enhancement||"ordinary");
            focus.push(window.__inkDocumentFocusStats||null);
          }
          return {seen,sources,focus,all:seen.join("\\n")};
        }
        // Strong headline and address at left; small gray date/receipt
        // table at lower-right. Large text cannot preempt small fields.
        set();
        c.fillStyle="#f9f8f5";c.fillRect(132,147,850,558);
        c.save();c.translate(560,190);
        text("Torrey Pines High School",0,0,"bold 24px Arial");
        text("3710 Del Mar Heights Rd",0,29,"19px Arial");
        text("San Diego, CA 92130",0,55,"19px Arial");
        c.restore();
        text("RECEIPT",706,290,"bold 34px Arial");
        c.fillStyle="#bebfbc";c.fillRect(687,331,250,34);
        border(687,331,250,82);
        c.beginPath();c.moveTo(687,365);c.lineTo(937,365);c.stroke();
        text("DATE",778,355,"bold 18px Arial");
        text("August 12, 2026",721,392,"18px Arial");
        c.fillStyle="#bfc0bd";c.fillRect(687,435,250,36);
        border(687,435,250,82);
        c.beginPath();c.moveTo(687,471);c.lineTo(937,471);c.stroke();
        text("RECEIPT NUMBER",722,459,"bold 17px Arial");
        text("22567",781,500,"bold 20px Arial");
        collected.push({name:"receipt",...(await readFrames(9))});
        // Harder receipt: the clearly readable heading competes with
        // much smaller shaded date/number cells at the edge of the view.
        set("#d9dad2");
        c.fillStyle="#fcfcf9";c.fillRect(480,185,640,528);
        text("RECEIPT",755,281,"bold 38px Arial");
        text("Torrey Pines High School",515,322,"bold 25px Arial");
        text("3710 Del Mar Heights Rd",515,354,"19px Arial");
        text("San Diego, CA 92130",515,382,"19px Arial");
        c.fillStyle="#cccac6";c.fillRect(801,470,235,35);
        border(801,470,235,78);
        text("DATE",895,495,"bold 13px Arial");
        text("August 12, 2026",840,530,"13px Arial","#343537");
        c.fillStyle="#c7c5c1";c.fillRect(801,560,235,35);
        border(801,560,235,83);
        text("RECEIPT NUMBER",833,583,"bold 12px Arial");
        text("22567",893,627,"bold 14px Arial");
        const distant=await readFrames(10);
        // Verify the public camera adapter, including its independent pixel
        // evidence filter and temporal transcript. A raw Tesseract result
        // alone is not proof the app displays the recovered fields.
        Object.defineProperty(canvas,"videoWidth",{value:1280});
        Object.defineProperty(canvas,"videoHeight",{value:720});
        const camera=await window.InkOfflineCamera.connect();
        window.__inkDebugOCR=true;
        const browserVisible=[],filteredDiagnostics=[];
        for(let k=0;k<4;k++){
          const verified=await camera.recognize(canvas);
          const stable=camera.track(verified,Date.now()+k*320);
          browserVisible.push(stable.text);
          filteredDiagnostics.push({
            accepted:verified.words.map(w=>({text:w.text,confidence:w.confidence})),
            filter:window.__inkCameraEvidence,
            rejected:window.__inkCameraRejectedWords});
        }
        camera.reset();
        window.__inkDebugOCR=false;
        collected.push({name:"distant-receipt",...distant,
          browserVisible,filteredDiagnostics});
        // Colored print and reversed polarities must both produce actual
        // recognized tokens, never be replaced by expected document labels.
        set("#211c53");
        text("LEVEL 29",380,346,"bold 55px Arial","#f3e46b");
        text("WHITE TEXT",405,442,"bold 48px Arial","#ffffff");
        collected.push({name:"inverted-color",...(await readFrames(5))});
        // Thin gray angled print challenges contrast and geometry.
        set("#f4f4e9");
        c.save();c.translate(490,370);c.rotate(-0.13);
        text("PENCIL SAMPLE 314",0,0,"33px Georgia","#8f8a83");
        c.restore();
        collected.push({name:"pencil-angle",...(await readFrames(5))});
        done({ok:true,cases:collected});
      })().catch(e=>done({ok:false,error:String(e.stack||e)}));
    """)
    assert result.get("ok"), result.get("error")
    for case in result["cases"]:
        print("FORM OCR DIAGNOSTIC",{
          "case":case["name"],"sources":case["sources"],
          "frames":[s[:350] for s in case["seen"]],
          "browserVisible":case.get("browserVisible"),
          "filteredDiagnostics":case.get("filteredDiagnostics")},flush=True)
    receipt=result["cases"][0]["all"].lower()
    assert "22567" in receipt, "Receipt number was missed: "+repr(receipt)
    assert "august" in receipt and "2026" in receipt, (
      "Receipt date was missed: "+repr(receipt))
    assert "receipt" in receipt, "Receipt heading regressed"
    tiny=result["cases"][1]
    assert "22567" in tiny["seen"][1], (
      "Detailed region scan did not recover the small receipt number")
    assert "august" in tiny["seen"][1].lower(), (
      "Detailed region scan did not recover the small date")
    assert "2026" in tiny["seen"][1], (
      "Detailed scan failed to recover date digits")
    assert any("22567" in line for line in tiny["browserVisible"]), (
      "Camera evidence filters discarded the recovered receipt number")
    assert any("August" in line for line in tiny["browserVisible"]), (
      "Camera UI transcript discarded the recovered receipt date")
    focus=result["cases"][1]["focus"]
    assert any(f and f["attempts"]>=1 for f in focus), (
      "Focused document recovery did not run")
    assert all(f is None or f["words"]>=0 for f in focus)
    print("PASS: offline Chrome reads small receipt date and serial below clear headings",flush=True)
finally:
    driver.quit()
