#!/bin/bash
[ -f /home/claude/e2e/chrome.pid ] && kill $(cat /home/claude/e2e/chrome.pid) 2>/dev/null; sleep 0.5
rm -rf /home/claude/e2e/profile
LANG=C.UTF-8 LC_ALL=C.UTF-8 nohup /opt/pw-browsers/chromium-1194/chrome-linux/chrome --headless=new --no-sandbox --remote-debugging-port=9333 --user-data-dir=/home/claude/e2e/profile --window-size=1440,900 --no-first-run --no-default-browser-check about:blank > /home/claude/e2e/chrome.log 2>&1 &
echo $! > /home/claude/e2e/chrome.pid
sleep 2; curl -s localhost:9333/json/version | head -3
