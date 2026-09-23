@echo off
cd /d "%~dp0"
echo Starting Player Server on http://127.0.0.1:8787
echo Keep this window open during the presentation.
node --env-file-if-exists=.env.local server.mjs
pause
