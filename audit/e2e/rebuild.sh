#!/bin/bash
cd /home/claude/datastudio
fuser -k 3100/tcp >/dev/null 2>&1; sleep 1
if ! curl -s -o /dev/null localhost:54321/__dump; then nohup node /home/claude/e2e/mock-supabase.mjs > /home/claude/e2e/mock.log 2>&1 & fi
NEXT_PUBLIC_SUPABASE_URL=http://localhost:54321 NEXT_PUBLIC_SUPABASE_ANON_KEY=e2e-anon npx next build > /home/claude/e2e/build.log 2>&1 || { tail -40 /home/claude/e2e/build.log; exit 1; }
nohup npx next start -p 3100 > /home/claude/e2e/server.log 2>&1 &
echo $! > /home/claude/e2e/server.pid
for i in $(seq 1 30); do curl -s -o /dev/null localhost:3100/ && break; sleep 1; done
echo "server up"
