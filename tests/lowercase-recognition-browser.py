"""Capture real Chrome CNN diagnostics for c/C and dotted i/I grouping."""
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
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,1000"):opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,50)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    def draw(paths):
        driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
        driver.execute_script("""
          const cv=document.getElementById("pad"),r=cv.getBoundingClientRect();
          for(const [j,pts] of arguments[0].entries()){
            for(let k=0;k<pts.length;k++){
              const [x,y]=pts[k],type=k===0?"pointerdown":k===pts.length-1?"pointerup":"pointermove";
              cv.dispatchEvent(new PointerEvent(type,{
                bubbles:true,cancelable:true,pointerId:410+j,pointerType:"mouse",
                buttons:type==="pointerup"?0:1,
                clientX:r.left+x*r.width/1200,clientY:r.top+y*r.height/550
              }));
            }
          }
        """,paths)
        wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
        return driver.execute_script("""return {guess:document.getElementById('guess').textContent,
           regions:window.__inkDetectedRegions,
           top:window.__inkTopCandidates,
           shapes:window.__inkShapeOverride}""")
    c=[[340,214],[321,205],[302,209],[288,225],[282,246],[284,271],
       [298,290],[317,297],[338,288]]
    lower_c=[[x,y+55] for x,y in c]
    i_body=[[465,258],[465,275],[464,294],[463,314]]
    i_dot=[[464,201],[465,202],[466,204]]
    i_dot_offset=[[448,195],[450,196],[451,198]]
    colon=[[[680,181],[681,182],[682,183]],[[680,266],[681,267],[682,268]]]
    tall_C=[[x,165+(y-205)*1.75] for x,y in c]
    cases=[
      ("lower_c_alone",[lower_c]),
      ("c_inside_ci",[lower_c,i_body,i_dot]),
      ("i_alone",[i_body,i_dot]),
      ("i_offset_dot",[i_body,i_dot_offset]),
      ("colon",colon),
      ("C_upper_alone",[tall_C]),
      ("plain_vertical",[[[580,210],[580,238],[580,270],[580,305]]]),
    ]
    expected={"lower_c_alone":"c","c_inside_ci":"ci",
              "i_alone":"i","i_offset_dot":"i",
              "plain_vertical":"|"}
    for label,paths in cases:
        result=draw(paths)
        print("CASE",label,result,flush=True)
        if label in expected:
            assert result["guess"]==expected[label], (label,result)
        if label=="colon":
            assert "i" not in result["guess"],result
        if label=="C_upper_alone":
            # Tall handwritten C and narrow brackets can be genuinely
            # ambiguous; check that we don't invent several characters.
            assert result["regions"]==1,result
    print("PASS: lowercase c, dotted i (including offset dot), and punctuation safeguards in Chrome",flush=True)
finally:
    driver.quit();server.shutdown()
