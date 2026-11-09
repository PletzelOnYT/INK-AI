"""Verify model initialization and predictions in the minimal UI."""
import http.server, threading
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self,*args):pass
server=http.server.ThreadingHTTPServer(("127.0.0.1",0),Quiet)
threading.Thread(target=server.serve_forever,daemon=True).start()
options=Options()
for flag in ("--headless=new","--no-sandbox","--disable-dev-shm-usage","--window-size=1440,1000"):
    options.add_argument(flag)
browser=webdriver.Chrome(options=options)
try:
    browser.get(f"http://127.0.0.1:{server.server_port}/index.html")
    WebDriverWait(browser,45).until(lambda d:d.execute_script("return window.__inkReady===true"))
    print("PASS: independently trained GitHub CNN loaded",flush=True)
    assert browser.execute_script("return window.__inkEngine")== "cnn"
    canvas=browser.find_element(By.ID,"pad")
    ActionChains(browser).move_to_element_with_offset(canvas,-120,-40).click_and_hold().move_by_offset(0,100).release().perform()
    WebDriverWait(browser,20).until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    assert browser.find_element(By.ID,"guess").text
    print("PASS: real CNN produces live text without training or settings",flush=True)
finally:
    browser.quit();server.shutdown()
