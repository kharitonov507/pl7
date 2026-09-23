@echo off
cd /d "%~dp0"
node --version >nul 2>&1
if errorlevel 1 (
  echo Install Node.js 24 LTS first.
  pause
  exit /b 1
)
echo Open http://127.0.0.1:8787 in your browser.
echo Keep this window open. Ctrl+C stops the demo.
node server.mjs
pause
