import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const allowedKeys = new Set(['XIBO_CLIENT_ID', 'XIBO_CLIENT_SECRET']);
const key = process.argv[2];

if (!allowedKeys.has(key)) {
  console.error('Разрешены только XIBO_CLIENT_ID и XIBO_CLIENT_SECRET.');
  process.exit(2);
}

let value = '';
for await (const chunk of process.stdin) value += chunk;
value = value.trim();

if (!value || /[\r\n]/.test(value)) {
  console.error('Получено пустое или некорректное значение.');
  process.exit(3);
}

const targetPath = resolve('.env.local');
const examplePath = resolve('.env.example');
let source;

try {
  source = await readFile(targetPath, 'utf8');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  source = await readFile(examplePath, 'utf8');
}

const line = `${key}=${value}`;
const matcher = new RegExp(`^${key}=.*$`, 'm');
source = matcher.test(source) ? source.replace(matcher, line) : `${source.trimEnd()}\n${line}\n`;

await writeFile(targetPath, source, { encoding: 'utf8', mode: 0o600 });
console.log(`${key} сохранён локально.`);
