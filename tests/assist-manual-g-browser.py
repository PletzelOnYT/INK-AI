"""Manual Assist and press-G-after-release integration regression."""
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
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    assert driver.execute_script("return window.__inkAssistEnabled") is False
    def stroke(points,ident):
        driver.execute_script("""
          const cv=document.getElementById("pad"),r=cv.getBoundingClientRect();
          arguments[0].forEach(([x,y],i)=>{
           const type=i===0?"pointerdown":i===arguments[0].length-1?"pointerup":"pointermove";
           cv.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
            pointerId:arguments[1],pointerType:"mouse",buttons:type==="pointerup"?0:1,
            clientX:r.left+x/1200*r.width,clientY:r.top+y/550*r.height}));
          });
        """,points,ident)
    stroke([[290,140],[290,173],[290,208],[290,242],[290,278]],887)
    assert driver.execute_script("return window.__inkAssistEnabled") is False
    driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    stroke([[290,140],[290,173],[290,208],[290,242],[290,278]],888)
    wait.until(lambda d:d.execute_script("return window.__inkGhostPoints>=3"))
    before=driver.execute_script("return document.getElementById('pad').toDataURL()")
    driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'g',bubbles:true}))")
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedVectorCount>0"))
    after=driver.execute_script("return document.getElementById('pad').toDataURL()")
    assert after!=before
    print("PASS: manual Assist and G accepts visible neural ghost after release",flush=True)
    driver.find_element(By.ID,"assist").click()
    assert driver.execute_script("return window.__inkAssistEnabled") is False
finally:
    driver.quit();server.shutdown()
