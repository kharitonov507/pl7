@echo off
cd /d "%~dp0"
if exist "..\.tools\go\bin\go.exe" (
  "..\.tools\go\bin\go.exe" build -o bin\dooh-agent.exe .
) else (
  go build -o bin\dooh-agent.exe .
)
if errorlevel 1 (
  echo Build failed.
  pause
  exit /b 1
)
echo Build ready. Run start-go-demo.cmd in the parent folder.
pause
