"""Verify the simplified UI contains only the canvas and predicted text."""
import http.server, threading
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
    assert len(driver.find_elements(By.TAG_NAME,"button"))==0
    assert len(driver.find_elements(By.TAG_NAME,"canvas"))==1
    assert len(driver.find_elements(By.ID,"guess"))==1
    print("PASS: only a drawing board and guessed text are visible",flush=True)
    wait.until(lambda d:d.execute_script("return window.__inkReady===true"))
    canvas=driver.find_element(By.ID,"pad")
    ActionChains(driver).move_to_element_with_offset(canvas,-120,-50).click_and_hold().move_by_offset(0,100).release().perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="false")
    text=driver.find_element(By.ID,"guess").text
    assert text
    print("PASS: recognition automatically updates",repr(text),flush=True)
    ActionChains(driver).send_keys("\ue00c").perform()
    wait.until(lambda d:d.find_element(By.ID,"guess").get_attribute("data-muted")=="true")
    print("PASS: Escape clears the drawing",flush=True)
finally:
    driver.quit();server.shutdown()
