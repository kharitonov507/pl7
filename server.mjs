import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, statSync, existsSync, writeFileSync, createReadStream, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { randomUUID, createHash, timingSafeEqual } from 'node:crypto';
import { createXiboClientFromEnv, normalizeXiboDisplay, normalizeXiboCatalog } from './integrations/xibo-client.mjs';

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, 'public');
const allowedMime = new Set(['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm']);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.webm': 'video/webm', '.json': 'application/json' };
const fail = (status, message) => Object.assign(new Error(message), { status });
function json(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}
async function body(req, limit = 256 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw fail(413, 'Файл или запрос слишком большой');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function parse(req) {
  try { return JSON.parse((await body(req)).toString()); }
  catch (error) { if (error.status) throw error; throw fail(400, 'Некорректный JSON'); }
}
function signatureValid(buffer, type) {
  if (type === 'image/png') return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (type === 'image/jpeg') return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (type === 'image/webp') return buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP';
  if (type === 'video/mp4') return buffer.toString('ascii', 4, 8) === 'ftyp';
  return buffer.subarray(0, 4).equals(Buffer.from([26, 69, 223, 163]));
}
function sendFile(req, res, file, type) {
  const size = statSync(file).size;
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
  if (req.headers.range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range);
    let start = match?.[1] ? Number(match[1]) : 0;
    let end = match?.[2] ? Number(match[2]) : size - 1;
    if (match && !match[1] && match[2]) { start = Math.max(0, size - Number(match[2])); end = size - 1; }
    end = Math.min(end, size - 1);
    if (!match || start > end || start >= size || start < 0) {
      res.writeHead(416, { 'Content-Range': `bytes */${size}` }); res.end(); return;
    }
    res.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
    if (req.method === 'HEAD') res.end(); else createReadStream(file, { start, end }).pipe(res);
  } else {
    res.writeHead(200, { ...headers, 'Content-Length': size });
    if (req.method === 'HEAD') res.end(); else createReadStream(file).pipe(res);
  }
}

