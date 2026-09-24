const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
let page = 1; let pages = 1; let toastTimer;
const demo = params.get('mode') === 'demo' ? Math.max(1, Math.min(500, Number(params.get('demo')) || 100)) : 0;
$('demo-toggle').href = demo ? '/fleet.html' : '/fleet.html?mode=demo';
$('demo-toggle').textContent = demo ? 'Реальные Go-агенты' : 'Отдельный режим симуляции';
$('fleet-provider').value = params.get('provider') || (demo ? '' : 'native');
$('fleet-search').value = params.get('q') || '';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const sourceNames = { native: 'Go-agent', browser: 'Browser', xibo: 'Player Server', simulation: 'Go Agent · Demo' };
const statusNames = { online: 'Online', offline: 'Offline', error: 'Ошибка' };
function toast(message, error = false) { $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000); }
function relative(value) {
  if (!value) return 'Никогда'; const seconds = Math.max(0, Math.round((Date.now() - Date.parse(value)) / 1000));
  if (seconds < 60) return `${seconds} сек. назад`; if (seconds < 3600) return `${Math.floor(seconds / 60)} мин. назад`;
  return new Date(value).toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}
const localDateTime = value => { if (!value) return ''; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };
function closeConfig() { $('fleet-config-dialog').close(); }
async function openConfig(provider, externalId) {
  const response = await fetch(`/api/fleet/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}/config`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Не удалось открыть настройки');
  $('fleet-config-provider').value = provider;
  $('fleet-config-external-id').value = externalId;
  $('fleet-config-id').textContent = `${sourceNames[provider] || provider} · ${externalId}`;
  $('fleet-config-name').value = data.name;
  $('fleet-config-location').value = data.location;
  const options = data.playlists.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  $('fleet-config-playlist').innerHTML = options;
  $('fleet-config-fallback').innerHTML = options;
  $('fleet-config-playlist').value = data.playlistId;
  $('fleet-config-fallback').value = data.fallbackId;
  $('fleet-config-start').value = localDateTime(data.startsAt);
  $('fleet-config-end').value = localDateTime(data.endsAt);
  $('fleet-config-delivery').textContent = data.delivery === 'player' ? 'Плеер получит настройки при следующем подключении' : provider === 'xibo' ? 'Локальный черновик. Player Server пока не получает эти настройки.' : 'Демо-модель: настройки сохраняются локально';
  $('fleet-config-form').querySelector('[type="submit"]').textContent = data.delivery === 'player' ? 'Сохранить для плеера' : 'Сохранить локально';
  $('fleet-config-version').textContent = `Версия ${data.version || 0}`;
  $('fleet-config-dialog').showModal();
}
async function loadStatus() {
  const response = await fetch('/api/integrations/xibo/status', { cache: 'no-store' }); const status = await response.json();
  $('sync-xibo').disabled = !status.configured;
  $('sync-xibo').title = status.configured ? `Player Server: ${status.origin}${status.path === '/' ? '' : status.path}` : 'Сначала настройте подключение Player Server';
  $('xibo-summary').hidden = !status.configured && !status.lastSync;
  $('xibo-sync-time').textContent = status.lastSync ? `Обновлено ${new Date(status.lastSync).toLocaleString('ru-RU')}` : 'Ещё не синхронизировано';
  $('xibo-media').textContent = status.catalogCounts?.media || 0; $('xibo-layout').textContent = status.catalogCounts?.layout || 0;
  $('xibo-campaign').textContent = status.catalogCounts?.campaign || 0; $('xibo-schedule').textContent = status.catalogCounts?.schedule || 0;
  if (demo) { $('mode-alert').hidden = false; $('mode-alert').textContent = `Единый парк содержит реальные локальные устройства и дополнен демонстрационными до ${demo} экранов. Все они находятся на одной странице; команды для демо-записей не отправляются.`; $('demo-toggle').textContent = 'Только реальные устройства'; $('demo-toggle').href = '/fleet.html?mode=real'; }
  else if (!status.configured) { $('mode-alert').hidden = false; $('mode-alert').textContent = 'Player Server пока не подключён. Сейчас показаны локальные устройства.'; $('demo-toggle').textContent = 'Показать парк 100 экранов'; $('demo-toggle').href = '/fleet.html?mode=demo'; }
  else if (status.lastError) { $('mode-alert').hidden = false; $('mode-alert').classList.add('error'); $('mode-alert').textContent = `Последняя синхронизация Player Server завершилась ошибкой: ${String(status.lastError).replaceAll('Xibo', 'Player Server')}`; }
}
async function loadFleet() {
  const query = new URLSearchParams({ page, pageSize: 100, q: $('fleet-search').value, status: $('fleet-status').value, provider: $('fleet-provider').value });
  if (!demo && $('fleet-provider').value === 'native') query.set('scope', 'go100');
  if (demo) { query.set('demo', demo); query.set('includeReal', '1'); }
  const response = await fetch(`/api/fleet?${query}`, { cache: 'no-store' }); if (!response.ok) throw new Error('Реестр недоступен');
  const data = await response.json(); page = data.page; pages = data.pages;
  $('fleet-total').textContent = data.summary.total; $('fleet-online').textContent = data.summary.online; $('fleet-offline').textContent = data.summary.offline; $('fleet-error').textContent = data.summary.error;
  const composition = data.summary.real == null ? { real: data.items.filter(item => item.provider !== 'simulation').length, demo: data.items.filter(item => item.provider === 'simulation').length, native: data.items.filter(item => item.provider === 'native').length, browser: data.items.filter(item => item.provider === 'browser').length, external: data.items.filter(item => item.provider === 'xibo').length } : data.summary;
  $('fleet-composition').hidden = false;
  $('fleet-composition').innerHTML = `<strong>Player Server fleet:</strong> ${data.summary.total} дисплеев · ${composition.real} зарегистрированных устройств + ${composition.demo} демонстрационных записей. Go-agent endpoints подключаются отдельными процессами и передают heartbeat, очередь и proof-of-play.`;
  $('fleet-page').textContent = `Страница ${page} из ${pages}`; $('fleet-prev').disabled = page <= 1; $('fleet-next').disabled = page >= pages;
  $('fleet-rows').innerHTML = data.items.length ? data.items.map(item => `<tr><td><span class="device-name">${esc(item.name)}</span><span class="device-id">${esc(item.externalId)}</span></td><td><span class="source-chip">${esc(sourceNames[item.provider] || item.provider)}</span></td><td>${esc(item.location || 'Не указана')}</td><td><span class="status-chip ${esc(item.status)}">${esc(statusNames[item.status] || item.status)}</span>${item.authorized ? '' : '<small>Не авторизован</small>'}</td><td>${esc(item.currentContent || 'Нет данных')}<small>Конфигурация v${esc(item.version || 0)}</small></td><td>${esc(relative(item.lastSeen))}</td><td><button class="button fleet-config-button" data-config-provider="${esc(item.provider)}" data-config-id="${esc(item.externalId)}">Настроить</button></td></tr>`).join('') : '<tr><td colspan="7" class="empty">По выбранным условиям устройства не найдены.</td></tr>';
}
$('fleet-rows').addEventListener('click', async event => {
  const button = event.target.closest('[data-config-id]'); if (!button) return;
  button.disabled = true;
  try { await openConfig(button.dataset.configProvider, button.dataset.configId); }
  catch (error) { toast(error.message, true); }
  finally { button.disabled = false; }
});
$('fleet-config-dialog').addEventListener('click', event => { if (event.target.hasAttribute('data-close')) closeConfig(); });
$('fleet-config-form').addEventListener('submit', async event => {
  event.preventDefault(); const submit = event.submitter; submit.disabled = true;
  const provider = $('fleet-config-provider').value; const externalId = $('fleet-config-external-id').value;
  const payload = {
    name: $('fleet-config-name').value, location: $('fleet-config-location').value,
    playlistId: $('fleet-config-playlist').value, fallbackId: $('fleet-config-fallback').value,
    startsAt: $('fleet-config-start').value ? new Date($('fleet-config-start').value).toISOString() : null, endsAt: $('fleet-config-end').value ? new Date($('fleet-config-end').value).toISOString() : null
  };
  try {
    const response = await fetch(`/api/fleet/${encodeURIComponent(provider)}/${encodeURIComponent(externalId)}/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Настройки не сохранены');
    closeConfig(); await loadFleet();
    toast(result.delivery === 'player' ? 'Настройки сохранены. Плеер получит их при следующем подключении.' : 'Индивидуальная конфигурация экрана сохранена локально.');
  } catch (error) { toast(error.message, true); }
  finally { submit.disabled = false; }
});
$('fleet-filters').addEventListener('submit', async event => { event.preventDefault(); page = 1; await loadFleet(); });
$('fleet-prev').addEventListener('click', async () => { if (page > 1) { page--; await loadFleet(); } });
$('fleet-next').addEventListener('click', async () => { if (page < pages) { page++; await loadFleet(); } });
$('sync-xibo').addEventListener('click', async () => { const button = $('sync-xibo'); button.disabled = true; try { const response = await fetch('/api/integrations/xibo/sync', { method: 'POST' }); const result = await response.json(); if (!response.ok) throw new Error(result.error); toast(`Импортировано: ${result.imported} экранов, ${result.catalog.media} медиа, ${result.catalog.layouts} раскладок`); await loadFleet(); } catch (error) { toast(error.message, true); } finally { await loadStatus().catch(() => {}); } });
setInterval(() => { $('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }, 1000);
try { await loadStatus(); await loadFleet(); $('server-dot').className = 'dot'; $('server-status').textContent = 'Локальный сервер · online'; } catch (error) { $('server-dot').className = 'dot bad'; $('server-status').textContent = 'Сервер недоступен'; toast(error.message, true); }
if (params.get('device') && params.get('provider')) { try { await openConfig(params.get('provider'), params.get('device')); } catch (error) { toast(error.message, true); } }

let polling = false;
setInterval(async () => { if (polling) return; polling = true; try { await loadFleet(); $('server-status').textContent = 'Локальный сервер · online'; } catch { $('server-status').textContent = 'Сервер недоступен · данные устарели'; } finally { polling = false; } }, 2000);
