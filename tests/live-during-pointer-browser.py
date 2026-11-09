"""INK AI regression: generated pen suggestions must appear WHILE pointer is held.

This catches the previous starvation bug where the UI discarded all responses
whenever new pen movements had arrived, and only displayed a preview at pointerup.
"""
import http.server,threading
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
    opts.add_argument(flag)
browser=webdriver.Chrome(options=opts)
try:
    browser.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(browser,55)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    browser.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    assert browser.execute_script("return window.__inkLivePreviewUpdates") == 0
    browser.set_script_timeout(20)
    report=browser.execute_async_script("""
      const done=arguments[arguments.length-1],cv=document.getElementById('pad');
      const r=cv.getBoundingClientRect(),id=814;
      const events=[];
      const send=(type,x,y)=>{
        cv.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,pointerId:id,pointerType:'mouse',
          buttons:type==='pointerup'?0:1,
          clientX:r.left+x/1200*r.width,
          clientY:r.top+y/550*r.height
        }));
      };
      send('pointerdown',300,260);
      let step=0,last=-1,firstSeen=null,unique=new Set();
      const timer=setInterval(()=>{
        step++;
        const x=300+step*7;
        const y=260-45*Math.sin(step/12);
        send('pointermove',x,y);
        const seen=window.__inkLivePreviewUpdates||0;
        if(seen!==last){
          last=seen;
          if(seen>0){
             if(firstSeen===null)firstSeen=step;
             unique.add(document.getElementById('ghost').toDataURL());
             events.push({step,seen,points:window.__inkGhostPoints,
               requests:window.__inkAssistRequests,
               latency:window.__inkLastPreviewLatencyMs});
          }
        }
        if(step>=30){
          clearInterval(timer);
          const result={liveUpdates:window.__inkLivePreviewUpdates,
            requests:window.__inkAssistRequests,
            pointerStillDown:true,firstSeen,distinctPreviews:unique.size,
            ghostPoints:window.__inkGhostPoints,events,error:window.__inkLastGlyphError};
          send('pointerup',x,y);
          done(result);
        }
      },95);
    """)
    print("CONTINUOUS INK ACTIVE POINTER:",report,flush=True)
    assert report["liveUpdates"]>=2, "Neural preview failed to update repeatedly before pointerup"
    assert report["firstSeen"] is not None and report["firstSeen"]<30
    assert report["requests"]>=2,"Inference requests not scheduled while drawing"
    assert report["ghostPoints"]>=2,"No visible neural strokes during active drawing"
    assert report["distinctPreviews"]>=2,"Preview did not change while the pen was moving"
    print("PASS: continuously moving pen produces multiple different live vector suggestions before release",flush=True)
finally:
    browser.quit()
    server.shutdown()
