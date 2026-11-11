#!/usr/bin/env python3
"""Test first-party scene-text localization in Chrome (no remote OCR models).
Generated fixtures only; no user photo is committed to the repository.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

opts=Options()
for arg in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
            "--window-size=1200,900"):
    opts.add_argument(arg)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(Path("index.html").resolve().as_uri())
    WebDriverWait(driver,70).until(lambda d:d.execute_script(
        "return Boolean(window.InkCameraDetector) && window.__inkReady===true"))
    for label,bg,fg,rotation in [
      ("dark on white","#ffffff","#111111",0),
      ("blue on white","#eeeeff","#1648cc",0),
      ("yellow on dark","#172a3a","#f6df1b",0),
      ("28 degree tilt","#ffffff","#111111",28),
      ("-28 degree tilt","#ffffff","#111111",-28),
      ("no printed text","#ffffff",None,0),
    ]:
        result=driver.execute_script("""
          const [background,foreground,angle]=arguments;
          const canvas=document.createElement('canvas');
          canvas.width=800;canvas.height=451;
          const ctx=canvas.getContext('2d');
          ctx.fillStyle=background;ctx.fillRect(0,0,800,451);
          if(foreground){
            ctx.save();ctx.translate(400,220);
            ctx.rotate(angle*Math.PI/180);
            ctx.fillStyle=foreground;ctx.font='bold 50px Arial';
            ctx.fillText('Chromebook',-175,0);ctx.restore();
          }
          const before=performance.now();
          const lines=window.InkCameraDetector.detect(ctx.getImageData(0,0,800,451),800,451);
          return {lines:lines.length,largest:Math.max(0,...lines.map(l=>l.letters.length)),
            elapsedMs:performance.now()-before};
        """,bg,fg,rotation)
        if fg is None:
            assert result["lines"]==0,(label,result)
        else:
            assert result["lines"]>=1 and result["largest"]>=7,(label,result)
        print("PASS",label,result,flush=True)
finally:
    driver.quit()
