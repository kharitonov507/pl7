const $ = id => document.getElementById(id);
const names = { screens: 'Живые плееры', content: 'Медиатека', playlists: 'Плейлисты', events: 'Журнал показов', about: 'Архитектура' };
const kinds = { started: 'Начало', completed: 'Завершён', interrupted: 'Прерван', failed: 'Ошибка' };
const local = new Map();
let state, currentView = 'screens', toastTimer;
const goMode = new URL(location.href).searchParams.get('agents') === 'go';
if (goMode) {
  document.querySelector('#view-about').innerHTML = document.querySelector('#view-about').innerHTML.replaceAll('Player CMS', 'Player Server');
  document.querySelector('.sidebar-bottom p').textContent = 'Prototype 0.2 · Player Server + 100 Go-agent endpoints · SQLite';
  document.querySelector('#view-screens .subtitle').textContent = '100 Go-agent endpoints и 100 дисплеев в Player Server. Каждый endpoint подключается отдельным процессом Go.';
  document.querySelector('.nav-item[data-view="screens"] span:not(.nav-count)').textContent = 'Go-агенты';
  document.querySelector('.nav-item[data-view="screens"] .nav-count').textContent = '100';
  document.querySelector('.nav-item[aria-label="Все 100 экранов"] span:not(.nav-count)').textContent = 'Все дисплеи';
  document.querySelector('#online-count').nextElementSibling.textContent = '/ 100 Go-agent endpoints';
  document.querySelector('#view-screens .section-heading h2').textContent = 'Go-agent endpoints · 100 дисплеев';
  document.querySelector('.note-panel p').textContent = 'Файлы — в кеше на диске. Расписание, команды и очередь событий — в SQLite каждого Go-агента. Браузер не хранит их в IndexedDB.';
  document.querySelector('#view-screens .footnote').textContent = '100 Go-процессов на одном ПК · локальный HTTP/WebSocket-мост · Astra и аппаратный watchdog ещё не проверены';
  document.querySelector('#view-events .subtitle').textContent = 'События Go-агентов и рендера. Очередь сохраняется в SQLite на устройстве.';
  const guide = document.querySelector('#guide');
  guide.querySelector('strong').textContent = 'Демо парка из 100 Go-agent за 3 минуты';
  guide.querySelector('ol').replaceChildren(...[
    'Покажите реестр Player Server: 100 endpoint-ов и их статусы.',
    'Откройте несколько карточек: у каждого процесса свой порт, кеш SQLite и heartbeat.',
    'Покажите proof-of-play и очередь событий в журнале.',
    'Откройте «Настроить» и назначьте плейлист или временной интервал.',
    'При необходимости отключите один endpoint и покажите восстановление очереди.'
  ].map(text => { const li = document.createElement('li'); li.textContent = text; return li; }));
  guide.querySelector('p').textContent = 'На одном компьютере запускается 100 независимых Go-процессов. Это демонстрация масштаба реестра и протокола, а не 100 физических экранов.';
  document.querySelector('.brand').href = '/?agents=go';
  document.querySelector('#view-events a[download]').href = '/api/report?agents=go';
  document.querySelector('#view-screens .section-heading h2').textContent = 'Go-agent endpoints · 100 дисплеев';
  const architecture = document.querySelector('#view-about .architecture');
  architecture.lastElementChild.querySelector('h2').textContent = 'Go + SQLite + Chromium';
  architecture.lastElementChild.querySelector('p').textContent = 'Сто отдельных Go-процессов. Каждый сохраняет расписание, команды и очередь PoP в собственной SQLite WAL. Медиа — в файловом кеше по SHA-256. Локальный HTTP/WebSocket-мост передаёт состояние тонкому браузерному рендеру.';
  architecture.children[3].textContent = '↓ Player Server HTTP · локальный WebSocket';
  const next = document.querySelectorAll('#view-about .activity-panel')[1];
  next.querySelector('h2').textContent = 'Подготовлено / требует проверки';
  next.querySelector('ul').replaceChildren(...['Chromium kiosk и supervisor — реализованы, требуется целевая ОС','systemd sd_notify и watchdog — шаблон Linux','MQTT QoS 1, TLS и ACK — опциональный канал','OTA: проверка подписи и загрузка кандидата, без установки','Astra, GPU, 48 часов offline, точность времени — не подтверждены','Полная авторизация Player CMS, OTA с откатом и аппаратный watchdog — далее'].map(text => { const li=document.createElement('li'); li.textContent=text; return li; }));
  document.querySelector('#view-about .footnote').textContent = 'Не production: локальный мост защищён, но Player Control не имеет пользовательской авторизации. Нет подтверждения физического дисплея, DRM, гарантии бесшовности и автоматического OTA-отката. Не публиковать в интернет.';
  document.querySelectorAll('#view-about .activity-panel')[0].querySelectorAll('li')[4].textContent = 'Пауза, следующий материал, новая сессия показа';
}
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const time = value => new Date(value).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const bytes = value => value > 1024 * 1024 ? `${(value / 1024 / 1024).toFixed(1)} МБ` : `${Math.round(value / 1024)} КБ`;
function toast(message, error = false) {
  $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}
