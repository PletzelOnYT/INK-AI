"""End-to-end smoke test: INK AI must work even while GitHub weights are 404."""
import os,time
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

opt=Options()
opt.add_argument("--headless=new")
opt.add_argument("--no-sandbox")
opt.add_argument("--disable-dev-shm-usage")
opt.add_argument("--window-size=1440,1100")
# No external weights are necessary to pass fallback test.
driver=webdriver.Chrome(options=opt)
try:
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,45)
    wait.until(lambda d:"BASIC RECOGNITION ACTIVE" in d.find_element(By.ID,"status").text or "LIVE · YOUR OWN MODEL" in d.find_element(By.ID,"status").text)
    print("PASS: status",driver.find_element(By.ID,"status").text,flush=True)
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-130,-25).click_and_hold().move_by_offset(0,90).release().perform()
    wait.until(lambda d: d.find_element(By.ID,"glyphCount").text != "0 characters")
    print("PASS: recognition",repr(driver.find_element(By.ID,"output").text),flush=True)
    correction=driver.find_element(By.ID,"correct")
    correction.clear();correction.send_keys("I")
    driver.find_element(By.ID,"fineTune").click()
    wait.until(lambda d:d.find_element(By.ID,"tunedCount").text=="1")
    print("PASS: correction saved; count=1",flush=True)
    driver.find_element(By.ID,"clear").click()
    wait.until(lambda d: d.find_element(By.ID,"glyphCount").text=="0 characters")
    print("PASS: clear",flush=True)
finally:driver.quit()
