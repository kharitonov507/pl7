@echo off
cd /d "%~dp0"
echo.
echo Before starting: restart the Player Server window once so it loads the 100-agent registration support.
echo Stop the old 3-agent launcher first. Keep this window open during the presentation.
echo Starting 100 Go-agent processes connected to Player Server...
node --env-file-if-exists=.env.local agent/start-100.mjs
pause
