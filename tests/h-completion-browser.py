"""Reproduce the screenshot's unfinished lowercase h in a real Chrome canvas.

Check the running (prefix-tuned + validated fallback) trained neural worker,
actual translucent vector overlay, and G acceptance.  This is NOT a
font/template stand-in or a mock model prediction.
"""
import http.server,threading,time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.action_chains import ActionChains

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
    opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,65)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    if driver.execute_script("return window.__inkPrefixTrained===true"):
        wait.until(lambda d:d.execute_script("return window.__inkFallbackReady===true"))
    # Hand-drawn screenshot geometry, mapped into the app's 1200x550 board.
    stem=[[289,130],[289,157],[289,185],[289,213],
          [289,243],[288,275],[288,307],[288,335],[288,360]]
    shoulder=[[288,255],[299,250],[310,247],[325,244],
              [340,248],[356,258],[369,272],[378,285]]
    driver.execute_script("""
      const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
      const strokes=arguments[0];
      strokes.forEach((points,s)=>{
       points.forEach(([x,y],i)=>{
        const type=i===0?'pointerdown':i===points.length-1?'pointerup':'pointermove';
        cv.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,pointerId:901+s,pointerType:'mouse',
          buttons:type==='pointerup'?0:1,
          clientX:r.left+x/1200*r.width,
          clientY:r.top+y/550*r.height
        }));
       });
      });
    """,[stem,shoulder])
    wait.until(lambda d:d.execute_script("return window.__inkDetectedRegions>=1"))
    # Use the real OCR -> neural worker -> ghost renderer flow. No synthetic
    # model message, internal closure access or forced class label.
    wait.until(lambda d:d.execute_script(
        "return window.__inkAssistLabel==='h' && window.__inkGhostPoints>=3"))
    measurement=driver.execute_script("""
      return {dy:window.__inkGhostTailDy,
       tailRange:window.__inkGhostTailRange,
       segmentCount:window.__inkGhostSegments,
       points:window.__inkGhostPoints,
       source:window.__inkGhostSource,
       fallback:window.__inkFallbackUsed,
       width:window.__inkGhostStrokeWidth,
       label:window.__inkAssistLabel,
       recognized:document.getElementById('guess').textContent};
    """)
    print("ACTUAL SCREENSHOT h GHOST:",measurement,flush=True)
    assert measurement["dy"]>.06,"h must descend, not produce flat horizontal ghost"
    assert measurement["tailRange"]>.08
    assert measurement["width"]<=8
    before=driver.execute_script("return document.getElementById('pad').toDataURL()")
    ActionChains(driver).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedVectorCount>=1"))
    after=driver.execute_script("return document.getElementById('pad').toDataURL()")
    assert before!=after
    print("PASS: real h canvas generates downward gray neural vector, then G accepts it",flush=True)
finally:
    driver.quit();server.shutdown()
