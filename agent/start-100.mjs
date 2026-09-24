// Запускает демонстрационный парк из 100 независимых Go-agent процессов.
// Каждый агент имеет свой ID, порт, SQLite-каталог и heartbeat в Player Server.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = path.dirname(fileURLToPath(import.meta.url));
const binary = path.join(directory, 'bin', process.platform === 'win32' ? 'dooh-agent.exe' : 'dooh-agent');
const count = Math.max(1, Math.min(100, Number(process.env.DOOH_AGENT_COUNT || 100)));
const basePort = Number(process.env.DOOH_AGENT_BASE_PORT || 8891);
const server = process.env.DOOH_SERVER_URL || 'http://127.0.0.1:8787';
const playlists = ['motion-loop', 'morning', 'cityloop'];
const children = [];
let shuttingDown = false;
const logDir = path.join(directory, '..', 'tmp', 'agents');
mkdirSync(logDir, { recursive: true });
const configPath = path.join(logDir, 'config.json');
writeFileSync(configPath, JSON.stringify({ ...JSON.parse(readFileSync(path.join(directory, 'config.example.json'), 'utf8')), cms: server }));

if (!existsSync(binary)) {
  console.error('Build agent first: agent/build-agent.cmd');
  process.exit(1);
}

async function startAgent(deviceId, port, playlistId, index) {
  const response = await fetch(`${server}/api/devices/register`, {
    signal: AbortSignal.timeout(10000),
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.DOOH_CMS_TOKEN ? { Authorization: `Bearer ${process.env.DOOH_CMS_TOKEN}` } : {}) },
    body: JSON.stringify({ deviceId, name: `Go-agent ${String(index).padStart(3, '0')}`, playlistId, rendererUrl: `http://127.0.0.1:${port}/` })
  });
  if (!response.ok) return response;
  const log = openSync(path.join(logDir, `${deviceId}.log`), 'a');
  const child = spawn(binary, [
    '-config', configPath,
    '-device', deviceId,
    '-listen', `127.0.0.1:${port}`,
    '-data', path.join(directory, 'data', deviceId),
    '-mqtt-topic', `dooh/player-server/${deviceId}`
  ], { cwd: directory, stdio: ['ignore', log, log], windowsHide: true });
  closeSync(log);
  children.push(child);
  child.on('error', error => { console.error(`${deviceId}: ${error.message}`); shutdown(); process.exitCode = 1; });
  child.on('exit', code => {
    if (!shuttingDown) { console.error(`${deviceId} exited (${code}); see tmp/agents/${deviceId}.log`); shutdown(); process.exitCode = 1; }
  });
  return response;
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) child.kill('SIGTERM');
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

try {
  const health = await fetch(`${server}/api/health`, { signal: AbortSignal.timeout(1500) });
  if (!health.ok) throw new Error(`Player Server returned HTTP ${health.status}`);
  for (let index = 1; index <= count; index += 1) {
    const deviceId = `go-agent-${String(index).padStart(3, '0')}`;
    const response = await startAgent(deviceId, basePort + index - 1, playlists[(index - 1) % playlists.length], index);
    if (!response.ok) throw new Error(`Registration failed for ${deviceId}: HTTP ${response.status}`);
    await new Promise(resolve => setTimeout(resolve, 35));
  }
  console.log(`Player Server demo fleet: ${count} Go-agent processes started.`);
  console.log(`Fleet registry: ${server}/fleet.html`);
  console.log('Ctrl+C stops the agents started by this launcher.');
} catch (error) {
  console.error(`100-agent startup failed: ${error.message}`);
  shutdown();
  process.exitCode = 1;
}
