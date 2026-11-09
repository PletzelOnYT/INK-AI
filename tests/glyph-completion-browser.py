"""Real Chrome integration: sample autonomous online pen trajectories, not pixels."""
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
for x in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
    opts.add_argument(x)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphVersion===3"))
    assert driver.execute_script("return window.__inkAssistModel")=="online-stroke-gru"
    assert driver.execute_script("return window.__inkHumanExamples")==0
    print("PASS: only actual class-conditioned neural vector model initialized",flush=True)
    fixtures={
      "vertical":[[210,120],[210,150],[210,180],[210,210],[210,240],[210,270]],
      "round":[[330,125],[308,128],[288,147],[278,172],[280,205],[299,226],[325,236]],
      "digit":[[450,165],[467,140],[491,128],[521,130],[540,149],[534,176]],
      "diagonal":[[640,120],[655,150],[667,178],[683,210],[700,247]],
      "question":[[820,160],[824,138],[842,126],[866,128],[883,146],[875,164],[857,183]]
    }
    successes=0
    for name,points in fixtures.items():
        driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
        driver.execute_script("""
            const cv=document.getElementById('pad'),r=cv.getBoundingClientRect(),pts=arguments[0];
            pts.forEach(([x,y],i)=>{
              const type=i===0?'pointerdown':i===pts.length-1?'pointerup':'pointermove';
              cv.dispatchEvent(new PointerEvent(type,{
                bubbles:true,cancelable:true,pointerId:321,pointerType:'mouse',
                buttons:type==='pointerup'?0:1,
                clientX:r.left+x/1200*r.width,clientY:r.top+y/550*r.height
              }))
            });
        """,points)
        end=time.monotonic()+10
        result=None
        while time.monotonic()<end:
            result=driver.execute_script("""
              return {points:window.__inkGhostPoints,segments:window.__inkGhostSegments,
                width:window.__inkGhostStrokeWidth,source:window.__inkGhostSource,
                choices:window.__inkSuggestionChoices,error:window.__inkLastGlyphError}
            """)
            if result["points"]>=3:break
            time.sleep(.2)
        print("ONLINE GLYPH",name,result,flush=True)
        if result["points"]>=3 and result["segments"]>=1:
            assert result["source"]=="neural-stroke-sequence"
            assert 3<=result["width"]<=8
            successes+=1
    assert successes>=3,"Neural generator did not complete enough varied real browser strokes: "+str(successes)
    print("PASS: genuine neural generated vector continuations on",successes,"of 5 partial handwritten shapes",flush=True)
finally:
    driver.quit();server.shutdown()
