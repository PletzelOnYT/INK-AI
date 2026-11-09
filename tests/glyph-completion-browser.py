"""Quality smoke test: handwritten fragments produce vector, not bitmap, suggestions."""
import http.server, threading, time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass

server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
opts=Options()
for item in ["--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1400,1000"]:
    opts.add_argument(item)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady"))
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphVersion===2&&window.__inkHumanExamples>=10000"))
    # Canvas coordinate fragments, not font rendering.
    specimens={
      "vertical stem (could become B/P/H/F)":[[210,120],[210,150],[210,180],[210,210],[210,240],[210,270]],
      "left half of a round letter":[[330,125],[308,128],[288,147],[278,172],[280,205],[299,226],[325,236]],
      "top arc for a digit":[[450,165],[467,140],[491,128],[521,130],[540,149],[534,176]],
      "sloped leg":[[640,120],[655,150],[667,178],[683,210],[700,247]],
      "question mark curve":[[820,160],[824,138],[842,126],[866,128],[883,146],[875,164],[857,183]]
    }
    successes=0
    for name,points in specimens.items():
        driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
        driver.execute_script("""
          const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
          const pts=arguments[0],id=1782;
          for(let j=0;j<pts.length;j++){
            const [x,y]=pts[j];
            const evt=new PointerEvent(j===0?'pointerdown':j===pts.length-1?'pointerup':'pointermove',{
              bubbles:true,cancelable:true,pointerId:id,pointerType:'mouse',buttons:j===pts.length-1?0:1,
              clientX:r.left+x/1200*r.width,clientY:r.top+y/550*r.height
            });
            cv.dispatchEvent(evt);
          }
        """,points)
        deadline=time.monotonic()+6
        result=None
        while time.monotonic()<deadline:
            result=driver.execute_script("""
                return {points:window.__inkGhostPoints,width:window.__inkGhostStrokeWidth,
                  segments:window.__inkGhostSegments,label:window.__inkAssistLabel,
                  source:window.__inkGhostSource,choices:window.__inkSuggestionChoices,
                  error:window.__inkLastGlyphError}
            """)
            if result["points"]>=3:break
            time.sleep(.25)
        print(f"FRAGMENT {name}: {result}",flush=True)
        if result["points"]>=3 and result["segments"]>=1:
            assert result["width"]<=10,"Suggested line is too thick"
            assert result["source"] in ("real-handwriting","trained-generator")
            successes+=1
    assert successes>=3,f"Only {successes}/5 partial glyphs produced usable vector suggestions"
    print(f"PASS: {successes}/5 representative partial characters have smooth vector completions",flush=True)
finally:
    driver.quit();server.shutdown()
