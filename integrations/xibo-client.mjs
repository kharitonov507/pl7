const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);
const neutralLabel = value => String(value ?? '').replace(/xibo/gi, 'CMS');

export class XiboConfigError extends Error {}
export class XiboApiError extends Error {
  constructor(pathname, status) { super(`Внешняя CMS: ${pathname} вернул HTTP ${status}`); this.pathname = pathname; this.status = status; }
}

function validatedBaseUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new XiboConfigError('Некорректный адрес Xibo CMS'); }
  if (url.username || url.password || url.search || url.hash) throw new XiboConfigError('Адрес Xibo не должен содержать credentials, query или fragment');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) {
    throw new XiboConfigError('Удалённый Xibo CMS должен использовать HTTPS');
  }
  url.pathname = url.pathname.replace(/\/+$/, '');
  return url;
}

export function normalizeXiboDisplay(display, syncedAt = new Date().toISOString()) {
  const externalId = String(display.displayId ?? display.id ?? '');
  if (!externalId) throw new Error('Xibo display не содержит идентификатор');
  const online = display.loggedIn === 1 || display.loggedIn === '1' || display.loggedIn === true;
  return {
    provider: 'xibo', externalId,
    name: neutralLabel(display.display ?? display.name ?? `Экран ${externalId}`).slice(0, 160),
    location: neutralLabel(display.description ?? display.deviceName ?? display.clientAddress ?? '').slice(0, 240),
    status: online ? 'online' : 'offline',
    authorized: display.licensed === 1 || display.licensed === '1' || display.licensed === true,
    lastSeen: display.lastAccessed || display.last_accessed || null,
    currentContent: neutralLabel(display.currentLayout ?? display.currentLayoutId ?? '').slice(0, 160),
    syncedAt, raw: display
  };
}

export class XiboClient {
  constructor({ baseUrl, clientId, clientSecret, fetchImpl = fetch, timeoutMs = 10000 }) {
    if (!clientId || !clientSecret) throw new XiboConfigError('Не заданы Xibo client ID и client secret');
    this.baseUrl = validatedBaseUrl(baseUrl);
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.fetch = fetchImpl;
    this.timeoutMs = timeoutMs;
    this.token = null;
    this.tokenExpiresAt = 0;
  }

  async accessToken() {
    if (this.token && Date.now() < this.tokenExpiresAt - 30000) return this.token;
    const form = new URLSearchParams({ grant_type: 'client_credentials', client_id: this.clientId, client_secret: this.clientSecret });
    const url = new URL(this.baseUrl);
    url.pathname = `${this.baseUrl.pathname.replace(/\/+$/, '')}/api/authorize/access_token`;
    const response = await this.fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form,
      redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)
    });
    if (!response.ok) throw new Error(`Xibo OAuth вернул HTTP ${response.status}`);
    const payload = await response.json();
    if (typeof payload.access_token !== 'string' || !payload.access_token) throw new Error('Xibo OAuth не вернул access_token');
    this.token = payload.access_token;
    this.tokenExpiresAt = Date.now() + Math.max(60, Number(payload.expires_in) || 3600) * 1000;
    return this.token;
  }

  async request(pathname, search = {}) {
    const url = new URL(this.baseUrl);
    url.pathname = `${this.baseUrl.pathname.replace(/\/+$/, '')}/api/${pathname.replace(/^\/+/, '')}`;
    for (const [key, value] of Object.entries(search)) if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
    const response = await this.fetch(url, { headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new XiboApiError(pathname, response.status);
    return response.json();
  }

  async listDisplays({ pageSize = 100, max = 1000 } = {}) {
    return this.listCollection('display', { pageSize, max });
  }

  async listCollection(endpoint, { pageSize = 100, max = 5000, search = {} } = {}) {
    const result = [];
    for (let start = 0; start < max; start += pageSize) {
      const payload = await this.request(endpoint, { ...search, start, length: pageSize });
      const page = Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : null;
      if (!page) throw new Error(`Xibo API ${endpoint} вернул неожиданный формат`);
      result.push(...page);
      if (page.length < pageSize) break;
    }
    return result.slice(0, max);
  }

  async listOptionalCollection(endpoint, options) {
    try { return await this.listCollection(endpoint, options); }
    catch (error) { if (error instanceof XiboApiError && error.status === 403) return []; throw error; }
  }

  async uploadMedia({ buffer, name, type }) {
    const url = new URL(this.baseUrl);
    url.pathname = `${this.baseUrl.pathname.replace(/\/+$/, '')}/api/library`;
    const form = new FormData();
    form.append('files', new Blob([buffer], { type }), name);
    form.append('name', name);
    const response = await this.fetch(url, {
      method: 'POST', headers: { Authorization: `Bearer ${await this.accessToken()}`, Accept: 'application/json' }, body: form,
      redirect: 'error', signal: AbortSignal.timeout(Math.max(this.timeoutMs, 120000))
    });
    if (!response.ok) throw new XiboApiError('library upload', response.status);
    const text = await response.text();
    if (!text) return { ok: true };
    try { return JSON.parse(text); } catch { return { ok: true }; }
  }

  async readSnapshot() {
    const displays = await this.listDisplays({ pageSize: 100, max: 1000 });
    const [media, layouts, campaigns, schedules] = await Promise.all([
      this.listCollection('library'), this.listCollection('layout'),
      this.listOptionalCollection('campaign'), this.listCollection('schedule')
    ]);
    return { displays, media, layouts, campaigns, schedules };
  }

  publicInfo() { return { configured: true, origin: this.baseUrl.origin, path: this.baseUrl.pathname || '/' }; }
}

export function normalizeXiboCatalog(kind, item, syncedAt = new Date().toISOString()) {
  const fields = {
    media: ['mediaId', 'name', 'mediaType'],
    layout: ['layoutId', 'layout', 'status'],
    campaign: ['campaignId', 'campaign', 'isRetired'],
    schedule: ['eventId', 'name', 'eventType']
  }[kind];
  if (!fields) throw new Error(`Неизвестный тип каталога Xibo: ${kind}`);
  const externalId = String(item[fields[0]] ?? item.id ?? '');
  if (!externalId) throw new Error(`Xibo ${kind} не содержит идентификатор`);
  const fallbackName = kind === 'schedule' ? `Событие ${externalId}` : `${kind} ${externalId}`;
  return {
    provider: 'xibo', kind, externalId,
    name: neutralLabel(item[fields[1]] ?? item.name ?? fallbackName).slice(0, 240),
    status: String(item[fields[2]] ?? '').slice(0, 80), syncedAt, raw: item
  };
}

export function createXiboClientFromEnv(env = process.env) {
  const baseUrl = env.XIBO_BASE_URL;
  const clientId = env.XIBO_CLIENT_ID;
  const clientSecret = env.XIBO_CLIENT_SECRET;
  if (!baseUrl && !clientId && !clientSecret) return null;
  if (!baseUrl || !clientId || !clientSecret) throw new XiboConfigError('Для Xibo нужны XIBO_BASE_URL, XIBO_CLIENT_ID и XIBO_CLIENT_SECRET');
  return new XiboClient({ baseUrl, clientId, clientSecret });
}
