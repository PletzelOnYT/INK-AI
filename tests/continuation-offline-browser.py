"""Test the actual neural pen extension from a standalone offline HTML in Chrome."""
import time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

opt=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,1000","--disable-background-networking"):
    opt.add_argument(flag)
driver=webdriver.Chrome(options=opt)
try:
    driver.execute_cdp_cmd("Network.enable",{})
    driver.execute_cdp_cmd("Network.setBlockedURLs",{"urls":["http://*","https://*"]})
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,70)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    assert driver.execute_script("return window.__inkRecognitionVersion in (3,5)")
    assert driver.execute_script("return window.__inkDictionaryWords===10000")
    assert driver.execute_script("return window.__inkAssistModel==='online-stroke-gru'")
    assert len(driver.find_elements(By.TAG_NAME,"button"))==3
    assert not driver.find_elements(By.ID,"acceptCorrection")
    print("PASS: standalone HTML runs offline with original minimal tools",flush=True)
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    wait.until(lambda d:d.execute_script("return window.__inkFallbackReady===true"))
    stem=[[289,130],[289,157],[289,185],[289,213],
          [289,243],[288,275],[288,307],[288,335],[288,360]]
    shoulder=[[288,255],[299,250],[310,247],[325,244],
              [340,248],[356,258],[369,272],[378,285]]
    driver.execute_script("""
    const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
    arguments[0].forEach((points,j)=>{
      points.forEach(([x,y],i)=>{
        const type=i===0?"pointerdown":i===points.length-1?"pointerup":"pointermove";
        cv.dispatchEvent(new PointerEvent(type,{
          bubbles:true,cancelable:true,pointerId:920+j,pointerType:"mouse",
          buttons:type==="pointerup"?0:1,
          clientX:r.left+x/1200*r.width,clientY:r.top+y/550*r.height
        }));
      });
    });
    """,[stem,shoulder])
    wait.until(lambda d:d.execute_script("return window.__inkAssistLabel==='h' && window.__inkGhostPoints>=3"))
    info=driver.execute_script("""
      const c=document.getElementById("ghost"),p=c.getContext("2d").getImageData(0,0,c.width,c.height).data;
      let count=0,maxAlpha=0,channelDiff=0;
      for(let i=0;i<p.length;i+=4)if(p[i+3]){
        count++;maxAlpha=Math.max(maxAlpha,p[i+3]);
        channelDiff=Math.max(channelDiff,Math.abs(p[i]-p[i+1]),Math.abs(p[i+1]-p[i+2]));
      }
      return {points:window.__inkGhostPoints,segments:window.__inkGhostSegments,
        source:window.__inkGhostSource,down:window.__inkGhostTailDy,
        count,maxAlpha,channelDiff,model:window.__inkGlyphVersion};
    """)
    assert info["source"]=="neural-stroke-sequence",info
    assert info["points"]>=3 and info["segments"]>=1,info
    assert info["down"]>.06,"Lowercase h must descend, not grow a flat tail"
    assert info["count"]>15 and info["channelDiff"]<=2,info
    assert 10<=info["maxAlpha"]<=100, ("Ghost ink should be translucent", info)
    before=driver.execute_script("return document.getElementById('pad').toDataURL()")
    ActionChains(driver).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedVectorCount>=1"))
    after=driver.execute_script("return document.getElementById('pad').toDataURL()")
    assert before!=after,"G must append genuine pen trajectories to the existing ink"
    print("PASS: offline CNN + true GRU h continuation, translucent gray overlay, G appends vectors",flush=True)
finally:
    driver.quit()
