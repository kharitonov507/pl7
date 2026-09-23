// Separate third-party reference, not the original DOOH Lab implementation.
import { startServer } from '@xiboplayer/proxy';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
const directory = path.dirname(fileURLToPath(import.meta.url));
const configFilePath = path.join(directory, 'player-data/config.json');
const savedConfig = existsSync(configFilePath) ? JSON.parse(readFileSync(configFilePath, 'utf8')) : {};
await startServer({
  port: 8789,
  listenAddress: '127.0.0.1',
  pwaPath: path.join(directory, 'node_modules/@xiboplayer/pwa/dist'),
  appVersion: '0.7.23',
  dataDir: path.join(directory, 'player-data'),
  configFilePath,
  pwaConfig: { cmsUrl: 'http://127.0.0.1:8088', ...savedConfig },
  relaxSslCerts: false,
  allowShellCommands: false,
});
