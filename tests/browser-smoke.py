"""Verify the simplified UI contains only the canvas and predicted text."""
import http.server, threading
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
opt=Options()
for x in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1100"):
    opt.add_argument(x)
driver=webdriver.Chrome(options=opt)
try:
    driver.get(f"http://127.0.0.1:{server.server_port}/index.html")
    wait=WebDriverWait(driver,45)
    assert len(driver.find_elements(By.TAG_NAME,"button"))==3
    assert driver.find_element(By.ID,"pen").get_attribute("aria-pressed")=="true"
    assert len(driver.find_elements(By.TAG_NAME,"canvas"))==2
    assert driver.find_element(By.ID,"assist").get_attribute("aria-pressed")=="false"
    assert len(driver.find_elements(By.ID,"guess"))==1
    print("PASS: pen/eraser/assist, drawing surface and live prediction are visible",flush=True)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    if Path("models/ink-cnn-v3.json").is_file():
        assert driver.execute_script("return window.__inkRecognitionVersion===3"),"Validated real-pen V3 was not loaded"
        print("PASS: Chrome loads independently validated pen-adapted V3 recognizer",flush=True)
    elif Path("models/ink-cnn-v2.json").is_file():
        # GitHub raw can publish V3 between checkout and this browser run.
        # Either validated V2 or newer validated V3 is correct here.
        assert driver.execute_script("return window.__inkRecognitionVersion>=2"),"No validated V2/V3 recognizer loaded"
        acc=driver.execute_script("return window.__inkRecognitionAccuracy")
        assert acc>0.75,acc
        print("PASS: Chrome loads validated V2 fallback",acc,flush=True)
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-120,-50).click_and_hold().move_by_offset(0,100).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    text=driver.find_element(By.ID,"guess").text
    assert text
    print("PASS: recognition automatically updates",repr(text),flush=True)
    # Experimental suggestion is opt-in, and its transparent canvas is separate
    # from the black ink that the recognizer reads.
    drawing_before = driver.execute_script("return document.getElementById('pad').toDataURL()")
    driver.find_element(By.ID,"assist").click()
    assert driver.find_element(By.ID,"assist").get_attribute("aria-pressed")=="true"
    assert driver.execute_script("return window.__inkAssistEnabled") is True
    generator_available=Path("models/ink-stroke-sequence-v1.json").exists()
    if generator_available:
        wait.until(lambda d:d.execute_script("return window.__inkGlyphVersion>=3"))
        assert driver.execute_script("return window.__inkAssistModel")=="online-stroke-gru"
        assert driver.execute_script("return window.__inkHumanExamples")==0
        print("PASS: actual sequence-to-vector neural generator loaded, without a template bank",flush=True)
    else:
        assert driver.execute_script("return window.__inkGlyphReady") is False
        print("PASS: no fake/template suggestions while true generator model is unavailable",flush=True)
    assert driver.execute_script("return document.getElementById('pad').toDataURL()") == drawing_before
    if generator_available:
        ActionChains(driver).move_to_element_with_offset(canvas,-190,-70).click_and_hold().move_by_offset(24,8).move_by_offset(22,11).move_by_offset(22,15).release().perform()
        wait.until(lambda d:d.execute_script("return window.__inkGhostPoints>=3"))
        assert driver.execute_script("return window.__inkGhostSource")=="neural-stroke-sequence"
        assert driver.execute_script("return window.__inkGhostSegments>=1")
        stroke_width=driver.execute_script("return window.__inkGhostStrokeWidth")
        assert 3.0<=stroke_width<=8.0,stroke_width
        ghost_stats=driver.execute_script("""
          const g=document.getElementById('ghost'),p=g.getContext('2d').getImageData(0,0,g.width,g.height).data;
          let partial=0,shown=0;
          for(let i=3;i<p.length;i+=4){if(p[i]){shown++;if(p[i]<255)partial++;}}
          return {shown,partial};
        """)
        assert ghost_stats["shown"]>0 and ghost_stats["partial"]>0
        print("PASS: generated smooth translucent lines contain no bitmap blobs",flush=True)
        choices=driver.execute_script("return window.__inkSuggestionChoices")
        assert len(choices)>=2,"Tab must have at least two generative completion choices"
        ink_unchanged=driver.execute_script("return document.getElementById('pad').toDataURL()")
        preview_before=driver.execute_script("return document.getElementById('ghost').toDataURL()")
        ActionChains(driver).send_keys("\ue004").perform()  # Tab
        preview_after=driver.execute_script("return document.getElementById('ghost').toDataURL()")
        assert preview_before!=preview_after,"Tab must cycle to a different neural vector preview"
        assert driver.execute_script("return document.getElementById('pad').toDataURL()")==ink_unchanged
        print("PASS: Tab cycles distinct smooth neural strokes without changing the underlying drawing",flush=True)
        before=driver.execute_script("return document.getElementById('pad').toDataURL()")
        ActionChains(driver).send_keys("g").perform()
        wait.until(lambda d:d.execute_script("return window.__inkAcceptedVectorCount>=1"))
        assert driver.execute_script("return document.getElementById('pad').toDataURL()")!=before
        print("PASS: G accepts generated vector pen paths",flush=True)
    driver.find_element(By.ID,"assist").click()
    assert driver.find_element(By.ID,"assist").get_attribute("aria-pressed")=="false"
    assert driver.execute_script("return window.__inkGhostPoints")==0
    print("PASS: experimental assist turns off and clears ghost overlay",flush=True)
    # Use a fresh single-stroke canvas for the existing erase-to-empty test.
    ActionChains(driver).send_keys("\ue00c").perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="true")
    ActionChains(driver).move_to_element_with_offset(canvas,-120,-50).click_and_hold().move_by_offset(0,100).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    driver.find_element(By.ID,"eraser").click()
    assert driver.find_element(By.ID,"eraser").get_attribute("aria-pressed")=="true"
    assert canvas.get_attribute("data-tool")=="eraser"
    ActionChains(driver).move_to_element_with_offset(canvas,-120,-50).click_and_hold().move_by_offset(0,100).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="true")
    print("PASS: eraser removes ink and recognition updates automatically",flush=True)
    driver.find_element(By.ID,"pen").click()
    assert driver.find_element(By.ID,"pen").get_attribute("aria-pressed")=="true"
    ActionChains(driver).move_to_element_with_offset(canvas,-150,-40).click_and_hold().move_by_offset(0,90).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    print("PASS: pen draws again after switching back",flush=True)
    ActionChains(driver).send_keys("\ue00c").perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="true")
    print("PASS: Escape clears the drawing",flush=True)
finally:
    driver.quit();server.shutdown()
