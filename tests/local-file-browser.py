"""Verify user's actual Mac-like workflow: Chrome opens downloaded index.html via file://."""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1400,1000"):
    options.add_argument(flag)
driver=webdriver.Chrome(options=options)
try:
    url=Path("index.html").resolve().as_uri()
    driver.get(url)
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    assert driver.execute_script("return window.__inkRecognitionVersion>=1")
    print("PASS: local file:// HTML downloads and initializes recognizer",flush=True)
    driver.find_element(By.ID,"assist").click()
    wait.until(lambda d:d.execute_script("return window.__inkGlyphReady===true"))
    assert driver.execute_script("return window.__inkGlyphVersion>=3")
    assert driver.execute_script("return window.__inkHumanExamples===0")
    print("PASS: local file:// HTML downloads actual trained sequence generator",flush=True)
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-180,-65).click_and_hold().move_by_offset(20,14).move_by_offset(20,17).move_by_offset(20,19).release().perform()
    try:
        WebDriverWait(driver,12).until(
            lambda d:d.execute_script("return window.__inkGhostPoints>2"))
    except Exception:
        state=driver.execute_script("""
          return {
           assist:window.__inkAssistEnabled, auto:window.__inkAssistAutoEnabled,
           ready:window.__inkReady, glyphReady:window.__inkGlyphReady,
           requests:window.__inkAssistRequests,
           inflight:window.__inkAssistInFlight,
           options:window.__inkSuggestionChoices,
           ghost:window.__inkGhostPoints,
           liveUpdates:window.__inkLivePreviewUpdates,
           ocrReads:window.__inkAssistOCRReads,
           cacheHits:window.__inkAssistCacheHits,
           lastGuess:window.__inkLastGuess,
           error:window.__inkLastGlyphError,
           version:window.__inkGlyphVersion
          };
        """)
        print("LIVE ASSIST FAILURE DIAGNOSTICS:",state,flush=True)
        raise
    assert driver.execute_script("return window.__inkGhostSource")=="neural-stroke-sequence"
    print("PASS: local file:// draws genuine translucent neural vector preview",flush=True)
    before=driver.execute_script("return document.getElementById('pad').toDataURL()")
    ActionChains(driver).send_keys("g").perform()
    wait.until(lambda d:d.execute_script("return window.__inkAcceptedVectorCount>0"))
    after=driver.execute_script("return document.getElementById('pad').toDataURL()")
    assert after!=before
    print("PASS: locally downloaded HTML accepts generated neural stroke via G",flush=True)
finally:
    driver.quit()
