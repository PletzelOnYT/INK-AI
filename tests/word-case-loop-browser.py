"""Browser regression cases derived from reported handwriting shapes, not font glyphs."""
import http.server,threading
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
class Quiet(http.server.SimpleHTTPRequestHandler):
 def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
 options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
 driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
 wait=WebDriverWait(driver,50)
 wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
 def draw(paths):
  driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));")
  driver.execute_script("""
    const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
    arguments[0].forEach((pts,j)=>pts.forEach(([x,y],k)=>{
      const type=k===0?'pointerdown':k===pts.length-1?'pointerup':'pointermove';
      cv.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,
       pointerId:3100+j,pointerType:'mouse',buttons:type==='pointerup'?0:1,
       clientX:r.left+x*r.width/1200,clientY:r.top+y*r.height/550}));
    }));
  """,paths)
  wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
  return driver.execute_script("""return {
    guess:document.getElementById('guess').textContent,
    regions:window.__inkDetectedRegions,
    top:window.__inkTopCandidates,
    geometry:window.__inkWordRegions
   }""")
 h=[[[350,174],[350,200],[350,230],[350,256]],
    [[350,226],[362,211],[380,211],[394,218],[407,236],[408,247]]]
 i=[[[455,211],[455,228],[455,249]],[[455,177],[455,178],[457,179]]]
 o=[[[551,212],[540,209],[528,212],[519,222],[519,234],[527,244],
      [540,246],[549,239],[553,224],[552,213],[544,212]]]
 w=[[[255,220],[267,258],[279,225],[292,263],[308,220]]]
 hy=[[[354,165],[353,190],[353,226],[353,257]],
     [[353,231],[364,215],[380,212],[397,228],[404,243]]]
 y=[[[460,213],[481,228],[500,246],[521,261]],
    [[556,220],[546,242],[531,263],[510,289],[490,314]]]
 xbig=[[[270,196],[292,221],[312,247],[331,267]],
       [[328,201],[311,220],[293,239],[276,257]]]
 xsmall=[[[385,214],[403,233],[420,250]],
         [[421,210],[405,231],[385,247]]]
 hx=[[[455,177],[455,212],[455,245],[455,271]],
     [[455,239],[466,221],[483,222],[499,243],[501,269]]]
 cases=[("hio",h+i+o),("why",[w[0]]+hy+y),("Xxh",xbig+xsmall+hx)]
 for name,paths in cases:
  output=draw(paths)
  print("HANDWRITTEN_WORD",name,output,flush=True)
  assert output["regions"]==3, (name,output)
  assert output["guess"]==name, (name,output)
 print("PASS: all three reported word-shape recognition regressions in real Chrome",flush=True)
finally:
 driver.quit();server.shutdown()