async function post(url, data) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Ошибка запроса');
  await refresh(); return result;
}
function showView(view) {
  currentView = view;
  document.querySelectorAll('.view').forEach(section => { section.hidden = section.id !== `view-${view}`; });
  document.querySelectorAll('.nav-item').forEach(item => item.classList.toggle('active', item.dataset.view === view));
  $('crumb').textContent = names[view];
  if (state) renderSecondary();
}
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
$('guide-toggle').addEventListener('click', () => { $('guide').hidden = !$('guide').hidden; });
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(button.dataset.close).close()));
function makeScreens() {
  $('screens').innerHTML = state.devices.map(d => `<article class="screen-card" id="card-${esc(d.id)}">
    <div class="screen-head"><div><h3>${esc(d.name)}</h3><p>${esc(d.location)}</p></div><span class="badge waiting" data-status>Запуск</span></div>
    <div class="monitor"><iframe src="${esc(d.renderer_url || `/player.html?device=${d.id}`)}" title="${esc(d.name)} — ${d.renderer_url ? 'Go-agent' : 'виртуальный плеер'}" allow="autoplay; fullscreen"></iframe></div><div class="monitor-stand"></div><div class="monitor-base"></div>
    <div class="screen-info"><div class="screen-info-row"><span>Сейчас на экране</span><strong data-timing>—</strong></div><div class="screen-title" data-content>Подготовка кеша…</div><div class="playback-track"><div data-progress></div></div><div class="screen-info-row"><span>Плейлист</span><strong data-playlist>—</strong></div><div class="screen-info-row"><span>Кеш / очередь</span><strong data-cache>—</strong></div></div>
    <div class="screen-error" data-error hidden></div>
    <div class="screen-actions"><button class="mini-button" data-action="pause" data-device="${esc(d.id)}" data-pause>Ⅱ Пауза</button><button class="mini-button" data-action="next" data-device="${esc(d.id)}">→ Далее</button><button class="mini-button" data-action="config" data-device="${esc(d.id)}">Настроить</button><button class="mini-button" data-action="restart" data-device="${esc(d.id)}" aria-label="Перезапустить ${esc(d.name)}">↻</button><button class="mini-button warning" data-action="connection" data-device="${esc(d.id)}" data-connection>Отключить связь</button><button class="mini-button" data-action="fullscreen" data-device="${esc(d.id)}" aria-label="Развернуть ${esc(d.name)}">⛶</button></div>
  </article>`).join('');
}
function renderDevice(d) {
  const card = $(`card-${d.id}`); if (!card) return;
  const record = local.get(d.id);
  const recent = record && Date.now() - record.at < 4000;
  const s = recent ? record.state : d.state;
  const online = recent ? s.online : d.online;
  const badge = card.querySelector('[data-status]');
  badge.className = `badge ${online ? 'online' : (s.assetId ? 'offline' : 'waiting')}`;
  badge.textContent = online ? (s.paused ? '● Пауза' : '● Online') : s.assetId ? '● Offline-кеш' : '● Нет heartbeat';
  card.querySelector('[data-content]').textContent = s.assetName || 'Подготовка кеша…';
  card.querySelector('[data-playlist]').textContent = s.playlistName || state.playlists.find(p => p.id === d.playlist_id)?.name || '—';
  card.querySelector('[data-cache]').textContent = `${s.cacheCount || 0} файлов / ${s.queue || 0} событий`;
  card.querySelector('[data-timing]').textContent = s.duration ? `${Math.min(Math.floor(s.elapsed / 1000), Math.round(s.duration / 1000))} / ${Math.round(s.duration / 1000)} сек.` : '—';
  card.querySelector('[data-progress]').style.width = `${Math.min(100, (s.elapsed || 0) / (s.duration || 1) * 100)}%`;
  const pause = card.querySelector('[data-pause]'); pause.textContent = s.paused ? '▷ Продолжить' : 'Ⅱ Пауза'; pause.dataset.action = s.paused ? 'resume' : 'pause';
  const connection = card.querySelector('[data-connection]'); connection.textContent = d.simulated_offline ? 'Вернуть связь' : 'Отключить связь'; connection.className = `mini-button ${d.simulated_offline ? 'reconnect' : 'warning'}`;
  const error = card.querySelector('[data-error]'); error.hidden = !s.error; error.textContent = s.error || '';
}
function renderStats() {
  if (!state) return;
  let count = 0; let queue = 0;
  for (const d of state.devices) {
    const record = local.get(d.id); const fresh = record && Date.now() - record.at < 4000;
    const s = fresh ? record.state : d.state;
    if (fresh ? s.online : d.online) count++;
    queue += s.queue || 0;
  }
  $('online-count').textContent = count;
  $('queue-count').textContent = queue;
  $('completed-count').textContent = state.stats.completed || 0;
  $('asset-count').textContent = state.assets.length;
}
window.addEventListener('message', event => {
  if (event.data?.type !== 'dooh-state') return;
  const s = event.data.state; const card = $(`card-${s.deviceId}`);
  if (!card || event.source !== card.querySelector('iframe').contentWindow) return;
  const registered = state.devices.find(d => d.id === s.deviceId);
  if (event.origin !== new URL(registered.renderer_url || location.origin).origin) return;
  local.set(s.deviceId, { state: s, at: Date.now() });
  const device = state.devices.find(d => d.id === s.deviceId); renderDevice(device); renderStats();
});
$('screens').addEventListener('click', async event => {
  const button = event.target.closest('[data-action]'); if (!button) return;
  const id = button.dataset.device; const action = button.dataset.action;
  const d = state.devices.find(device => device.id === id);
  try {
    if (action === 'config') { openConfig(d); return; }
    if (action === 'fullscreen') { await $(`card-${id}`).querySelector('.monitor').requestFullscreen(); return; }
    button.disabled = true;
    if (action === 'connection') {
      await post(`/api/devices/${id}/connection`, { offline: !d.simulated_offline });
      toast(d.simulated_offline ? 'Связь возвращена. Очередь будет доставлена на сервер.' : 'Обмен с API отключён. Плеер продолжает локальный показ.');
    } else {
      await post(`/api/devices/${id}/command`, { action });
      toast(d.simulated_offline ? 'Команда сохранена. Offline-плеер получит её после восстановления связи.' : 'Команда отправлена. Плеер получит её в течение 2 секунд.');
    }
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
function localDate(value) {
  if (!value) return '';
  const date = new Date(value); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16);
}
function openConfig(d) {
  $('config-device').value = d.id; $('config-device-name').textContent = `${d.name} · ${d.id}`;
  const options = state.playlists.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  $('config-playlist').innerHTML = options; $('config-fallback').innerHTML = options;
  $('config-playlist').value = d.playlist_id; $('config-fallback').value = d.fallback_id;
  $('config-start').value = localDate(d.starts_at); $('config-end').value = localDate(d.ends_at);
  $('config-dialog').showModal();
}
$('config-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  try {
    await post(`/api/devices/${$('config-device').value}/config`, { playlistId: $('config-playlist').value, fallbackId: $('config-fallback').value, startsAt: $('config-start').value ? new Date($('config-start').value).toISOString() : null, endsAt: $('config-end').value ? new Date($('config-end').value).toISOString() : null });
    $('config-dialog').close(); toast('Расписание опубликовано. Сначала плеер подготовит кеш.');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$('upload').addEventListener('change', async event => {
  const file = event.target.files[0]; if (!file) return;
  if (file.size > 1024 * 1024 * 1024) { toast('Максимальный размер — 1 ГБ', true); event.target.value = ''; return; }
  $('upload-status').textContent = `Загружаем ${file.name}…`; event.target.disabled = true;
  try {
    const response = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error);
    await refresh(); toast('Файл загружен. Добавьте его в новый плейлист.');
  } catch (error) { toast(error.message, true); }
  finally { event.target.value = ''; event.target.disabled = false; $('upload-status').textContent = 'JPG, PNG, WebP, MP4, WebM · до 1 ГБ · видео воспроизводится без звука'; }
});
$('new-playlist').addEventListener('click', () => {
  $('playlist-form').reset();
  $('playlist-items').innerHTML = state.assets.map(a => `<label class="choose-item"><input type="checkbox" data-asset-id="${esc(a.id)}"><span>${esc(a.name)}<small>${a.type.startsWith('video') ? 'Видео · максимум показа' : 'Изображение · длительность'}</small></span><input type="number" value="8" min="2" max="3600" aria-label="Длительность ${esc(a.name)} в секундах"></label>`).join('');
  $('playlist-dialog').showModal();
});
$('playlist-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.submitter; button.disabled = true;
  const items = [...$('playlist-items').querySelectorAll('input[type=checkbox]:checked')].map(input => ({ assetId: input.dataset.assetId, duration: Number(input.closest('label').querySelector('input[type=number]').value) }));
  try {
    await post('/api/playlists', { name: $('playlist-name').value, items });
    $('playlist-dialog').close(); toast('Плейлист создан. Назначьте его экрану через «Настроить».');
  } catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
function renderSecondary() {
  if (currentView === 'content') {
    const signature = state.assets.map(a => a.id).join(',');
    if ($('assets').dataset.signature !== signature) {
      $('assets').dataset.signature = signature;
      $('assets').innerHTML = state.assets.map(a => `<article class="asset-card">${a.type.startsWith('video') ? `<video src="${esc(a.url)}" controls muted preload="metadata"></video>` : `<img src="${esc(a.url)}" alt="${esc(a.name)}">`}<div><strong>${esc(a.name)}</strong><p>${a.type.startsWith('video') ? 'ВИДЕО' : 'ИЗОБРАЖЕНИЕ'} · ${bytes(a.size)}</p>${a.url.startsWith('/uploads/') ? `<button class="mini-button warning" data-delete-asset="${esc(a.id)}">Удалить</button>` : '<small class="helper">Системный материал</small>'}</div></article>`).join('');
    }
  }
  if (currentView === 'playlists') $('playlists').innerHTML = state.playlists.map(p => `<article class="playlist-card"><div class="section-heading"><h2>${esc(p.name)}</h2><button class="mini-button warning" data-delete-playlist="${esc(p.id)}">Удалить</button></div><p class="helper">${p.items.length} материала · ${p.items.reduce((sum, i) => sum + i.duration, 0)} сек. максимум · циклично</p>${p.items.map(i => { const a = state.assets.find(a => a.id === i.assetId); return `<div class="playlist-entry">${a.type.startsWith('video') ? '<div class="video-placeholder">▷</div>' : `<img src="${esc(a.url)}" alt="">`}<span>${esc(a.name)}</span><small>${i.duration} сек.</small></div>`; }).join('')}</article>`).join('');
  if (currentView === 'events') renderEvents();
}
$('assets').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-asset]'); if (!button) return;
  const asset = state.assets.find(item => item.id === button.dataset.deleteAsset); if (!asset) return;
  if (!confirm(`Удалить материал «${asset.name}»? Это действие нельзя отменить.`)) return;
  button.disabled = true;
  try { await post(`/api/assets/${encodeURIComponent(asset.id)}/delete`, {}); toast('Материал удалён.'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$('playlists').addEventListener('click', async event => {
  const button = event.target.closest('[data-delete-playlist]'); if (!button) return;
  const playlist = state.playlists.find(item => item.id === button.dataset.deletePlaylist); if (!playlist) return;
  if (!confirm(`Удалить плейлист «${playlist.name}»? Используемый экраном плейлист сервер удалить не позволит.`)) return;
  button.disabled = true;
  try { await post(`/api/playlists/${encodeURIComponent(playlist.id)}/delete`, {}); toast('Плейлист удалён.'); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
function renderEvents() {
  const filtered = state.events.filter(e => (!$('event-device').value || e.device_id === $('event-device').value) && (!$('event-kind').value || e.kind === $('event-kind').value));
  $('event-rows').innerHTML = filtered.length ? filtered.map(e => {
    const delay = Math.max(0, Math.round((Date.parse(e.received_at) - Date.parse(e.occurred_at)) / 1000));
    return `<tr><td>${time(e.occurred_at)}<small>${new Date(e.occurred_at).toLocaleDateString('ru-RU')}</small></td><td>${esc(e.device_name)}<small>${esc(e.device_id)}</small></td><td>${esc(e.asset_name)}<small>${esc(e.detail)}</small></td><td><span class="event-kind ${esc(e.kind)}">${kinds[e.kind]}</span></td><td>${(e.played_ms / 1000).toFixed(1)} сек.</td><td>${delay > 4 ? `После offline · ${delay} сек.` : 'Получено сервером'}</td></tr>`;
  }).join('') : '<tr><td colspan="6" class="empty">Пока нет событий с выбранными условиями.</td></tr>';
}
for (const id of ['event-device', 'event-kind']) $(id).addEventListener('change', renderEvents);
async function refresh() {
  try {
    const response = await fetch(`/api/state${goMode ? '?agents=go' : ''}`, { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Сервер недоступен');
    const oldDevices = state?.devices.map(d => d.id).join(',');
    state = await response.json();
    state.devices = state.devices.filter(d => goMode ? !!d.renderer_url : !d.renderer_url);
    if (goMode) state.events = state.events.filter(e => state.devices.some(d => d.id === e.device_id));
    if (oldDevices !== state.devices.map(d => d.id).join(',')) {
      makeScreens();
      const selected = $('event-device').value;
      $('event-device').innerHTML = '<option value="">Все экраны</option>' + state.devices.map(d => `<option value="${esc(d.id)}">${esc(d.name)}</option>`).join('');
      $('event-device').value = selected;
    }
    $('server-alert').hidden = true; $('server-dot').className = 'dot'; $('server-status').textContent = 'Локальный сервер · online';
    if (!$('screens').children.length) makeScreens();
    for (const device of state.devices) renderDevice(device);
    renderStats(); renderSecondary();
    $('recent-events').innerHTML = state.events.length ? state.events.slice(0, 4).map(e => `<div class="activity-item"><span class="activity-icon">${e.kind === 'completed' ? '✓' : e.kind === 'started' ? '▷' : '↻'}</span><div class="detail"><strong>${esc(e.asset_name)}</strong><small>${esc(e.device_name)} · ${kinds[e.kind]}</small></div><span class="activity-time">${time(e.occurred_at)}</span></div>`).join('') : '<div class="empty">События появятся после первого запуска плееров.</div>';
  } catch {
    $('server-alert').hidden = false; $('server-dot').className = 'dot bad'; $('server-status').textContent = 'Сервер недоступен';
  }
}
async function loadFleetWall() {
  try {
    const response = await fetch('/api/fleet?demo=100&includeReal=1&pageSize=100', { cache: 'no-store', signal: AbortSignal.timeout(4000) });
    if (!response.ok) throw new Error('Парк экранов недоступен');
    const fleet = await response.json();
    $('wall-online').textContent = fleet.summary.online;
    $('wall-offline').textContent = fleet.summary.offline;
    $('wall-error').textContent = fleet.summary.error;
    $('fleet-wall').innerHTML = fleet.items.map((device, index) => `<a class="fleet-node ${esc(device.status)}" href="/fleet.html?provider=${encodeURIComponent(device.provider)}&device=${encodeURIComponent(device.externalId)}" title="${esc(device.name)} · ${esc(device.location)} · ${esc(device.status)}" aria-label="${esc(device.name)}, ${esc(device.status)}">${String(index + 1).padStart(3, '0')}</a>`).join('');
  } catch (error) {
    $('fleet-wall').innerHTML = `<div class="empty">${esc(error.message)}</div>`;
  }
}
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }, 1000);
await Promise.all([refresh(), loadFleetWall()]);
let refreshing = false;
setInterval(async () => { if (refreshing) return; refreshing = true; try { await refresh(); } finally { refreshing = false; } }, 2000);
setInterval(loadFleetWall, 10000);
