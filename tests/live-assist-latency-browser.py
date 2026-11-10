"""Measure suggestions while the hand is STILL DRAWING, not after release.

Uses real Chrome, offline standalone HTML, actual neural Web Worker.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.common.by import By

opts=Options()
for arg in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
            "--disable-background-networking","--window-size=1440,1000"):
    opts.add_argument(arg)
driver=webdriver.Chrome(options=opts)
try:
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.setBlockedURLs",{"urls":["http://*","https://*"]})
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    driver.set_script_timeout(24)
    cases={
      "c": [[348,236],[321,209],[299,213],[277,241],[268,272],
             [271,298],[279,320],[304,337],[325,338],[350,321]],
      "x": [[470,194],[487,213],[501,232],[516,250],[530,266],[545,283]],
      "h": [[400,180],[400,204],[400,229],[400,252],[400,275],
             [400,296],[400,317],[400,338],[400,360]]
    }
    for name,coords in cases.items():
        driver.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}))")
        result=driver.execute_async_script("""
          const done=arguments[arguments.length-1];
          const canvas=document.getElementById("pad"),rect=canvas.getBoundingClientRect();
          const pts=arguments[0],id=952;
          const send=(kind,x,y)=>{
            canvas.dispatchEvent(new PointerEvent(kind,{bubbles:true,cancelable:true,
              pointerId:id,pointerType:"mouse",buttons:kind==="pointerup"?0:1,
              clientX:rect.left+x*rect.width/1200,
              clientY:rect.top+y*rect.height/550}));
          };
          let first=-1,ticks=0,live=0,maxGap=0,prev=0,maxPoints=0;
          const started=performance.now(),before=window.__inkLivePreviewUpdates||0;
          send("pointerdown",pts[0][0],pts[0][1]);
          const timer=setInterval(()=>{
            ticks++;
            const i=Math.min(pts.length-1,Math.floor(ticks/4));
            const a=pts[i],b=pts[Math.min(pts.length-1,i+1)];
            const frac=(ticks%4)/4;
            const x=a[0]+(b[0]-a[0])*frac;
            const y=a[1]+(b[1]-a[1])*frac;
            send("pointermove",x,y);
            const now=performance.now()-started;
            if((window.__inkGhostPoints||0)>=2){
              if(first<0)first=now;
              maxPoints=Math.max(maxPoints,window.__inkGhostPoints);
              live++;
              maxGap=Math.max(maxGap,now-prev);prev=now;
            }
            if(ticks>=52){
              clearInterval(timer);
              const beforeUp={name:arguments[1],firstMs:first,
                activeTicks:live,totalTicks:ticks,liveUpdates:
                  (window.__inkLivePreviewUpdates||0)-before,
                maxPoints,requests:window.__inkAssistRequests||0,
                ghostBeforeRelease:window.__inkGhostPoints||0,
                error:window.__inkLastGlyphError};
              send("pointerup",x,y);
              setTimeout(()=>{
                done({...beforeUp,ghostAfterRelease:window.__inkGhostPoints||0,
                  label:window.__inkAssistLabel});
              },700);
            }
          },55);
        """,coords,name)
        print("NEURAL_LIVE_LATENCY",result,flush=True)
        assert result["liveUpdates"]>=2,("No sustained neural live updates",name,result)
        assert result["firstMs"]>=0,("No first suggestion",name,result)
        # Thresholds leave headroom for CI load but catch the prior
        # 1.5–2.2 second first preview for x.
        limit=1250 if name=="x" else 700
        assert result["firstMs"]<limit,("Slow first suggestion",name,result)
        assert result["activeTicks"]>=25,("Long empty gaps while drawing",name,result)
        assert result["ghostBeforeRelease"]>=2,("No live preview at release",name,result)
        assert result["ghostAfterRelease"]>=2,(
            "Preview disappeared when pointerup was received",name,result)
    print("PASS: h, c and x have low-latency neural previews that persist through pointerup",flush=True)
finally:
    driver.quit()
