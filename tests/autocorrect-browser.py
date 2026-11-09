"""Real offline Chrome test for whole-letter autocorrect, G, button, and undo."""
from pathlib import Path
import time
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait
opt=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
             "--window-size=1440,1000","--disable-background-networking"):
    opt.add_argument(flag)
browser=webdriver.Chrome(options=opt)
try:
    browser.execute_cdp_cmd("Network.enable",{})
    browser.execute_cdp_cmd("Network.setBlockedURLs",{"urls":["http://*","https://*"]})
    browser.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(browser,50)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    assert browser.execute_script("return window.__inkRecognitionVersion===3")
    assert browser.execute_script("return window.__inkDictionaryWords>=9500")
    assert browser.execute_script("return window.__inkAssistModel==='cnn-word-autocorrect'")
    print("PASS: CNN and English dictionary load in offline file",flush=True)
    browser.find_element(By.ID,"assist").click()
    def draw(paths):
        browser.execute_script("""
        const cv=document.getElementById('pad'),r=cv.getBoundingClientRect();
        arguments[0].forEach((points,j)=>{
          points.forEach(([x,y],i)=>{
            let type=i===0?"pointerdown":i===points.length-1?"pointerup":"pointermove";
            cv.dispatchEvent(new PointerEvent(type,{
              bubbles:true,cancelable:true,pointerId:733+j,pointerType:"mouse",
              buttons:type==="pointerup"?0:1,
              clientX:r.left+x/1200*r.width,clientY:r.top+y/550*r.height
            }));
          });
        });
        """,paths)
    draw([[[270,205],[315,205],[370,205]],[[270,258],[315,258],[370,258]]])
    wait.until(lambda d:d.execute_script("return window.__inkAssistLabel==='='"))
    assert browser.execute_script("return window.__inkGhostSource==='complete-character-correction'")
    assert len(browser.find_elements(By.TAG_NAME,"button"))==3
    assert not browser.find_elements(By.ID,"acceptCorrection")
    # Ghost is softly shaded gray with a transparent background, not blue
    # or a white opaque rectangle that covers the actual handwriting.
    ghost=browser.execute_script("""
        const c=document.getElementById('ghost');
        const px=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        let count=0,alphaMax=0,blueTint=0;
        for(let i=0;i<px.length;i+=4){
          if(px[i+3]>0){
            count++;alphaMax=Math.max(alphaMax,px[i+3]);
            blueTint=Math.max(blueTint,Math.abs(px[i]-px[i+1]),
              Math.abs(px[i+1]-px[i+2]));
          }
        }
        return {count,alphaMax,blueTint};
    """)
    assert ghost["count"]>0,ghost
    assert 1<=ghost["alphaMax"]<=110,ghost
    assert ghost["blueTint"]<=3,ghost
    before=browser.execute_script("return document.getElementById('pad').toDataURL()")
    ActionChains(browser).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedCorrections===1"))
    after=browser.execute_script("return document.getElementById('pad').toDataURL()")
    assert before!=after,"G must replace entire handwritten character"
    assert browser.execute_script("return window.__inkGhostPoints===0")
    browser.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'z',ctrlKey:true,bubbles:true}))")
    time.sleep(.1)
    undone=browser.execute_script("return document.getElementById('pad').toDataURL()")
    assert undone==before,"Ctrl+Z must restore original hand-drawn strokes"
    print("PASS: G accepts a full-character correction; Undo restores ink",flush=True)
    browser.execute_script("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}))")
    draw([[[275,175],[275,210],[275,245],[275,280]],
          [[345,175],[345,210],[345,245],[345,280]],
          [[275,226],[310,226],[345,226]]])
    wait.until(lambda d:d.execute_script("return window.__inkSuggestionChoices.length>0"))
    glyph=browser.execute_script("return window.__inkAssistLabel")
    assert len(glyph)==1
    ActionChains(browser).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedCorrections===2"))
    print("PASS: second complete character",repr(glyph),"accepted using G without bottom controls",flush=True)
finally:
    browser.quit()
