"""Browser acceptance for the independently trained recognizer CNN V5.
Runs against a real built offline HTML preview, not synthetic JS mocks.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.support.ui import WebDriverWait

opts=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
    opts.add_argument(flag)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,60)
    wait.until(lambda d:d.execute_script("return window.__inkReady === true"))
    details=driver.execute_script("""
      const raw=document.getElementById("inkRecognitionModel");
      const model=raw && JSON.parse(raw.textContent);
      return {
        model: model?.training?.finetuned_from,
        version: window.__inkRecognitionVersion,
        accuracy:window.__inkRecognitionAccuracy,
        independent:window.__inkRecognitionPenAccuracy,
        allLabels:model?.labels?.length,
        layers:model?.layers?.length
      };
    """)
    assert details["model"]=="models/ink-cnn-v3.json",details
    assert details["version"]==5,details
    assert details["allLabels"]==102 and details["layers"]==5,details
    assert details["accuracy"]>=.82 and details["independent"]>=.77,details
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-100,-50).click_and_hold().move_by_offset(0,90).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    assert driver.find_element(By.ID,"guess").text.strip(),"V5 returned no handwriting prediction"
    assert driver.execute_script("return window.__inkRecognitionVersion") == 5
    ActionChains(driver).send_keys("\ue00c").perform()  # Escape clears ink
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="true")
    assert driver.execute_script("return window.__inkReady===true"),"V5 worker failed during erase/reload"
    print("PASS: actual file:// browser loads V5 weights, performs CNN inference, and clears safely",details)
finally:
    driver.quit()
