const $ = id => document.getElementById(id);
let page = 1; let pages = 1; let toastTimer;
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const kindNames = { media: 'Медиа', layout: 'Раскладка', campaign: 'Кампания', schedule: 'Расписание' };
const neutralLabel = value => String(value ?? '').replace(/xibo/gi, 'CMS');

function toast(message, error = false) {
  $('toast').textContent = message; $('toast').className = `toast${error ? ' error' : ''}`; $('toast').hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { $('toast').hidden = true; }, 5000);
}

function dateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('ru-RU', { dateStyle: 'short', timeStyle: 'short' });
}

async function loadStatus() {
  const response = await fetch('/api/integrations/xibo/status', { cache: 'no-store' });
  if (!response.ok) throw new Error('Не удалось проверить подключение Player Server');
  const status = await response.json();
  $('sync-xibo').disabled = !status.configured;
  $('sync-xibo').title = status.configured ? `Player Server: ${status.origin}${status.path === '/' ? '' : status.path}` : 'Сначала настройте подключение Player Server';
  $('xibo-summary').hidden = !status.configured && !status.lastSync;
  $('xibo-sync-time').textContent = status.lastSync ? `Обновлено ${dateTime(status.lastSync)}` : 'Ещё не синхронизировано';
  $('xibo-media').textContent = status.catalogCounts?.media || 0;
  $('xibo-layout').textContent = status.catalogCounts?.layout || 0;
  $('xibo-campaign').textContent = status.catalogCounts?.campaign || 0;
  $('xibo-schedule').textContent = status.catalogCounts?.schedule || 0;
  if (!status.configured) {
    $('mode-alert').hidden = false;
    $('mode-alert').textContent = 'Player Server пока не подключён. Добавьте реквизиты серверного адаптера в локальный .env.local.';
  } else if (status.lastError) {
    $('mode-alert').hidden = false; $('mode-alert').classList.add('error');
    $('mode-alert').textContent = `Последняя синхронизация завершилась ошибкой: ${String(status.lastError).replaceAll('Xibo', 'Player Server')}`;
  } else {
    $('mode-alert').hidden = true;
  }
  return status;
}

async function loadCatalog() {
  const query = new URLSearchParams({ page, pageSize: 25, q: $('catalog-search').value, kind: $('catalog-kind').value });
  const response = await fetch(`/api/integrations/xibo/catalog?${query}`, { cache: 'no-store' });
  if (!response.ok) throw new Error('Каталог недоступен');
  const data = await response.json(); page = data.page; pages = data.pages;
  $('catalog-page').textContent = `Страница ${page} из ${pages}`;
  $('catalog-total').textContent = `${data.total} ${data.total === 1 ? 'запись' : 'записей'}`;
  $('catalog-prev').disabled = page <= 1; $('catalog-next').disabled = page >= pages;
  $('catalog-empty').hidden = data.items.length > 0;
  $('catalog-rows').innerHTML = data.items.map(item => `<tr><td><span class="source-chip">${esc(kindNames[item.kind] || item.kind)}</span></td><td>${esc(neutralLabel(item.name || 'Без названия'))}</td><td><span class="catalog-id">${esc(item.externalId)}</span></td><td>${esc(item.status || '—')}</td><td>${esc(dateTime(item.syncedAt))}</td></tr>`).join('');
}

$('catalog-filters').addEventListener('submit', async event => { event.preventDefault(); page = 1; await loadCatalog(); });
$('catalog-prev').addEventListener('click', async () => { if (page > 1) { page--; await loadCatalog(); } });
$('catalog-next').addEventListener('click', async () => { if (page < pages) { page++; await loadCatalog(); } });
$('sync-xibo').addEventListener('click', async () => {
  const button = $('sync-xibo'); button.disabled = true;
  try {
    const response = await fetch('/api/integrations/xibo/sync', { method: 'POST' }); const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Синхронизация не выполнена');
    const catalogTotal = Object.values(result.catalog).reduce((sum, count) => sum + count, 0);
    toast(`Импортировано: ${result.imported} экранов и ${catalogTotal} записей каталога`);
    await Promise.all([loadStatus(), loadCatalog()]);
  } catch (error) { toast(error.message, true); }
  finally { await loadStatus().catch(() => {}); }
});
$('cms-upload').addEventListener('change', async event => {
  const file = event.target.files?.[0]; if (!file) return;
  const label = event.target.closest('label'); label.setAttribute('aria-busy', 'true');
  try {
    const response = await fetch('/api/integrations/xibo/media', { method: 'POST', headers: { 'Content-Type': file.type, 'X-Filename': encodeURIComponent(file.name) }, body: file });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || 'Файл не загружен');
    const sync = await fetch('/api/integrations/xibo/sync', { method: 'POST' }); const syncResult = await sync.json();
    if (!sync.ok) throw new Error(syncResult.error || 'Файл загружен, но каталог не обновлён');
    toast(`Материал «${file.name}» добавлен в медиатеку`); await Promise.all([loadStatus(), loadCatalog()]);
  } catch (error) { toast(error.message, true); }
  finally { event.target.value = ''; label.removeAttribute('aria-busy'); }
});

function updateClock() { $('clock').textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }); }
updateClock(); setInterval(updateClock, 1000);
try {
  await Promise.all([loadStatus(), loadCatalog()]);
  $('server-dot').className = 'dot'; $('server-status').textContent = 'Локальный сервер · online';
} catch (error) {
  $('server-dot').className = 'dot bad'; $('server-status').textContent = 'Сервер недоступен'; toast(error.message, true);
}
