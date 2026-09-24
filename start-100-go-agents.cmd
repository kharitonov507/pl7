@echo off
cd /d "%~dp0"
echo.
echo Restarting Player Control and its 100 Go agents. CMS is left running.
powershell -NoProfile -ExecutionPolicy Bypass -File tools\restart-demo.ps1 -SkipDocker
pause
