#!/usr/bin/env python3
"""Regression: room and cabinet geometry must NOT create OCR words/highlights.
Draws a synthetic interior, not a user photo. No webcam or remote services.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--autoplay-policy=no-user-gesture-required","--window-size=1400,900"):
    options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,70)
    wait.until(lambda d:d.execute_script(
        "return window.__inkReady === true && window.__inkPrintReady === true"))
    driver.execute_script("""
      const c=document.createElement('canvas');
      c.width=960;c.height=540;
      const p=c.getContext('2d');
      function interior(){
        const grad=p.createLinearGradient(0,0,960,540);
        grad.addColorStop(0,'#efca94');grad.addColorStop(.58,'#f9e8c7');
        grad.addColorStop(.59,'#989691');grad.addColorStop(1,'#d9d8d2');
        p.fillStyle=grad;p.fillRect(0,0,960,540);
        // Large boundaries: shelving, cabinet doors, appliance panels.
        p.fillStyle='#b4b1ab';p.fillRect(560,0,400,540);
        p.fillStyle='#e0e0dc';
        p.fillRect(650,70,160,370);p.fillRect(822,70,130,370);
        p.strokeStyle='#85888a';p.lineWidth=3;
        for(const x of [650,810,822,952]){
          p.beginPath();p.moveTo(x,65);p.lineTo(x,440);p.stroke();
        }
        for(const x of [724,894]){
          p.strokeStyle='#6f7274';p.lineWidth=10;
          p.beginPath();p.moveTo(x,176);p.lineTo(x+12,176);p.stroke();
        }
        // Flat shelf edges create text-like rectangles in the old reader.
        p.strokeStyle='#f6f6f6';p.lineWidth=5;
        for(const y of [340,365,398,417]){
          p.beginPath();p.moveTo(20,y);p.lineTo(245,y-3);p.stroke();
        }
        p.strokeStyle='#61605d';p.lineWidth=8;
        p.strokeRect(660,208,140,100);
        p.strokeRect(660,334,140,100);
        p.fillStyle='#f3ece1';p.fillRect(100,365,170,100);
      }
      interior();
      // The synthetic webcam must emit actual successive frames. A static
      // captureStream() sometimes sends only one frame in headless Chrome
      // and falsely times out before three OCR passes can be observed.
      const timer=setInterval(interior,90);
      navigator.mediaDevices.getUserMedia=async()=>c.captureStream(12);
      window.__inkSyntheticRoom={interior,timer};
    """)
    driver.execute_script("document.getElementById('camera').click()")
    wait.until(lambda d:d.execute_script("return window.__inkCameraActive"))
    wait.until(lambda d:d.execute_script("return window.__inkCameraStats.scans>=3"))
    text=driver.execute_script("return window.__inkCameraText")
    canvas_alpha=driver.execute_script("""
      const el=document.getElementById('cameraHighlights');
      const pixels=el.getContext('2d').getImageData(0,0,el.width,el.height).data;
      let visible=0;
      for(let i=3;i<pixels.length;i+=4)if(pixels[i])visible++;
      return visible;
    """)
    assert text=="",f"False OCR text generated from blank room: {text!r}"
    assert canvas_alpha==0, f"False highlighter rectangles: {canvas_alpha} pixels"
    print("PASS: non-text interior causes no hallucinated words or highlight rectangles")
finally:
    try:
        driver.execute_script("if(window.__inkSyntheticRoom)clearInterval(window.__inkSyntheticRoom.timer)")
    except Exception:
        pass
    driver.quit()
