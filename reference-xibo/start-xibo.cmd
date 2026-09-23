@echo off
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Start Docker Desktop first, then run this file again.
  pause
  exit /b 1
)
docker compose up -d
if errorlevel 1 (
  pause
  exit /b 1
)
echo CMS: http://127.0.0.1:8088
echo Player: http://localhost:8789/player/
echo IMPORTANT: use localhost for the player, not 127.0.0.1.
echo Keep this window open. Ctrl+C stops the player proxy.
node player-server.mjs
pause
