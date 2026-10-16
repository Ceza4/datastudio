#!/bin/bash
[ -f /home/claude/e2e/mock.pid ] && kill $(cat /home/claude/e2e/mock.pid) 2>/dev/null
for p in $(pgrep -f "node /home/claude/e2e/mock-supa"); do kill $p; done
sleep 0.5
nohup node /home/claude/e2e/mock-supabase.mjs > /home/claude/e2e/mock.log 2>&1 &
echo $! > /home/claude/e2e/mock.pid
sleep 0.8
