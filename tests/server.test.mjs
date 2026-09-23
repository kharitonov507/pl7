import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server.mjs';
let app, base;
const temp = mkdtempSync(path.join(os.tmpdir(), 'dooh-test-'));
const post = (url, data, headers = {}) => fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(data) });
before(async () => { app = createApp({ dataDir: temp }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${app.server.address().port}`; });
after(async () => { await new Promise(resolve => app.server.close(resolve)); rmSync(temp, { recursive: true, force: true }); });
test('three devices and default playlists are available', async () => {
  const s = await (await fetch(base + '/api/state')).json(); assert.equal(s.devices.length, 3); assert.ok(s.assets.length >= 3);
  const m = await (await fetch(base + '/api/devices/screen-01/manifest')).json(); assert.equal(m.schedule.playlistId, 'morning');
});
test('offline blocks agent API but not dashboard; reconnect restores API', async () => {
  assert.equal((await post('/api/devices/screen-03/connection', { offline: true })).status, 200);
  assert.equal((await fetch(base + '/api/devices/screen-03/manifest')).status, 503);
  assert.equal((await post('/api/devices/screen-03/heartbeat', {})).status, 503);
  assert.equal((await fetch(base + '/api/state')).status, 200);
  await post('/api/devices/screen-03/connection', { offline: false });
  assert.equal((await fetch(base + '/api/devices/screen-03/manifest')).status, 200);
});
test('PoP batches are idempotent and invalid batches are atomic', async () => {
  const e = { eventId: 'test-event', sessionId: 'test-session', assetId: 'coffee', kind: 'completed', occurredAt: new Date().toISOString(), playedMs: 8000 };
  assert.equal((await post('/api/devices/screen-01/events', { events: [e, e] })).status, 200);
  assert.equal((await post('/api/devices/screen-01/events', { events: [e] })).status, 200);
  const report = await (await fetch(base + '/api/report')).json(); assert.equal(report.events.length, 1);
  assert.equal((await post('/api/devices/screen-01/events', { events: [{ ...e, eventId: 'another' }, { ...e, eventId: 'invalid', assetId: 'missing' }] })).status, 400);
  assert.equal((await (await fetch(base + '/api/report')).json()).events.length, 1);
});
test('playlist and schedule validation; manifest version increments', async () => {
  assert.equal((await post('/api/playlists', { name: 'Empty', items: [] })).status, 400);
  const p = await (await post('/api/playlists', { name: 'Custom', items: [{ assetId: 'studio', duration: 5 }] })).json();
  const result = await post('/api/devices/screen-02/config', { playlistId: p.id, startsAt: 'invalid' }); assert.equal(result.status, 400);
  assert.equal((await post('/api/devices/screen-02/config', { playlistId: p.id })).status, 200);
  const m = await (await fetch(base + '/api/devices/screen-02/manifest')).json(); assert.equal(m.version, 2); assert.equal(m.schedule.playlistId, p.id);
});
test('commands, safe upload validation, range requests and cross-origin protection', async () => {
  assert.equal((await post('/api/devices/screen-01/command', { action: 'pause' })).status, 200);
  assert.equal((await (await fetch(base + '/api/devices/screen-01/manifest')).json()).command.action, 'pause');
  assert.equal((await post('/api/devices/screen-01/command', { action: 'shell' })).status, 400);
  assert.equal((await post('/api/devices/screen-01/command', { action: 'pause' }, { Origin: 'https://example.com' })).status, 403);
  assert.equal((await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'text/html' }, body: '<script>bad</script>' })).status, 415);
  assert.equal((await fetch(base + '/api/assets', { method: 'POST', headers: { 'Content-Type': 'video/mp4' }, body: 'not really a video file' })).status, 415);
  const partial = await fetch(base + '/media/coffee.svg', { headers: { Range: 'bytes=0-19' } }); assert.equal(partial.status, 206); assert.equal((await partial.arrayBuffer()).byteLength, 20);
  assert.equal((await fetch(base + '/media/coffee.svg', { headers: { Range: 'bytes=999999-' } })).status, 416);
});
test('SQLite state persists across server restarts', async () => {
  await new Promise(resolve => app.server.close(resolve));
  app = createApp({ dataDir: temp }); await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); base = `http://127.0.0.1:${app.server.address().port}`;
  const report = await (await fetch(base + '/api/report')).json(); assert.equal(report.events.length, 1);
  const m = await (await fetch(base + '/api/devices/screen-02/manifest')).json(); assert.equal(m.version, 2);
});

test('native registration pins local bridge URLs and Go reports are scoped', async () => {
  const device = { deviceId: 'go-screen-01', name: 'Native test', playlistId: 'morning', rendererUrl: 'http://127.0.0.1:8791/' };
  assert.equal((await post('/api/devices/register', { ...device, rendererUrl: 'https://evil.example/' })).status, 400);
  assert.equal((await post('/api/devices/register', device)).status, 201);
  assert.equal((await post('/api/devices/register', device)).status, 200);
  const s = await (await fetch(base + '/api/state?agents=go')).json();
  assert.equal(s.devices.length, 1); assert.equal(s.devices[0].renderer_url, device.rendererUrl); assert.equal(s.events.length, 0); assert.equal(s.stats.total, 0);
  const report = await (await fetch(base + '/api/report?agents=go')).json(); assert.equal(report.devices.length, 1); assert.equal(report.events.length, 0);
});

test('optional native ingress token rejects unauthenticated requests', async () => {
  const tokenDirectory = mkdtempSync(path.join(os.tmpdir(), 'dooh-token-test-'));
  const secured = createApp({ dataDir: tokenDirectory, deviceToken: 'test-only-secret' });
  await new Promise(resolve => secured.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${secured.server.address().port}`;
  try {
    const input = { deviceId: 'go-screen-02', name: 'Secured native test', playlistId: 'morning', rendererUrl: 'http://127.0.0.1:8792/' };
    assert.equal((await fetch(url + '/api/devices/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) })).status, 401);
    assert.equal((await fetch(url + '/api/devices/register', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-only-secret' }, body: JSON.stringify(input) })).status, 201);
    assert.equal((await fetch(url + '/api/devices/go-screen-02/manifest')).status, 401);
    assert.equal((await fetch(url + '/api/devices/go-screen-02/manifest', { headers: { Authorization: 'Bearer test-only-secret' } })).status, 200);
    assert.equal((await fetch(url + '/api/devices/screen-01/manifest')).status, 200);
  } finally { await new Promise(resolve => secured.server.close(resolve)); rmSync(tokenDirectory, { recursive: true, force: true }); }
});

test('fleet endpoint paginates 100 simulated screens and mixes in real players', async () => {
  const first = await (await fetch(base + '/api/fleet?demo=100&page=1&pageSize=25')).json();
  assert.equal(first.summary.total, 100); assert.equal(first.items.length, 25); assert.equal(first.pages, 4); assert.equal(first.simulated, true);
  const last = await (await fetch(base + '/api/fleet?demo=100&page=4&pageSize=25')).json();
  assert.equal(last.items.length, 25); assert.equal(last.items[0].externalId, 'sim-076');
  const real = await (await fetch(base + '/api/fleet')).json();
  assert.equal(real.items.some(item => item.provider === 'simulation'), false);
  const unified = await (await fetch(base + '/api/fleet?demo=100&includeReal=1&pageSize=100')).json();
  assert.equal(unified.summary.total, 100); assert.equal(unified.items.length, 100);
  assert.equal(unified.items.some(item => item.provider === 'native' || item.provider === 'browser'), true);
  assert.equal(unified.items.some(item => item.provider === 'simulation'), true);
});

test('every fleet screen has persistent individual configuration', async () => {
  const beforeResponse = await fetch(base + '/api/fleet/simulation/sim-100/config');
  assert.equal(beforeResponse.status, 200);
  const before = await beforeResponse.json();
  assert.equal(before.name, 'Плеер 100'); assert.ok(before.playlists.length >= 3);
  const changed = await post('/api/fleet/simulation/sim-100/config', {
    name: 'Экран дирекции', location: 'Казань · этаж 10', playlistId: 'cityloop', fallbackId: 'morning'
  });
  assert.equal(changed.status, 200); assert.equal((await changed.json()).delivery, 'prototype');
  const after = await (await fetch(base + '/api/fleet/simulation/sim-100/config')).json();
  assert.equal(after.name, 'Экран дирекции'); assert.equal(after.playlistId, 'cityloop'); assert.equal(after.version, 1);
  const fleet = await (await fetch(base + '/api/fleet?demo=100&pageSize=100')).json();
  assert.equal(fleet.items.find(item => item.externalId === 'sim-100').location, 'Казань · этаж 10');

  const local = await post('/api/fleet/browser/screen-01/config', {
    name: 'Вход — тест', location: 'Главный вход', playlistId: 'creative', fallbackId: 'morning'
  });
  assert.equal(local.status, 200); assert.equal((await local.json()).delivery, 'player');
  const manifest = await (await fetch(base + '/api/devices/screen-01/manifest')).json();
  assert.equal(manifest.name, 'Вход — тест'); assert.equal(manifest.schedule.playlistId, 'creative');
  assert.equal((await fetch(base + '/api/fleet/simulation/sim-999/config')).status, 404);
});

test('Xibo sync imports an external inventory without exposing credentials', async () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'player-control-xibo-'));
  const fakeXibo = {
    publicInfo: () => ({ configured: true, origin: 'https://cms.example.test', path: '/' }),
    readSnapshot: async () => ({
      displays: Array.from({ length: 100 }, (_, index) => ({ displayId: index + 1, display: `Xibo ${index + 1}`, description: `Site ${Math.floor(index / 10) + 1}`, loggedIn: index < 80 ? 1 : 0, licensed: 1 })),
      media: [{ mediaId: 10, name: 'Promo', mediaType: 'video' }],
      layouts: [{ layoutId: 20, layout: 'Main layout', status: 3 }],
      campaigns: [{ campaignId: 30, campaign: 'September', isRetired: 0 }],
      schedules: [{ eventId: 40, name: 'Always', eventType: 'campaign' }]
    })
  };
  const integrated = createApp({ dataDir: directory, xiboClient: fakeXibo });
  await new Promise(resolve => integrated.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${integrated.server.address().port}`;
  try {
    const sync = await (await fetch(url + '/api/integrations/xibo/sync', { method: 'POST' })).json();
    assert.equal(sync.imported, 100);
    const fleet = await (await fetch(url + '/api/fleet?provider=xibo&pageSize=100')).json();
    assert.equal(fleet.summary.total, 100); assert.equal(fleet.summary.online, 80); assert.equal(fleet.items[0].provider, 'xibo');
    const status = await (await fetch(url + '/api/integrations/xibo/status')).json();
    assert.equal(status.itemCount, 100); assert.deepEqual(status.catalogCounts, { media: 1, layout: 1, campaign: 1, schedule: 1 }); assert.equal(JSON.stringify(status).includes('secret'), false);
    const catalog = await (await fetch(url + '/api/integrations/xibo/catalog?kind=media')).json();
    assert.equal(catalog.total, 1); assert.equal(catalog.items[0].name, 'Promo');
  } finally { await new Promise(resolve => integrated.server.close(resolve)); rmSync(directory, { recursive: true, force: true }); }
});
