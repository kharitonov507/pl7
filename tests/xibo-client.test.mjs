import { test } from 'node:test';
import assert from 'node:assert/strict';
import { XiboClient, XiboConfigError, normalizeXiboDisplay, normalizeXiboCatalog } from '../integrations/xibo-client.mjs';

test('Xibo client authenticates once and paginates displays', async () => {
  let authCalls = 0; const apiStarts = [];
  const fakeFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/authorize/access_token')) {
      authCalls++;
      assert.equal(options.method, 'POST');
      assert.match(String(options.body), /grant_type=client_credentials/);
      return new Response(JSON.stringify({ access_token: 'test-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    const start = Number(parsed.searchParams.get('start')); apiStarts.push(start);
    const count = start === 0 ? 100 : 37;
    return new Response(JSON.stringify(Array.from({ length: count }, (_, i) => ({ displayId: start + i + 1, display: `Screen ${start + i + 1}` }))), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new XiboClient({ baseUrl: 'https://cms.example.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fakeFetch });
  const displays = await client.listDisplays({ pageSize: 100 });
  assert.equal(displays.length, 137); assert.deepEqual(apiStarts, [0, 100]); assert.equal(authCalls, 1);
});

test('Xibo client rejects insecure remote HTTP and does not expose secrets', () => {
  assert.throws(() => new XiboClient({ baseUrl: 'http://cms.example.test', clientId: 'id', clientSecret: 'secret' }), XiboConfigError);
  const client = new XiboClient({ baseUrl: 'http://127.0.0.1:8088', clientId: 'id', clientSecret: 'secret' });
  assert.deepEqual(client.publicInfo(), { configured: true, origin: 'http://127.0.0.1:8088', path: '/' });
  assert.equal(JSON.stringify(client.publicInfo()).includes('secret'), false);
});

test('Xibo display normalization has stable neutral fleet fields', () => {
  const display = normalizeXiboDisplay({ displayId: 42, display: 'Lobby', description: 'Kazan', loggedIn: 1, licensed: 1, currentLayout: 'Morning' }, '2026-09-23T00:00:00.000Z');
  assert.equal(display.externalId, '42'); assert.equal(display.status, 'online'); assert.equal(display.authorized, true); assert.equal(display.currentContent, 'Morning');
});

test('Xibo catalog normalization rejects missing IDs', () => {
  const media = normalizeXiboCatalog('media', { mediaId: 9, name: 'Clip', mediaType: 'video' }, '2026-09-23T00:00:00.000Z');
  assert.equal(media.externalId, '9'); assert.equal(media.kind, 'media'); assert.equal(media.status, 'video');
  assert.throws(() => normalizeXiboCatalog('layout', { layout: 'Broken' }), /идентификатор/);
});

test('source branding is neutralized in user-facing imported names', () => {
  assert.equal(normalizeXiboCatalog('media', { mediaId: 9, name: 'XIBO Logo.png', mediaType: 'image' }).name, 'CMS Logo.png');
  assert.equal(normalizeXiboDisplay({ displayId: 7, display: 'Xibo foyer' }).name, 'CMS foyer');
});

test('media upload uses an authenticated multipart request', async () => {
  const calls = [];
  const fakeFetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/api/authorize/access_token')) return new Response(JSON.stringify({ access_token: 'upload-token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    return new Response(JSON.stringify({ mediaId: 77 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const client = new XiboClient({ baseUrl: 'https://cms.example.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fakeFetch });
  const result = await client.uploadMedia({ buffer: Buffer.from('test-media'), name: 'demo.webm', type: 'video/webm' });
  assert.equal(result.mediaId, 77); assert.equal(calls[1].options.method, 'POST'); assert.equal(calls[1].options.headers.Authorization, 'Bearer upload-token');
  assert.equal(calls[1].options.body instanceof FormData, true); assert.equal(calls[1].options.body.get('name'), 'demo.webm');
});

test('Xibo snapshot reads displays, media, layouts, campaigns and schedules', async () => {
  const paths = [];
  const fakeFetch = async (url, options = {}) => {
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/api/authorize/access_token')) return new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    paths.push(parsed.pathname);
    const endpoint = parsed.pathname.split('/').pop();
    const rows = { display: [{ displayId: 1 }], library: [{ mediaId: 2 }], layout: [{ layoutId: 3 }], campaign: [{ campaignId: 4 }], schedule: [{ eventId: 5 }] }[endpoint];
    assert.equal(options.headers.Authorization, 'Bearer token');
    return new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const snapshot = await new XiboClient({ baseUrl: 'https://cms.example.test', clientId: 'id', clientSecret: 'secret', fetchImpl: fakeFetch }).readSnapshot();
  assert.deepEqual(Object.fromEntries(Object.entries(snapshot).map(([key, value]) => [key, value.length])), { displays: 1, media: 1, layouts: 1, campaigns: 1, schedules: 1 });
  assert.equal(new Set(paths).size, 5);
});
