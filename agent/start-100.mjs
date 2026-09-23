// Запускает демонстрационный парк из 100 независимых Go-agent процессов.
// Каждый агент имеет свой ID, порт, SQLite-каталог и heartbeat в Player Server.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
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

if (!existsSync(binary)) {
  console.error('Build agent first: agent/build-agent.cmd');
  process.exit(1);
}

async function startAgent(deviceId, port, playlistId, index) {
  const response = await fetch(`${server}/api/devices/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(process.env.DOOH_CMS_TOKEN ? { Authorization: `Bearer ${process.env.DOOH_CMS_TOKEN}` } : {}) },
    body: JSON.stringify({ deviceId, name: `Go-agent ${String(index).padStart(3, '0')}`, playlistId, rendererUrl: `http://127.0.0.1:${port}/` })
  });
  if (!response.ok) return response;
  const child = spawn(binary, [
    '-config', path.join(directory, 'config.example.json'),
    '-device', deviceId,
    '-listen', `127.0.0.1:${port}`,
    '-data', path.join(directory, 'data', deviceId),
    '-mqtt-topic', `dooh/player-server/${deviceId}`
  ], { cwd: directory, stdio: 'ignore', windowsHide: true });
  children.push(child);
  child.on('exit', code => {
    if (!shuttingDown && code) console.error(`${deviceId} exited (${code})`);
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
  }
  console.log(`Player Server demo fleet: ${count} Go-agent processes started.`);
  console.log(`Fleet registry: ${server}/fleet.html`);
  console.log('Ctrl+C stops the agents started by this launcher.');
} catch (error) {
  console.error(`100-agent startup failed: ${error.message}`);
  shutdown();
  process.exitCode = 1;
}