export function createApp({ dataDir = process.env.DOOH_DATA_DIR || path.join(root, 'data'), deviceToken = process.env.DOOH_CMS_TOKEN || '', xiboClient = createXiboClientFromEnv() } = {}) {
  mkdirSync(path.join(dataDir, 'media'), { recursive: true });
  const db = new DatabaseSync(path.join(dataDir, 'dooh.sqlite'));
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
    CREATE TABLE IF NOT EXISTS assets (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, url TEXT NOT NULL, size INTEGER NOT NULL, sha256 TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS playlists (id TEXT PRIMARY KEY, name TEXT NOT NULL, items TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, name TEXT NOT NULL, location TEXT NOT NULL, playlist_id TEXT NOT NULL, fallback_id TEXT NOT NULL, starts_at TEXT, ends_at TEXT, version INTEGER NOT NULL DEFAULT 1, simulated_offline INTEGER NOT NULL DEFAULT 0, last_seen TEXT, state TEXT NOT NULL DEFAULT '{}', command_seq INTEGER NOT NULL DEFAULT 0, command TEXT);
    CREATE TABLE IF NOT EXISTS events (event_id TEXT PRIMARY KEY, device_id TEXT NOT NULL REFERENCES devices(id), asset_id TEXT NOT NULL REFERENCES assets(id), session_id TEXT NOT NULL, kind TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL, played_ms INTEGER NOT NULL, detail TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS events_time ON events(received_at);
    CREATE TABLE IF NOT EXISTS external_devices (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL,
      status TEXT NOT NULL, authorized INTEGER NOT NULL DEFAULT 0, last_seen TEXT, current_content TEXT NOT NULL DEFAULT '',
      synced_at TEXT NOT NULL, raw_json TEXT NOT NULL, PRIMARY KEY(provider, external_id)
    );
    CREATE TABLE IF NOT EXISTS integration_state (
      provider TEXT PRIMARY KEY, last_sync TEXT, last_error TEXT NOT NULL DEFAULT '', item_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS external_catalog (
      provider TEXT NOT NULL, kind TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT '', synced_at TEXT NOT NULL, raw_json TEXT NOT NULL,
      PRIMARY KEY(provider, kind, external_id)
    );
    CREATE INDEX IF NOT EXISTS external_catalog_kind ON external_catalog(provider, kind, name);
    CREATE TABLE IF NOT EXISTS fleet_configs (
      provider TEXT NOT NULL, external_id TEXT NOT NULL, name TEXT NOT NULL, location TEXT NOT NULL,
      playlist_id TEXT NOT NULL, fallback_id TEXT NOT NULL, starts_at TEXT, ends_at TEXT,
      version INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL,
      PRIMARY KEY(provider, external_id)
    );
  `);
  if (!db.prepare('PRAGMA table_info(devices)').all().some(column => column.name === 'renderer_url')) db.exec('ALTER TABLE devices ADD COLUMN renderer_url TEXT');
  const getAsset = db.prepare('SELECT * FROM assets WHERE id=?');
  const getDevice = db.prepare('SELECT * FROM devices WHERE id=?');
  const getPlaylist = db.prepare('SELECT * FROM playlists WHERE id=?');
  for (const [id, name] of [['coffee', 'Кофе / утреннее предложение'], ['city', 'Город / новый маршрут'], ['studio', 'Студия / новый сезон']]) {
    const buffer = readFileSync(path.join(publicDir, 'media', `${id}.svg`));
    db.prepare('INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?)').run(id, name, 'image/svg+xml', `/media/${id}.svg`, buffer.length, createHash('sha256').update(buffer).digest('hex'));
  }
  const hasVideo = existsSync(path.join(publicDir, 'media', 'motion.webm'));
  if (hasVideo) {
    const buffer = readFileSync(path.join(publicDir, 'media', 'motion.webm'));
    db.prepare('INSERT OR IGNORE INTO assets VALUES (?,?,?,?,?,?)').run('motion', 'Идеи в движении / тестовый ролик', 'video/webm', '/media/motion.webm', buffer.length, createHash('sha256').update(buffer).digest('hex'));
  }
  const seeds = [
    ['morning', 'Утренний маршрут', [{ assetId: 'coffee', duration: 8 }, { assetId: 'city', duration: 8 }]],
    ['creative', 'Новый сезон', [{ assetId: 'studio', duration: 10 }, { assetId: 'coffee', duration: 8 }]],
    ['cityloop', 'Городской цикл', [{ assetId: 'city', duration: 7 }, { assetId: 'studio', duration: 9 }]]
  ];
  if (hasVideo) seeds.push(['motion-loop', 'Контент в движении', [{ assetId: 'motion', duration: 8 }, { assetId: 'studio', duration: 8 }]]);
  for (const [id, name, items] of seeds) db.prepare('INSERT OR IGNORE INTO playlists VALUES (?,?,?)').run(id, name, JSON.stringify(items));
  for (const [id, name, location, playlist] of [['screen-01', 'Входная группа', 'Казань · экран 01', 'morning'], ['screen-02', 'Зона ожидания', 'Казань · экран 02', hasVideo ? 'motion-loop' : 'creative'], ['screen-03', 'Проходная', 'Казань · экран 03', 'cityloop']]) {
    db.prepare('INSERT OR IGNORE INTO devices (id,name,location,playlist_id,fallback_id) VALUES (?,?,?,?,?)').run(id, name, location, playlist, 'morning');
  }
  const listPlaylists = () => db.prepare('SELECT * FROM playlists').all().map(p => ({ ...p, items: JSON.parse(p.items) }));
  const manifest = d => ({ deviceId: d.id, name: d.name, version: d.version, serverTime: new Date().toISOString(),
    schedule: { playlistId: d.playlist_id, fallbackId: d.fallback_id, startsAt: d.starts_at, endsAt: d.ends_at },
    playlists: listPlaylists().filter(p => p.id === d.playlist_id || p.id === d.fallback_id),
    assets: db.prepare('SELECT * FROM assets').all(), command: { seq: d.command_seq, action: d.command }
  });
  const snapshot = (goOnly = false) => ({
    devices: db.prepare(`SELECT * FROM devices ${goOnly ? 'WHERE renderer_url IS NOT NULL' : ''} ORDER BY id ${goOnly ? 'LIMIT 100' : ''}`).all().map(d => ({ ...d, state: JSON.parse(d.state), online: !d.simulated_offline && !!d.last_seen && Date.now() - Date.parse(d.last_seen) < 10000 })),
    assets: db.prepare('SELECT * FROM assets').all(), playlists: listPlaylists(),
    events: db.prepare(`SELECT e.*, a.name AS asset_name, d.name AS device_name FROM events e JOIN assets a ON a.id=e.asset_id JOIN devices d ON d.id=e.device_id ${goOnly ? 'WHERE d.renderer_url IS NOT NULL' : ''} ORDER BY e.rowid DESC LIMIT 80`).all(),
    stats: db.prepare(`SELECT count(*) AS total, sum(CASE WHEN kind='completed' THEN 1 ELSE 0 END) AS completed, sum(CASE WHEN kind='failed' THEN 1 ELSE 0 END) AS failed FROM events ${goOnly ? 'WHERE device_id IN (SELECT id FROM devices WHERE renderer_url IS NOT NULL)' : ''}`).get(),
    serverTime: new Date().toISOString()
  });
  const playlistName = id => getPlaylist.get(id)?.name || '';
  const fleetConfig = (provider, externalId) => db.prepare('SELECT * FROM fleet_configs WHERE provider=? AND external_id=?').get(provider, externalId);
  const simulationDefaults = number => ({
    provider: 'simulation', externalId: `sim-${String(number).padStart(3, '0')}`,
    name: `Плеер ${String(number).padStart(3, '0')}`,
    location: `Тестовая площадка ${Math.ceil(number / 10)} · экран ${number}`,
    playlistId: number % 3 === 0 ? 'cityloop' : number % 3 === 1 ? 'morning' : 'creative',
    fallbackId: 'morning', startsAt: null, endsAt: null, version: 1
  });
  const fleetRows = ({ demo = 0, includeReal = false } = {}) => {
    const local = db.prepare('SELECT * FROM devices ORDER BY id').all().map(d => {
      const state = JSON.parse(d.state || '{}');
      return {
        provider: d.renderer_url ? 'native' : 'browser', externalId: d.id, name: d.name, location: d.location,
        status: state.error ? 'error' : (!d.simulated_offline && d.last_seen && Date.now() - Date.parse(d.last_seen) < 10000 ? 'online' : 'offline'),
        authorized: true, lastSeen: d.last_seen, currentContent: state.assetName || playlistName(d.playlist_id), syncedAt: d.last_seen,
        playlistId: d.playlist_id, fallbackId: d.fallback_id, startsAt: d.starts_at, endsAt: d.ends_at, version: d.version, configurable: true, simulated: false
      };
    });
    const external = db.prepare('SELECT * FROM external_devices ORDER BY provider, name').all().map(d => {
      const config = fleetConfig(d.provider, d.external_id);
      return {
        provider: d.provider, externalId: d.external_id, name: config?.name || d.name, location: config?.location || d.location, status: d.status,
        authorized: !!d.authorized, lastSeen: d.last_seen, currentContent: config ? playlistName(config.playlist_id) : d.current_content, syncedAt: d.synced_at,
        playlistId: config?.playlist_id || '', fallbackId: config?.fallback_id || '', startsAt: config?.starts_at || null, endsAt: config?.ends_at || null,
        version: config?.version || 0, configurable: true, simulated: false
      };
    });
    const real = [...local, ...external];
    if (!demo) return real;
    const included = includeReal ? real.slice(0, demo) : [];
    const simulated = Array.from({ length: demo - included.length }, (_, index) => {
      const number = included.length + index + 1;
      const status = number % 17 === 0 ? 'error' : number % 7 === 0 ? 'offline' : 'online';
      const defaults = simulationDefaults(number); const config = fleetConfig('simulation', defaults.externalId); const effective = config ? {
        ...defaults, name: config.name, location: config.location, playlistId: config.playlist_id, fallbackId: config.fallback_id,
        startsAt: config.starts_at, endsAt: config.ends_at, version: config.version
      } : defaults;
      return {
        provider: effective.provider, externalId: effective.externalId, name: effective.name, location: effective.location,
        status, authorized: true,
        lastSeen: status === 'online' ? new Date(Date.now() - (number % 5) * 1000).toISOString() : new Date(Date.now() - number * 60000).toISOString(),
        currentContent: playlistName(effective.playlistId), playlistId: effective.playlistId, fallbackId: effective.fallbackId,
        startsAt: effective.startsAt, endsAt: effective.endsAt, version: effective.version,
        syncedAt: new Date().toISOString(), configurable: true, simulated: true
      };
    });
    return [...included, ...simulated];
  };
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: data:; media-src 'self' blob:; frame-src 'self' http://127.0.0.1:*; connect-src 'self'; object-src 'none'; base-uri 'none'");
    try {
      const url = new URL(req.url, 'http://127.0.0.1'); const route = url.pathname;
      // Optional bootstrap secret for native device ingress only; dashboard is still a local demo.
      if (deviceToken && (route === '/api/devices/register' || /^\/api\/devices\/(?:go-screen-0[123]|go-agent-\d{3})\/(manifest|events|heartbeat)$/.test(route))) {
        const supplied = Buffer.from(req.headers.authorization || ''); const expected = Buffer.from(`Bearer ${deviceToken}`);
        if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw fail(401, 'Нужен токен устройства');
      }
      if (!['GET', 'HEAD', 'POST'].includes(req.method)) throw fail(405, 'Метод не поддерживается');
      if (req.method === 'POST' && req.headers.origin && ![`http://127.0.0.1:${server.address()?.port}`, `http://localhost:${server.address()?.port}`].includes(req.headers.origin)) throw fail(403, 'Недопустимый Origin');
      if (route === '/api/health') return json(res, 200, { ok: true, prototype: true });
      if (route === '/api/integrations/xibo/status' && req.method === 'GET') {
        const state = db.prepare("SELECT * FROM integration_state WHERE provider='xibo'").get();
        const catalogCounts = Object.fromEntries(db.prepare("SELECT kind,count(*) AS count FROM external_catalog WHERE provider='xibo' GROUP BY kind").all().map(row => [row.kind, row.count]));
        return json(res, 200, { ...(xiboClient ? xiboClient.publicInfo() : { configured: false }), lastSync: state?.last_sync || null, lastError: state?.last_error || '', itemCount: state?.item_count || 0, catalogCounts: { media: catalogCounts.media || 0, layout: catalogCounts.layout || 0, campaign: catalogCounts.campaign || 0, schedule: catalogCounts.schedule || 0 } });
      }
      if (route === '/api/integrations/xibo/sync' && req.method === 'POST') {
        if (!xiboClient) throw fail(409, 'Внешняя CMS не настроена. Добавьте локальные реквизиты подключения.');
        try {
          const syncedAt = new Date().toISOString();
          const source = await xiboClient.readSnapshot();
          const displays = source.displays.map(item => normalizeXiboDisplay(item, syncedAt));
          const catalog = [
            ...source.media.map(item => normalizeXiboCatalog('media', item, syncedAt)),
            ...source.layouts.map(item => normalizeXiboCatalog('layout', item, syncedAt)),
            ...source.campaigns.map(item => normalizeXiboCatalog('campaign', item, syncedAt)),
            ...source.schedules.map(item => normalizeXiboCatalog('schedule', item, syncedAt))
          ];
          const upsert = db.prepare('INSERT INTO external_devices (provider,external_id,name,location,status,authorized,last_seen,current_content,synced_at,raw_json) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(provider,external_id) DO UPDATE SET name=excluded.name,location=excluded.location,status=excluded.status,authorized=excluded.authorized,last_seen=excluded.last_seen,current_content=excluded.current_content,synced_at=excluded.synced_at,raw_json=excluded.raw_json');
          const upsertCatalog = db.prepare('INSERT INTO external_catalog (provider,kind,external_id,name,status,synced_at,raw_json) VALUES (?,?,?,?,?,?,?) ON CONFLICT(provider,kind,external_id) DO UPDATE SET name=excluded.name,status=excluded.status,synced_at=excluded.synced_at,raw_json=excluded.raw_json');
          db.exec('BEGIN');
          try {
            for (const d of displays) upsert.run(d.provider, d.externalId, d.name, d.location, d.status, Number(d.authorized), d.lastSeen, d.currentContent, d.syncedAt, JSON.stringify(d.raw));
            for (const item of catalog) upsertCatalog.run(item.provider, item.kind, item.externalId, item.name, item.status, item.syncedAt, JSON.stringify(item.raw));
            db.prepare("DELETE FROM external_devices WHERE provider='xibo' AND synced_at<>?").run(syncedAt);
            db.prepare("DELETE FROM external_catalog WHERE provider='xibo' AND synced_at<>?").run(syncedAt);
            db.prepare("INSERT INTO integration_state(provider,last_sync,last_error,item_count) VALUES('xibo',?,'',?) ON CONFLICT(provider) DO UPDATE SET last_sync=excluded.last_sync,last_error='',item_count=excluded.item_count").run(syncedAt, displays.length);
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return json(res, 200, { ok: true, imported: displays.length, catalog: { media: source.media.length, layouts: source.layouts.length, campaigns: source.campaigns.length, schedules: source.schedules.length }, syncedAt });
        } catch (error) {
          db.prepare("INSERT INTO integration_state(provider,last_error) VALUES('xibo',?) ON CONFLICT(provider) DO UPDATE SET last_error=excluded.last_error").run(String(error.message || error).slice(0, 500));
          throw fail(502, `Не удалось синхронизировать внешнюю CMS: ${error.message}`);
        }
      }
      if (route === '/api/integrations/xibo/media' && req.method === 'POST') {
        if (!xiboClient) throw fail(409, 'Внешняя CMS не настроена.');
        const type = req.headers['content-type']?.split(';')[0];
        if (!allowedMime.has(type)) throw fail(415, 'Поддерживаются JPG, PNG, WebP, MP4 и WebM');
        let name; try { name = decodeURIComponent(req.headers['x-filename'] || 'Материал'); } catch { throw fail(400, 'Некорректное имя файла'); }
        name = name.replace(/[\x00-\x1f]/g, '').slice(0, 120);
        const buffer = await body(req, 1024 * 1024 * 1024);
        if (buffer.length < 12 || !signatureValid(buffer, type)) throw fail(415, 'Содержимое файла не соответствует формату');
        try {
          const uploaded = await xiboClient.uploadMedia({ buffer, name, type });
          return json(res, 201, { ok: true, uploaded });
        } catch (error) { throw fail(502, `Не удалось загрузить материал во внешнюю CMS: ${error.message}`); }
      }
      if (route === '/api/integrations/xibo/catalog' && req.method === 'GET') {
        const allowedKinds = new Set(['media', 'layout', 'campaign', 'schedule']);
        const kind = String(url.searchParams.get('kind') || '');
        if (kind && !allowedKinds.has(kind)) throw fail(400, 'Неизвестный тип каталога');
        const q = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('ru-RU').slice(0, 100);
        const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get('pageSize')) || 25));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        let rows = db.prepare(`SELECT kind,external_id,name,status,synced_at FROM external_catalog WHERE provider='xibo' ${kind ? 'AND kind=?' : ''} ORDER BY kind,name`).all(...(kind ? [kind] : []));
        if (q) rows = rows.filter(item => `${item.name} ${item.external_id}`.toLocaleLowerCase('ru-RU').includes(q));
        const pages = Math.max(1, Math.ceil(rows.length / pageSize)); const safePage = Math.min(page, pages);
        return json(res, 200, { items: rows.slice((safePage - 1) * pageSize, safePage * pageSize).map(item => ({ kind: item.kind, externalId: item.external_id, name: item.name, status: item.status, syncedAt: item.synced_at })), total: rows.length, page: safePage, pageSize, pages });
      }
      if (route === '/api/fleet' && req.method === 'GET') {
        const demo = Math.max(0, Math.min(500, Number(url.searchParams.get('demo')) || 0));
        const q = String(url.searchParams.get('q') || '').trim().toLocaleLowerCase('ru-RU').slice(0, 100);
        const status = String(url.searchParams.get('status') || '');
        const provider = String(url.searchParams.get('provider') || '');
        const pageSize = Math.max(10, Math.min(100, Number(url.searchParams.get('pageSize')) || 25));
        const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
        let rows = fleetRows({ demo, includeReal: url.searchParams.get('includeReal') === '1' });
        if (q) rows = rows.filter(d => `${d.name} ${d.externalId} ${d.location}`.toLocaleLowerCase('ru-RU').includes(q));
        if (['online', 'offline', 'error'].includes(status)) rows = rows.filter(d => d.status === status);
        if (provider) rows = rows.filter(d => d.provider === provider);
        const summary = {
          total: rows.length,
          online: rows.filter(d => d.status === 'online').length,
          offline: rows.filter(d => d.status === 'offline').length,
          error: rows.filter(d => d.status === 'error').length,
          real: rows.filter(d => d.provider !== 'simulation').length,
          demo: rows.filter(d => d.provider === 'simulation').length,
          native: rows.filter(d => d.provider === 'native').length,
          browser: rows.filter(d => d.provider === 'browser').length,
          external: rows.filter(d => d.provider === 'xibo').length
        };
        const pages = Math.max(1, Math.ceil(rows.length / pageSize));
        const safePage = Math.min(page, pages);
        return json(res, 200, { items: rows.slice((safePage - 1) * pageSize, safePage * pageSize), page: safePage, pageSize, pages, summary, simulated: !!demo });
      }
      const fleetConfigMatch = /^\/api\/fleet\/([a-z]+)\/([a-zA-Z0-9._-]+)\/config$/.exec(route);
      if (fleetConfigMatch) {
        const [, provider, externalId] = fleetConfigMatch;
        if (!['native', 'browser', 'simulation', 'xibo'].includes(provider)) throw fail(400, 'Неизвестный источник устройства');
        const local = getDevice.get(externalId);
        const expectedLocalProvider = local ? (local.renderer_url ? 'native' : 'browser') : null;
        const external = provider === 'xibo' ? db.prepare('SELECT * FROM external_devices WHERE provider=? AND external_id=?').get(provider, externalId) : null;
        const simulationNumber = provider === 'simulation' && /^sim-\d{3}$/.test(externalId) ? Number(externalId.slice(4)) : 0;
        if ((local && expectedLocalProvider !== provider) || (!local && !external && !(simulationNumber >= 1 && simulationNumber <= 500))) throw fail(404, 'Экран не найден');
        const stored = fleetConfig(provider, externalId);
        const defaults = local ? {
          name: local.name, location: local.location, playlistId: local.playlist_id, fallbackId: local.fallback_id,
          startsAt: local.starts_at, endsAt: local.ends_at, version: local.version
        } : external ? {
          name: external.name, location: external.location, playlistId: stored?.playlist_id || 'morning', fallbackId: stored?.fallback_id || 'morning',
          startsAt: stored?.starts_at || null, endsAt: stored?.ends_at || null, version: stored?.version || 0
        } : simulationDefaults(simulationNumber);
        const current = stored && !local ? {
          name: stored.name, location: stored.location, playlistId: stored.playlist_id, fallbackId: stored.fallback_id,
          startsAt: stored.starts_at, endsAt: stored.ends_at, version: stored.version
        } : defaults;
        if (req.method === 'GET') return json(res, 200, { provider, externalId, ...current, playlists: listPlaylists().map(({ id, name }) => ({ id, name })), delivery: local ? 'player' : 'prototype' });
        if (req.method !== 'POST') throw fail(405, 'Требуется POST');
        const input = await parse(req);
        const name = String(input.name || '').trim(); const location = String(input.location || '').trim();
        const fallbackId = input.fallbackId || current.fallbackId;
        if (!name || name.length > 80 || !location || location.length > 160) throw fail(400, 'Проверьте название и площадку');
        if (!getPlaylist.get(input.playlistId) || !getPlaylist.get(fallbackId)) throw fail(400, 'Плейлист не найден');
        const start = input.startsAt || null; const end = input.endsAt || null;
        if ((start && !Number.isFinite(Date.parse(start))) || (end && !Number.isFinite(Date.parse(end))) || (start && end && Date.parse(start) >= Date.parse(end))) throw fail(400, 'Некорректный интервал расписания');
        if (local) {
          db.prepare('UPDATE devices SET name=?,location=?,playlist_id=?,fallback_id=?,starts_at=?,ends_at=?,version=version+1 WHERE id=?').run(name, location, input.playlistId, fallbackId, start, end, externalId);
          return json(res, 200, { ok: true, delivery: 'player', version: local.version + 1 });
        }
        const updatedAt = new Date().toISOString();
        db.prepare(`INSERT INTO fleet_configs(provider,external_id,name,location,playlist_id,fallback_id,starts_at,ends_at,version,updated_at)
          VALUES(?,?,?,?,?,?,?,?,1,?) ON CONFLICT(provider,external_id) DO UPDATE SET name=excluded.name,location=excluded.location,
          playlist_id=excluded.playlist_id,fallback_id=excluded.fallback_id,starts_at=excluded.starts_at,ends_at=excluded.ends_at,
          version=fleet_configs.version+1,updated_at=excluded.updated_at`).run(provider, externalId, name, location, input.playlistId, fallbackId, start, end, updatedAt);
        return json(res, 200, { ok: true, delivery: 'prototype', version: (stored?.version || 0) + 1 });
      }
      if (route === '/api/state' && req.method === 'GET') return json(res, 200, snapshot(url.searchParams.get('agents') === 'go'));
      if (route === '/api/devices/register' && req.method === 'POST') {
        const input = await parse(req);
        if (!/^(?:go-screen-0[123]|go-agent-\d{3})$/.test(input.deviceId) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 80) throw fail(400, 'Некорректное Go-устройство');
        const expectedPort = input.deviceId.startsWith('go-agent-') ? 8890 + Number(input.deviceId.slice(-3)) : 8790 + Number(input.deviceId.slice(-1));
        if (input.rendererUrl !== `http://127.0.0.1:${expectedPort}/`) throw fail(400, 'Разрешён только локальный мост данного устройства');
        if (!getPlaylist.get(input.playlistId)) throw fail(400, 'Плейлист не найден');
        if (getDevice.get(input.deviceId)) return json(res, 200, { ok: true, existing: true });
        db.prepare('INSERT INTO devices (id,name,location,playlist_id,fallback_id,renderer_url) VALUES (?,?,?,?,?,?)').run(input.deviceId, input.name.trim(), 'Локальный Go-agent', input.playlistId, 'morning', input.rendererUrl);
        return json(res, 201, { ok: true });
      }
      if (route === '/api/report' && req.method === 'GET') {
        const goOnly = url.searchParams.get('agents') === 'go';
        const events = db.prepare(`SELECT * FROM events ${goOnly ? 'WHERE device_id IN (SELECT id FROM devices WHERE renderer_url IS NOT NULL)' : ''} ORDER BY rowid`).all();
        res.setHeader('Content-Disposition', 'attachment; filename="dooh-report.json"');
        return json(res, 200, { generatedAt: new Date().toISOString(), scope: `${goOnly ? 'Native Go' : 'Local DOOH'} prototype; player-reported events, not proof of physical display or audience.`, summary: snapshot(goOnly).stats, devices: snapshot(goOnly).devices, events });
      }
      if (route === '/api/playlists' && req.method === 'POST') {
        const p = await parse(req);
        if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 80 || !Array.isArray(p.items) || p.items.length < 1 || p.items.length > 100) throw fail(400, 'Нужны название и 1–100 материалов');
        for (const item of p.items) if (!getAsset.get(item.assetId) || !Number.isFinite(item.duration) || item.duration < 2 || item.duration > 3600) throw fail(400, 'Материал не найден или длительность вне диапазона 2–3600 секунд');
        const id = randomUUID(); db.prepare('INSERT INTO playlists VALUES (?,?,?)').run(id, p.name.trim(), JSON.stringify(p.items));
        return json(res, 201, { id });
      }
      const playlistDelete = /^\/api\/playlists\/([a-zA-Z0-9._-]+)\/delete$/.exec(route);
      if (playlistDelete && req.method === 'POST') {
        const id = playlistDelete[1]; const playlist = getPlaylist.get(id);
        if (!playlist) throw fail(404, 'Плейлист не найден');
        const deviceUsage = db.prepare('SELECT count(*) AS count FROM devices WHERE playlist_id=? OR fallback_id=?').get(id, id).count;
        const draftUsage = db.prepare('SELECT count(*) AS count FROM fleet_configs WHERE playlist_id=? OR fallback_id=?').get(id, id).count;
        if (deviceUsage || draftUsage) throw fail(409, `Плейлист используется в ${deviceUsage + draftUsage} настройках экранов. Сначала назначьте другой плейлист.`);
        db.prepare('DELETE FROM playlists WHERE id=?').run(id);
        return json(res, 200, { ok: true });
      }
      if (route === '/api/assets' && req.method === 'POST') {
        const type = req.headers['content-type']?.split(';')[0];
        if (!allowedMime.has(type)) throw fail(415, 'Поддерживаются JPG, PNG, WebP, MP4 и WebM');
        let name; try { name = decodeURIComponent(req.headers['x-filename'] || 'Материал'); } catch { throw fail(400, 'Некорректное имя файла'); }
        name = name.replace(/[\x00-\x1f]/g, '').slice(0, 120);
        const buffer = await body(req, 1024 * 1024 * 1024);
        if (buffer.length < 12 || !signatureValid(buffer, type)) throw fail(415, 'Содержимое файла не соответствует формату');
        const id = randomUUID(); const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'video/mp4': '.mp4', 'video/webm': '.webm' }[type];
        writeFileSync(path.join(dataDir, 'media', id + ext), buffer, { flag: 'wx' });
        db.prepare('INSERT INTO assets VALUES (?,?,?,?,?,?)').run(id, name, type, `/uploads/${id}${ext}`, buffer.length, createHash('sha256').update(buffer).digest('hex'));
        return json(res, 201, { id, name });
      }
      const assetDelete = /^\/api\/assets\/([a-zA-Z0-9._-]+)\/delete$/.exec(route);
      if (assetDelete && req.method === 'POST') {
        const id = assetDelete[1]; const asset = getAsset.get(id);
        if (!asset) throw fail(404, 'Материал не найден');
        const usage = listPlaylists().filter(playlist => playlist.items.some(item => item.assetId === id));
        if (usage.length) throw fail(409, `Материал используется в плейлистах: ${usage.map(item => item.name).join(', ')}`);
        if (!asset.url.startsWith('/uploads/')) throw fail(409, 'Системный демонстрационный материал нельзя удалить');
        const file = path.join(dataDir, 'media', path.basename(asset.url));
        db.prepare('DELETE FROM assets WHERE id=?').run(id);
        if (existsSync(file)) unlinkSync(file);
        return json(res, 200, { ok: true });
      }
      const match = /^\/api\/devices\/([a-z0-9-]+)\/(manifest|heartbeat|events|config|connection|command)$/.exec(route);
      if (match) {
        const [, id, action] = match; const d = getDevice.get(id);
        if (!d) throw fail(404, 'Экран не найден');
        if (['manifest', 'heartbeat', 'events'].includes(action) && d.simulated_offline) throw fail(503, 'Имитируется отсутствие связи');
        if (action === 'manifest' && req.method === 'GET') return json(res, 200, manifest(d));
        if (req.method !== 'POST') throw fail(405, 'Требуется POST');
        const input = await parse(req);
        if (action === 'heartbeat') {
          const state = { assetId: typeof input.assetId === 'string' ? input.assetId.slice(0, 100) : null, assetName: String(input.assetName || '').slice(0, 120), paused: !!input.paused, queue: Math.max(0, Math.min(100000, Number(input.queue) || 0)), cacheCount: Number(input.cacheCount) || 0, playlistName: String(input.playlistName || '').slice(0, 80), error: String(input.error || '').slice(0, 240) };
          db.prepare('UPDATE devices SET last_seen=?,state=? WHERE id=?').run(new Date().toISOString(), JSON.stringify(state), id);
        } else if (action === 'events') {
          if (!Array.isArray(input.events) || input.events.length > 500) throw fail(400, 'Некорректный пакет событий');
          for (const e of input.events) {
            if (!['started', 'completed', 'interrupted', 'failed'].includes(e.kind) || typeof e.eventId !== 'string' || e.eventId.length > 100 || typeof e.sessionId !== 'string' || e.sessionId.length > 100 || !getAsset.get(e.assetId) || !Number.isFinite(Date.parse(e.occurredAt)) || !Number.isFinite(e.playedMs) || e.playedMs < 0 || e.playedMs > 86400000) throw fail(400, 'Некорректное событие воспроизведения');
          }
          const insert = db.prepare('INSERT OR IGNORE INTO events VALUES (?,?,?,?,?,?,?,?,?)');
          db.exec('BEGIN');
          try {
            for (const e of input.events) insert.run(e.eventId, id, e.assetId, e.sessionId, e.kind, e.occurredAt, new Date().toISOString(), Math.round(e.playedMs), String(e.detail || '').slice(0, 240));
            db.exec('COMMIT');
          } catch (error) { db.exec('ROLLBACK'); throw error; }
          return json(res, 200, { acknowledged: input.events.map(e => e.eventId) });
        } else if (action === 'connection') {
          if (typeof input.offline !== 'boolean') throw fail(400, 'Нужен параметр offline');
          db.prepare('UPDATE devices SET simulated_offline=? WHERE id=?').run(Number(input.offline), id);
        } else if (action === 'command') {
          if (!['pause', 'resume', 'next', 'restart'].includes(input.action)) throw fail(400, 'Неизвестная команда');
          db.prepare('UPDATE devices SET command_seq=command_seq+1,command=? WHERE id=?').run(input.action, id);
        } else if (action === 'config') {
          if (!getPlaylist.get(input.playlistId) || !getPlaylist.get(input.fallbackId || d.fallback_id)) throw fail(400, 'Плейлист не найден');
          const start = input.startsAt || null; const end = input.endsAt || null;
          if ((start && !Number.isFinite(Date.parse(start))) || (end && !Number.isFinite(Date.parse(end))) || (start && end && Date.parse(start) >= Date.parse(end))) throw fail(400, 'Некорректный интервал расписания');
          db.prepare('UPDATE devices SET playlist_id=?,fallback_id=?,starts_at=?,ends_at=?,version=version+1 WHERE id=?').run(input.playlistId, input.fallbackId || d.fallback_id, start, end, id);
        }
        return json(res, 200, { ok: true });
      }
      if (route.startsWith('/api/')) throw fail(404, 'API-маршрут не найден');
      if (req.method === 'POST') throw fail(405, 'Метод не поддерживается');
      if (route.startsWith('/uploads/')) {
        const a = db.prepare('SELECT * FROM assets WHERE url=?').get(route);
        if (!a) throw fail(404, 'Материал не найден');
        return sendFile(req, res, path.join(dataDir, 'media', path.basename(a.url)), a.type);
      }
      const file = path.resolve(publicDir, '.' + (route === '/' ? '/index.html' : decodeURIComponent(route)));
      if (!file.startsWith(publicDir + path.sep) || !existsSync(file) || !statSync(file).isFile()) throw fail(404, 'Файл не найден');
      sendFile(req, res, file, mime[path.extname(file)] || 'application/octet-stream');
    } catch (error) {
      if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Внутренняя ошибка сервера' });
      else res.end();
      if (!error.status) console.error(error);
    }
  });
  server.on('close', () => db.close());
  return { server, db };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT || 8787);
  const { server } = createApp();
  server.listen(port, '127.0.0.1', () => console.log(`Player Control: http://127.0.0.1:${port}\nNative mode: /?agents=go · Fleet: /fleet.html?demo=100. Local-only; not a production CMS or Astra validation.`));
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? `Port ${port} is occupied. Close another demo or set PORT.` : error); process.exitCode = 1; });
}
