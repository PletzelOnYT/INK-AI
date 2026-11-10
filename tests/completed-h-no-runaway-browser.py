"""Nov 9 screenshot regression: a finished one- or two-stroke h needs NO tail."""
import http.server,threading,time
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
driver=webdriver.Chrome(options=opts)
def strokes(rows,pointer_id):
    driver.execute_script("""
      const cv=document.getElementById("pad"),box=cv.getBoundingClientRect();
      arguments[0].forEach((points,s)=>{
       points.forEach(([x,y],i)=>{
        const type=i===0?"pointerdown":i===points.length-1?"pointerup":"pointermove";
        cv.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
         pointerId:arguments[1]+s,pointerType:"mouse",buttons:type==="pointerup"?0:1,
         clientX:box.left+x/1200*box.width,clientY:box.top+y/550*box.height
        }));
       });
      });
    """,rows,pointer_id)
def clear():
    driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,55)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    # Black ink taken from the provided screenshot, expressed in pad pixels.
    # The right leg deliberately stops above the taller left-stem baseline.
    stem=[[226,186],[226,212],[222,251],[216,297],[211,342],[210,391]]
    shoulder=[[213,341],[229,305],[250,276],[278,267],
              [289,280],[300,302],[305,337]]
    for index,shape in enumerate(([stem,shoulder],[stem+shoulder])):
        clear()
        prev=driver.execute_script("return window.__inkCompletedGlyphSuppressions")
        strokes(shape,901+index*4)
        wait.until(lambda d:d.execute_script(
            "return window.__inkCompletedGlyphSuppressions>arguments[0]",prev))
        time.sleep(0.8)
        state=driver.execute_script("""
          return {ghost:window.__inkGhostPoints,
           suppressed:window.__inkCompletedGlyphSuppressions,
           error:window.__inkLastGlyphError,
           assist:window.__inkAssistEnabled};
        """)
        assert state["ghost"]==0 and state["assist"],state
        print("PASS screenshot finished h no absurd diagonal:",index,state,flush=True)
    # An incomplete shoulder still needs learned downstroke suggestions.
    clear()
    original_stem=[[289,130],[289,157],[289,185],[289,213],
      [289,243],[288,275],[288,307],[288,335],[288,360]]
    original_shoulder=[[288,255],[299,250],[310,247],[325,244],
      [340,248],[356,258],[369,272],[378,285]]
    strokes([original_stem,original_shoulder],991)
    wait.until(lambda d:d.execute_script("return window.__inkGhostPoints>=3"))
    print("PASS incomplete h continues to offer real neural strokes",flush=True)
finally:
    driver.quit()
    server.shutdown()
