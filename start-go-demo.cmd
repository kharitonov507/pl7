@echo off
cd /d "%~dp0"
echo Legacy 3-agent demo. For the final presentation use start-100-go-agents.cmd instead.
node --env-file-if-exists=.env.local agent/start-demo.mjs
pause
