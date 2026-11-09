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
    assert browser.find_element(By.ID,"acceptCorrection").is_enabled()
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
    browser.find_element(By.ID,"acceptCorrection").click()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedCorrections===2"))
    print("PASS: complete character",repr(glyph),"accepted with on-screen button",flush=True)
finally:
    browser.quit()
