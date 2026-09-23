import { openStore, storeAction } from './db.js';

const deviceId = new URL(location.href).searchParams.get('device') || 'screen-01';
const stage = document.getElementById('stage');
const label = document.getElementById('device-label');
const status = document.getElementById('player-status');
const pauseBadge = document.getElementById('paused');
const api = `/api/devices/${encodeURIComponent(deviceId)}`;
let db, manifest, activePlaylist, current, pointer = 0, paused = false, online = false;
let pending = 0, cacheCount = 0, errorMessage = '', running = false, lastCommand = 0;
let syncing = false, changing = false, alive = true;
let lastTick = performance.now();
let waitingSince = 0;
let releaseLock;
const objectUrls = new Map();
const cachedAssets = new Map();
const get = (store, id) => storeAction(db, store, 'get', id);
const put = (store, value) => storeAction(db, store, 'put', value);
const all = store => storeAction(db, store, 'getAll');
function payload() {
  return { deviceId, online, paused, assetId: current?.asset.id || null, assetName: current?.asset.name || '', playlistName: activePlaylist?.name || '', queue: pending, cacheCount, error: errorMessage, elapsed: current?.playedMs || 0, duration: current?.duration || 0, version: manifest?.version || 0 };
}
function notify() {
  status.textContent = `${online ? 'Связь с Player Server' : 'Локальный кеш'} · ${pending} в очереди`;
  if (parent !== window) parent.postMessage({ type: 'dooh-state', state: payload() }, location.origin);
}
async function request(endpoint, data) {
  const response = await fetch(api + endpoint, data === undefined ? { cache: 'no-store', signal: AbortSignal.timeout(4000) } : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(4000)
  });
  if (!response.ok) throw new Error(`Player Server: ${response.status}`);
  return response.json();
}
async function enqueue(kind, entry, detail = '') {
  if (!entry) return;
  const id = crypto.randomUUID();
  const event = { id, eventId: id, sessionId: entry.sessionId, assetId: entry.asset.id, kind, occurredAt: new Date().toISOString(), playedMs: Math.round(entry.playedMs), detail };
  await put('events', event);
  pending = (await all('events')).length;
  notify();
}
async function digest(blob) {
  const buffer = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer());
  return [...new Uint8Array(buffer)].map(b => b.toString(16).padStart(2, '0')).join('');
}
async function cacheManifest(next) {
  const needed = new Set(next.playlists.flatMap(p => p.items.map(i => i.assetId)));
  for (const asset of next.assets.filter(a => needed.has(a.id))) {
    let stored = await get('assets', asset.id);
    if (!stored || stored.sha256 !== asset.sha256) {
      const response = await fetch(asset.url, { cache: 'no-store', signal: AbortSignal.timeout(60000) });
      if (!response.ok) throw new Error(`Не удалось загрузить ${asset.name}`);
      const blob = await response.blob();
      if (await digest(blob) !== asset.sha256) throw new Error(`Не совпала SHA-256: ${asset.name}`);
      stored = { id: asset.id, sha256: asset.sha256, blob };
      await put('assets', stored);
    }
    cachedAssets.set(asset.id, stored);
  }
  // Publish only after all required files have been cached and verified.
  await put('meta', { id: 'manifest', value: next });
  cacheCount = cachedAssets.size;
}
function choosePlaylist() {
  const s = manifest.schedule; const now = Date.now();
  const inWindow = (!s.startsAt || now >= Date.parse(s.startsAt)) && (!s.endsAt || now < Date.parse(s.endsAt));
  return manifest.playlists.find(p => p.id === (inWindow ? s.playlistId : s.fallbackId));
}
async function stopCurrent(kind = 'interrupted', detail = '') {
  const old = current; current = null;
  if (old) {
    old.element.pause?.(); old.element.onended = null; old.element.onerror = null;
    if (old.started) await enqueue(kind, old, detail);
  }
  await storeAction(db, 'meta', 'delete', 'active');
}
function mediaUrl(assetId) {
  if (!objectUrls.has(assetId)) objectUrls.set(assetId, URL.createObjectURL(cachedAssets.get(assetId).blob));
  return objectUrls.get(assetId);
}
async function advance(kind = 'interrupted', detail = '') {
  if (changing || !manifest || !activePlaylist?.items.length) return;
  changing = true;
  try {
    await stopCurrent(kind, detail);
    const item = activePlaylist.items[pointer % activePlaylist.items.length]; pointer++;
    const asset = manifest.assets.find(a => a.id === item.assetId);
    if (!asset || !cachedAssets.has(asset.id)) throw new Error('Материал отсутствует в локальном кеше');
    const isVideo = asset.type.startsWith('video/');
    const element = document.createElement(isVideo ? 'video' : 'img');
    const entry = { asset, element, sessionId: crypto.randomUUID(), playedMs: 0, duration: item.duration * 1000, started: false };
    current = entry;
    if (isVideo) { element.muted = true; element.playsInline = true; element.preload = 'auto'; }
    else element.alt = asset.name;
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Таймаут декодирования материала')), 12000);
      element[isVideo ? 'onloadeddata' : 'onload'] = () => { clearTimeout(timer); resolve(); };
      element.onerror = () => { clearTimeout(timer); reject(new Error(isVideo ? 'Браузер не поддерживает кодек этого видео' : 'Не удалось декодировать изображение')); };
      element.src = mediaUrl(asset.id);
    });
    stage.replaceChildren(element);
    element.onended = () => { if (current === entry) advance('completed', 'Видео достигло конца'); };
    element.onerror = () => { if (current === entry) failPlayback(entry, new Error('Ошибка декодирования во время воспроизведения')); };
    if (isVideo && !paused) {
      try { await element.play(); }
      catch {
        const prompt = document.createElement('button'); prompt.textContent = 'Разрешить воспроизведение';
        prompt.addEventListener('click', async () => { await element.play(); prompt.remove(); await begin(entry); }, { once: true });
        stage.append(prompt); return;
      }
    }
    if (!paused) await begin(entry);
    errorMessage = '';
  } catch (error) { await failPlayback(current, error); }
  finally { changing = false; notify(); }
}
async function begin(entry) {
  if (entry.started || current !== entry) return;
  entry.started = true; lastTick = performance.now();
  await put('meta', { id: 'active', value: { assetId: entry.asset.id, sessionId: entry.sessionId, playedMs: 0 } });
  await enqueue('started', entry);
}
async function failPlayback(entry, error) {
  errorMessage = error.message;
  if (entry) {
    await enqueue('failed', entry, error.message);
    entry.element.pause?.(); current = null;
    await storeAction(db, 'meta', 'delete', 'active');
  }
  const message = document.createElement('div'); message.className = 'play-error'; message.textContent = errorMessage;
  stage.replaceChildren(message); waitingSince = Date.now(); notify();
}
async function setPaused(value) {
  paused = value; pauseBadge.hidden = !value;
  if (current?.element.tagName === 'VIDEO') {
    if (value) current.element.pause();
    else try { await current.element.play(); } catch (error) { errorMessage = error.message; }
  }
  if (!value && current && !current.started) await begin(current);
  await put('meta', { id: 'paused', value }); lastTick = performance.now(); notify();
}
async function sync() {
  if (syncing || !alive) return;
  syncing = true;
  try {
    const next = await request('/manifest');
    online = true;
    if (!manifest || manifest.version !== next.version) {
      await cacheManifest(next); manifest = next;
      label.textContent = `${deviceId} · ${manifest.name}`;
      activePlaylist = choosePlaylist(); pointer = 0;
      await advance('interrupted', 'Получена новая версия расписания');
    }
    if (next.command.seq > lastCommand) {
      lastCommand = next.command.seq;
      await put('meta', { id: 'command', value: lastCommand });
      if (next.command.action === 'pause') await setPaused(true);
      if (next.command.action === 'resume') await setPaused(false);
      if (next.command.action === 'next') await advance('interrupted', 'Команда: следующий материал');
      if (next.command.action === 'restart') location.reload();
    }
    const events = (await all('events')).slice(0, 500);
    if (events.length) {
      const result = await request('/events', { events });
      for (const id of result.acknowledged) await storeAction(db, 'events', 'delete', id);
    }
    pending = (await all('events')).length;
    await request('/heartbeat', payload());
  } catch (error) {
    online = false;
    if (!manifest) { errorMessage = 'Нет связи и сохранённого расписания. Подключите плеер к серверу хотя бы один раз.'; document.getElementById('waiting')?.replaceChildren(document.createTextNode(errorMessage)); }
    else if (!error.message.startsWith('CMS:') && error.name !== 'TypeError' && error.name !== 'TimeoutError') errorMessage = error.message;
  } finally { syncing = false; notify(); }
}
async function tick() {
  const now = performance.now(); const delta = now - lastTick; lastTick = now;
  if (!manifest || changing) return;
  const nextPlaylist = choosePlaylist();
  if (nextPlaylist && nextPlaylist.id !== activePlaylist?.id) {
    activePlaylist = nextPlaylist; pointer = 0; await advance('interrupted', 'Переход по временному расписанию'); return;
  }
  if (!current && waitingSince && Date.now() - waitingSince > 2000) { waitingSince = 0; await advance(); return; }
  if (current?.started && !paused) {
    if (current.element.tagName === 'VIDEO') current.playedMs = current.element.currentTime * 1000;
    else current.playedMs += delta;
    if (current.playedMs >= current.duration) await advance('completed', 'Завершён запланированный интервал показа');
  }
  notify();
}
async function run() {
  running = true;
  const saved = await get('meta', 'manifest');
  lastCommand = (await get('meta', 'command'))?.value || 0;
  paused = (await get('meta', 'paused'))?.value || false; pauseBadge.hidden = !paused;
  for (const a of await all('assets')) cachedAssets.set(a.id, a);
  cacheCount = cachedAssets.size; pending = (await all('events')).length;
  const abandoned = (await get('meta', 'active'))?.value;
  if (abandoned && saved) {
    await enqueue('interrupted', { asset: { id: abandoned.assetId }, sessionId: abandoned.sessionId, playedMs: abandoned.playedMs || 0 }, 'Плеер перезапущен без события завершения');
    await storeAction(db, 'meta', 'delete', 'active');
  }
  if (saved) { manifest = saved.value; label.textContent = `${deviceId} · ${manifest.name}`; activePlaylist = choosePlaylist(); await advance(); }
  await sync();
  setInterval(sync, 2000);
  let ticking = false;
  setInterval(async () => { if (ticking) return; ticking = true; try { await tick(); } catch (error) { errorMessage = error.message; } finally { ticking = false; } }, 200);
  setInterval(() => {
    if (current?.started) put('meta', { id: 'active', value: { assetId: current.asset.id, sessionId: current.sessionId, playedMs: current.playedMs } }).catch(console.error);
  }, 1000);
}
window.addEventListener('pagehide', () => { alive = false; releaseLock?.(); for (const url of objectUrls.values()) URL.revokeObjectURL(url); });
try {
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(console.error);
  db = await openStore(deviceId);
  if (navigator.locks) {
    navigator.locks.request(`dooh-agent-${deviceId}`, { ifAvailable: true }, async lock => {
      if (!lock) { stage.textContent = 'Этот экран уже запущен в другом окне. Закройте другой экземпляр и обновите страницу.'; return; }
      await run(); await new Promise(resolve => { releaseLock = resolve; });
    }).catch(error => { errorMessage = error.message; notify(); });
  } else await run();
} catch (error) {
  stage.textContent = `Не удалось открыть хранилище плеера: ${error.message}. Используйте обычное окно Chrome/Edge, не приватный режим.`;
}
window.doohDebug = () => ({ ...payload(), running });
