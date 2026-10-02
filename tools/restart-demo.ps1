param([switch]$SkipDocker)
$ErrorActionPreference = 'Stop'
$demoRoot = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $demoRoot
$demoLog = Join-Path $demoRoot 'tmp'
New-Item -ItemType Directory -Force $demoLog | Out-Null
# Only this workspace's agent executables and its dedicated launcher are stopped.
$agentExe = Join-Path $demoRoot 'agent\bin\dooh-agent.exe'
$workspaceAgents = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $agentExe })
$launcherIds = @($workspaceAgents | Select-Object -ExpandProperty ParentProcessId -Unique)
if (Test-Path "$demoLog/demo-processes.json") { $launcherIds += (Get-Content "$demoLog/demo-processes.json" -Raw | ConvertFrom-Json).launcher }
$launchers = Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -in $launcherIds -and $_.Name -eq 'node.exe' -and $_.CommandLine -match 'agent[/\\]start-(100|demo)\.mjs' }
foreach ($process in $launchers) { Stop-Process -Id $process.ProcessId -ErrorAction SilentlyContinue }
Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $agentExe } | ForEach-Object { Stop-Process -Id $_.ProcessId -ErrorAction SilentlyContinue }
$listener = Get-NetTCPConnection -LocalPort 8787 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
    if ($serverProcess.Name -ne 'node.exe' -or $serverProcess.CommandLine -notmatch 'server\.mjs') { throw 'Port 8787 is owned by an unexpected process; refusing to stop it.' }
    Stop-Process -Id $serverProcess.ProcessId
}
if (!$SkipDocker) {
    docker compose -f reference-xibo/compose.yaml down
    if ($LASTEXITCODE) { throw 'Docker down failed' }
    docker compose -f reference-xibo/compose.yaml up -d --wait --wait-timeout 180
    if ($LASTEXITCODE) { throw 'Docker up failed' }
    $cmsReady = $false
    for ($i=0; $i -lt 90; $i++) {
        try { $cmsReady = (Invoke-WebRequest http://127.0.0.1:8088/login -UseBasicParsing -TimeoutSec 3).StatusCode -eq 200 } catch {}
        if ($cmsReady) { break }; Start-Sleep -Seconds 2
    }
    if (!$cmsReady) { throw 'CMS login did not become ready; inspect docker compose logs cms-web' }
}
$nodePath = (Get-Command node).Source
# The reference browser uses the wrapper's same-origin XMDS proxy only on localhost.
if (!(Get-NetTCPConnection -LocalPort 8789 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $nodePath -ArgumentList 'reference-xibo/player-server.mjs' -WorkingDirectory $demoRoot -WindowStyle Hidden -RedirectStandardOutput "$demoLog/reference.out.log" -RedirectStandardError "$demoLog/reference.err.log" | Out-Null
}
Write-Host 'Reference playback: keep http://localhost:8789/player/ open in a browser.'
$serverProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env.local server.mjs' -WorkingDirectory $demoRoot -WindowStyle Hidden -RedirectStandardOutput "$demoLog/server.out.log" -RedirectStandardError "$demoLog/server.err.log" -PassThru
$ready = $false
for ($i=0; $i -lt 30; $i++) {
    try { $ready = (Invoke-RestMethod http://127.0.0.1:8787/api/health -TimeoutSec 2).ok } catch {}
    if ($ready) { break }; Start-Sleep -Seconds 1
}
if (!$ready) { throw 'Player Control did not start; see tmp/server.err.log' }
$agentsProcess = Start-Process -FilePath $nodePath -ArgumentList '--env-file-if-exists=.env.local agent/start-100.mjs' -WorkingDirectory $demoRoot -WindowStyle Hidden -RedirectStandardOutput "$demoLog/agents.out.log" -RedirectStandardError "$demoLog/agents.err.log" -PassThru
@{server=$serverProcess.Id; launcher=$agentsProcess.Id; started=(Get-Date).ToUniversalTime().ToString('o')} | ConvertTo-Json | Set-Content "$demoLog/demo-processes.json"
for ($i=0; $i -lt 90; $i++) {
    Start-Sleep -Seconds 1
    $fleet = Invoke-RestMethod 'http://127.0.0.1:8787/api/fleet?scope=go100&pageSize=100' -TimeoutSec 5
    if ($fleet.summary.total -eq 100 -and $fleet.summary.online -eq 100) { Write-Host 'Ready: 100/100 real Go agents online. http://127.0.0.1:8787/?agents=go'; exit 0 }
}
throw "Fleet not ready: $($fleet.summary | ConvertTo-Json -Compress). See tmp/agents*.log and tmp/agents/*.log"
