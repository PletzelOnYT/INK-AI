"""Verify that the *published* CNN loads and recognizes input in a real browser."""
import contextlib
import http.server
import threading
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args): pass

server=http.server.ThreadingHTTPServer(("127.0.0.1",0),QuietHandler)
thread=threading.Thread(target=server.serve_forever,daemon=True)
thread.start()
url=f"http://127.0.0.1:{server.server_port}/index.html"
opts=Options()
opts.add_argument("--headless=new")
opts.add_argument("--no-sandbox")
opts.add_argument("--disable-dev-shm-usage")
opts.add_argument("--window-size=1440,1000")
driver=webdriver.Chrome(options=opts)
try:
    driver.get(url)
    wait=WebDriverWait(driver,45)
    wait.until(lambda d:"LIVE · YOUR OWN MODEL" in d.find_element(By.ID,"status").text)
    print("PASS: downloaded repository CNN and initialized real inference worker",flush=True)
    status=driver.find_element(By.ID,"modelStep").text
    assert status=="Model ready — 100%",status
    assert driver.find_element(By.ID,"modelPercent").text=="100%"
    print("PASS: real model progress reaches 100%",flush=True)
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-120,-45).click_and_hold().move_by_offset(0,95).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"glyphCount").text!="0 characters" and
      d.find_element(By.ID,"reading").text=="LIVE")
    recognized=driver.find_element(By.ID,"output").text
    print("CNN prediction on synthetic browser stroke:",repr(recognized),flush=True)
    assert recognized
    correction=driver.find_element(By.ID,"correct")
    correction.clear();correction.send_keys("I")
    driver.find_element(By.ID,"fineTune").click()
    wait.until(lambda d:d.find_element(By.ID,"tunedCount").text=="1")
    print("PASS: real CNN fine-tuning saved",flush=True)
finally:
    driver.quit()
    server.shutdown()
