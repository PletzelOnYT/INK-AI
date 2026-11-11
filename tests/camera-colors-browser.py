#!/usr/bin/env python3
"""Real headless Chrome smoke test: white highlighting of colored text fixtures.
This checks overlay visibility only, NOT real webcam OCR accuracy.
"""
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--autoplay-policy=no-user-gesture-required","--window-size=1400,900"):
    opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(Path("index.html").resolve().as_uri())
    WebDriverWait(driver,70).until(lambda d:d.execute_script("return window.__inkReady===true"))
    driver.execute_script("""
        const canvas=document.createElement('canvas');
        canvas.width=960;canvas.height=500;
        const ctx=canvas.getContext('2d');
        window.__inkDrawCameraFixture=(background,foreground)=>{
          ctx.fillStyle=background;ctx.fillRect(0,0,960,500);
          ctx.font='bold 88px Arial';
          ctx.textBaseline='middle';
          ctx.fillStyle=foreground;
          ctx.fillText('Chromebook',55,250);
          // Keep sending updated video frames, as a real webcam would.
          ctx.fillStyle=background;ctx.fillRect(1,1,2,2);
        };
        window.__inkDrawCameraFixture('#f8f8f8','#151515');
        const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
        navigator.mediaDevices.getUserMedia=async()=>canvas.captureStream(12);
    """)
    driver.execute_script("document.getElementById('camera').click()")
    WebDriverWait(driver,12).until(lambda d:d.execute_script("return window.__inkCameraActive"))
    scenarios=[
      ("dark_on_light","#f8f8f8","#171717"),
      ("light_on_dark","#1e1e1e","#f8f8f8"),
      ("colored_text","#f6f6f6","#184dda"),
      ("colored_background","#491a86","#f8e545"),
    ]
    for label,bg,fg in scenarios:
        driver.execute_script("window.__inkDrawCameraFixture(arguments[0],arguments[1])",bg,fg)
        def highlighted(d):
            return d.execute_script("""
              const canvas=document.getElementById('cameraHighlights');
              if(!canvas.width||!canvas.height)return 0;
              const pixels=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
              let count=0;
              for(let i=3;i<pixels.length;i+=32)if(pixels[i]>0)count++;
              return count;
            """)
        try:
            WebDriverWait(driver,10).until(lambda d:highlighted(d)>70)
            print("PASS",label,"white-highlight pixels",highlighted(driver),flush=True)
        except Exception:
            print("FAIL",label,"highlight pixels",highlighted(driver),
                  "camera status",driver.execute_script("return document.getElementById('guess').textContent"),flush=True)
            raise
    driver.execute_script("document.getElementById('camera').click()")
    assert not driver.execute_script("return window.__inkCameraActive")
finally:
    driver.quit()
