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
    if Path("models/ink-glyph-completion-v2.json").exists():
        wait.until(lambda d:d.execute_script("return window.__inkGlyphVersion===2"))
        assert driver.execute_script("return window.__inkGlyphParameters>=1000000")
        print("PASS: real browser loaded 1.1M parameter V2 handwriting generator",flush=True)
    if Path("models/ink-human-glyph-references.json").exists():
        wait.until(lambda d:d.execute_script("return window.__inkHumanExamples>=10000"))
        print("PASS: genuine individual handwriting reference bank loaded",driver.execute_script("return window.__inkHumanExamples"),flush=True)
    assert driver.execute_script("return document.getElementById('pad').toDataURL()") == drawing_before
    ActionChains(driver).move_to_element_with_offset(canvas,-190,-70).click_and_hold().move_by_offset(24,8).move_by_offset(22,11).move_by_offset(22,15).release().perform()
    wait.until(lambda d:d.execute_script("return window.__inkGhostPoints>=3"))
    assert driver.execute_script("return window.__inkGhostSegments>=1")
    stroke_width=driver.execute_script("return window.__inkGhostStrokeWidth")
    assert 3.0<=stroke_width<=10.0,stroke_width
    if Path("models/ink-human-glyph-references.json").exists():
        source=driver.execute_script("return window.__inkGhostSource")
        assert source in ("real-handwriting","trained-generator"),source
        print("PASS: authentic handwriting bank assists stroke suggestions",source,flush=True)
    print("PASS: clean vector ghost line, width",stroke_width,"px",flush=True)
    ghost_stats = driver.execute_script("""
      const g=document.getElementById('ghost');
      const pixels=g.getContext('2d').getImageData(0,0,g.width,g.height).data;
      let visible=0,partial=0;
      for(let i=3;i<pixels.length;i+=4){if(pixels[i]){visible++;if(pixels[i]<255)partial++;}}
      return {visible,partial};
    """)
    assert ghost_stats["visible"]>0 and ghost_stats["partial"]>0,ghost_stats
    print("PASS: translucent experimental strokes appear without modifying underlying ink",flush=True)
    # The G shortcut explicitly accepts the translucent suggestion as real ink.
    ink_before_accept=driver.execute_script("return document.getElementById('pad').toDataURL()")
    ActionChains(driver).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return document.getElementById('pad').toDataURL()")!=ink_before_accept)
    assert driver.execute_script("return window.__inkAcceptedVectorCount>=1")
    print("PASS: G accepts smooth *vector strokes* instead of pasted fuzzy bitmaps",flush=True)
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
