#!/usr/bin/env python3
"""Test the actual single-file Camera UI in Chrome without a physical webcam.
Uses a synthetic canvas MediaStream; no server, external API or user footage.
"""
from pathlib import Path
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.support.ui import WebDriverWait

opts=Options()
for arg in ("--headless=new","--no-sandbox","--disable-dev-shm-usage",
            "--autoplay-policy=no-user-gesture-required",
            "--window-size=1400,950"):
    opts.add_argument(arg)
driver=webdriver.Chrome(options=opts)
try:
    driver.get(Path("index.html").resolve().as_uri())
    wait=WebDriverWait(driver,75)
    wait.until(lambda d:d.execute_script(
        "return !!window.__inkEnterCameraMode && !!window.InkOfflineCamera"))
    driver.execute_script("""
      const input=document.createElement("canvas");
      input.width=960;input.height=540;
      const context=input.getContext("2d");
      let frame=0;
      function render(){
       frame++;
       context.fillStyle="#f6f6f4";context.fillRect(0,0,960,540);
       context.fillStyle="#111";context.font="bold 75px Arial";
       context.fillText("NY THREADS",140,210);
       context.font="36px Arial";context.fillText("The quick brown fox.",145,285);
       context.fillStyle="#777";context.fillRect(frame%900,430,20,12);
      }
      render();
      const timer=setInterval(render,90);
      const media=input.captureStream(12);
      Object.defineProperty(navigator.mediaDevices,"getUserMedia",{
        configurable:true,value:async()=>media
      });
      window.__inkUiTest={media,input,timer};
    """)
    driver.execute_script("document.getElementById('camera').click()")
    wait.until(lambda d:d.execute_script(
       "return window.__inkCameraActive && document.getElementById('cameraVideo').readyState>=2"))
    assert driver.execute_script("""
      return ['pen','eraser','assist'].every(id=>
        document.getElementById(id).getAttribute('aria-pressed')==='false') &&
        document.getElementById('camera').getAttribute('aria-pressed')==='true' &&
        document.getElementById('guess').dataset.camera==='true';
    """),"Camera must deselect all drawing tools and use document text formatting"
    def key_c():
        driver.execute_script("""
         window.dispatchEvent(new KeyboardEvent('keydown',{
           key:'c',bubbles:true,cancelable:true
         }))
        """)
    key_c()
    assert driver.execute_script("""
      const frozen=document.getElementById('cameraFrozen');
      return window.__inkCameraFrozen &&
        document.querySelector('.board').classList.contains('camera-frozen') &&
        frozen.width>0&&frozen.height>0;
    """),"C must freeze actual camera pixels in the same board"
    # A tab becoming hidden must no longer call stop(): keep capture stream,
    # frozen pixels, transcript and active tool state.
    driver.execute_script("""
       Object.defineProperty(document,'hidden',{configurable:true,get:()=>true});
       document.dispatchEvent(new Event('visibilitychange'));
    """)
    assert driver.execute_script("""
      return window.__inkCameraActive&&window.__inkCameraFrozen &&
       window.__inkUiTest.media.getVideoTracks()[0].readyState==='live' &&
       document.getElementById('camera').getAttribute('aria-pressed')==='true';
    """),"Switching away must not stop the camera or lose its state"
    driver.execute_script("""
       Object.defineProperty(document,'hidden',{configurable:true,get:()=>false});
       document.dispatchEvent(new Event('visibilitychange'));
    """)
    assert driver.execute_script("return window.__inkCameraActive&&window.__inkCameraFrozen"),(
        "Returning to tab must retain the frozen frame")
    key_c()
    assert driver.execute_script("""
      return window.__inkCameraActive&&!window.__inkCameraFrozen &&
       !document.querySelector('.board').classList.contains('camera-frozen');
    """),"Second C must return to live video"
    driver.execute_script("document.getElementById('pen').click()")
    assert driver.execute_script("""
      return !window.__inkCameraActive &&
       document.getElementById('pen').getAttribute('aria-pressed')==='true' &&
       document.getElementById('camera').getAttribute('aria-pressed')==='false';
    """),"Pen must exit camera and restore the pen"
    driver.execute_script("document.getElementById('assist').click()")
    assert driver.execute_script("return window.__inkAssistEnabled"),"Assist activation failed"
    driver.execute_script("document.getElementById('camera').click()")
    wait.until(lambda d:d.execute_script("return window.__inkCameraActive"))
    assert driver.execute_script("""
      return !window.__inkAssistEnabled &&
       document.getElementById('assist').getAttribute('aria-pressed')==='false';
    """),"Camera must disable Assist while selected"
    driver.execute_script("document.getElementById('camera').click()")
    assert driver.execute_script("""
      return !window.__inkCameraActive && window.__inkAssistEnabled &&
       document.getElementById('assist').getAttribute('aria-pressed')==='true';
    """),"Previous Assist state should be restored on exiting Camera"
    print("PASS: C camera freeze/resume, tab persistence, exclusive tool icons and Assist restoration")
finally:
    try:
        driver.execute_script("""
          if(window.__inkUiTest)clearInterval(window.__inkUiTest.timer);
          window.__inkStopCamera?.();
        """)
    except Exception:
        pass
    driver.quit()
