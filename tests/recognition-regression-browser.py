"""Regression: user's exact roof-shaped one-stroke drawing must NOT become a word."""
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
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):opts.add_argument(flag)
browser=webdriver.Chrome(options=opts)
try:
    browser.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(browser,40)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    def draw(paths):
        browser.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));")
        browser.execute_script("""
        const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
        for(const pts of arguments[0]){
            const pointerId=523;
            for(let j=0;j<pts.length;j++){
                const p=pts[j],type=j===0?'pointerdown':j===pts.length-1?'pointerup':'pointermove';
                const evt=new PointerEvent(type,{
                    bubbles:true,cancelable:true,pointerId,pointerType:'mouse',
                    buttons:type==='pointerup'?0:1,
                    clientX:r.left+p[0]*r.width/1200,
                    clientY:r.top+p[1]*r.height/550
                });
                cv.dispatchEvent(evt);
            }
        }
        """,paths)
        wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
        return browser.execute_script("return {guess:document.getElementById('guess').textContent,regions:window.__inkDetectedRegions};")
    # Approximate exact path from the user screenshot, not a synthetic font.
    roof=[[335,251],[388,218],[440,183],[492,145],[544,117],[596,97],
          [617,100],[670,128],[726,161],[779,188],[831,213],[866,239]]
    res=draw([roof]);print("USER SCREENSHOT ROOF:",res,flush=True)
    assert res["regions"]==1,"A single continuous roof stroke was split into characters"
    assert res["guess"]=="^","A caret should be read as one caret, not a string"
    # A long continuous V glyph should also remain exactly one region.
    v=[[200,110],[242,149],[280,193],[321,231],[362,275],[400,310],
       [438,273],[479,230],[520,188],[560,149],[595,112]]
    res=draw([v]);print("ONE-STROKE V:",res,flush=True)
    assert res["regions"]==1
    assert len(res["guess"])==1
    # A stroke with many x positions but only one continuous connected line.
    zig=[[100,300],[160,250],[220,299],[280,248],[340,295],
         [400,247],[460,298],[520,250],[580,297],[640,249],
         [700,295]]
    res=draw([zig]);print("ONE-STROKE ZIGZAG:",res,flush=True)
    assert res["regions"]==1
    assert len(res["guess"])==1
    # A zigzag may be an ambiguous character, but shouldn't trigger the
    # deterministic *single roof* rule just because one peak is higher.
    assert browser.execute_script("return window.__inkShapeOverride")=="" or res["guess"]!="^",res
    # Multiple detached marks on one glyph must stay grouped.
    equal=[
        [[270,205],[350,205]],
        [[270,247],[350,247]]
    ]
    res=draw(equal);print("EQUALS SIGN BARS:",res,flush=True)
    assert res["regions"]==1
    colon=[
        [[440,194],[448,194]],
        [[440,244],[448,244]]
    ]
    res=draw(colon);print("COLON DOTS:",res,flush=True)
    assert res["regions"]==1
    # Conversely independent, widely spaced pen strokes may form characters.
    multi=[
        [[145,160],[145,250]],
        [[445,160],[445,250]],
        [[745,160],[745,250]]
    ]
    res=draw(multi);print("THREE SEPARATE GLYPHS:",res,flush=True)
    assert res["regions"]==3
    assert len(res["guess"])<=5
    print("PASS: screenshot roof, continuous zigzag and independent glyph count regression",flush=True)
finally:
    browser.quit();server.shutdown()
