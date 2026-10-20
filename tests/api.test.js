import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleRoute } from '../api/_lib/route.js';
import { handleTeam, cleanPoint } from '../api/_lib/team.js';
import { squareAround } from '../js/lib/geo.js';

const A = [74.6015, 42.8742], B = [74.6078, 42.8782];
const env = { ORS_API_KEY: 'k' };
const fakeFetch = (status, data, seen = {}) => async (url, init) => {
  seen.url = url; seen.body = JSON.parse(init.body); seen.headers = init.headers;
  return { ok: status < 400, status, json: async () => data };
};
const okGeo = { features: [{ geometry: { coordinates: [[74.6015, 42.8742, 800], [74.6078, 42.8782, 801]] }, properties: { summary: { distance: 700.4, duration: 600.6 } } }] };

test('маршрут для коляски: профиль wheelchair, ограничения и зоны обхода уходят в ORS', async () => {
  const seen = {};
  const avoid = [[squareAround(42.876, 74.604)]];
  const r = await handleRoute({ from: A, to: B, mode: 'wheel', profile: 'manual', avoid }, env, fakeFetch(200, okGeo, seen));
  assert.equal(r.status, 200);
  assert.equal(r.json.distance, 700);
  assert.deepEqual(r.json.line[0], [74.6015, 42.8742]);
  assert.match(seen.url, /\/wheelchair\/geojson$/);
  assert.equal(seen.headers.Authorization, 'k');
  assert.equal(seen.body.options.profile_params.restrictions.maximum_incline, 6);
  assert.equal(seen.body.options.avoid_polygons.type, 'MultiPolygon');
  assert.equal(seen.body.options.avoid_polygons.coordinates.length, 1);
});

test('пеший маршрут без ограничений', async () => {
  const seen = {};
  const r = await handleRoute({ from: A, to: B, mode: 'foot' }, env, fakeFetch(200, okGeo, seen));
  assert.equal(r.status, 200);
  assert.match(seen.url, /\/foot-walking\/geojson$/);
  assert.equal(seen.body.options, undefined);
});

test('точки вне Бишкека и мусорные зоны отклоняются', async () => {
  const f = fakeFetch(200, okGeo);
  assert.equal((await handleRoute({ from: [76.89, 43.24], to: B }, env, f)).status, 400);
  assert.equal((await handleRoute({ from: A, to: B, avoid: [[[[0, 0]]]] }, env, f)).status, 400);
  assert.equal((await handleRoute({ from: A, to: B, profile: 'rocket' }, env, f)).status, 400);
});

test('маршрут не найден → понятная ошибка; нет ключа → ошибка настройки', async () => {
  const r = await handleRoute({ from: A, to: B }, env, fakeFetch(404, { error: { code: 2009 } }));
  assert.equal(r.json.error, 'no_route');
  const c = await handleRoute({ from: A, to: B }, {}, fakeFetch(200, okGeo));
  assert.equal(c.json.error, 'config');
});

const tenv = { TEAM_CODE: 'vital-bros-long-code-2026', SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srk' };

test('командный код: неверный отклонён, верный проходит проверку', async () => {
  assert.equal((await handleTeam({ code: 'nope', check: true }, tenv, fetch, 0)).status, 403);
  assert.equal((await handleTeam({ code: 'vital-bros-long-code-2026', check: true }, tenv)).status, 200);
});

test('командная точка сохраняется с source=team и ключом service_role', async () => {
  const seen = {};
  const row = { kind: 'curb_high', title: 'Бордюр 15 см', lat: 42.875, lng: 74.603, curb_cm: '15', source: 'user', is_demo: true };
  const r = await handleTeam({ code: 'vital-bros-long-code-2026', table: 'points', row }, tenv, fakeFetch(201, [{ id: '1' }], seen));
  assert.equal(r.status, 200);
  assert.match(seen.url, /\/rest\/v1\/points$/);
  assert.equal(seen.headers.apikey, 'srk');
  assert.equal(seen.body.source, 'team');
  assert.equal(seen.body.curb_cm, 15);
  assert.equal(seen.body.is_demo, undefined);
});

test('проверка полей точки', () => {
  assert.ok(cleanPoint({ kind: 'lava', title: 'x', lat: 42.875, lng: 74.603 }).error);
  assert.ok(cleanPoint({ kind: 'steps', title: '', lat: 42.875, lng: 74.603 }).error);
  assert.ok(cleanPoint({ kind: 'curb_high', title: 'x', lat: 42.875, lng: 74.603, curb_cm: 500 }).error);
  assert.ok(cleanPoint({ kind: 'temp', title: 'x', lat: 42.875, lng: 74.603, expires_at: '2020-01-01' }).error);
  assert.ok(cleanPoint({ kind: 'steps', title: 'x', lat: 42.875, lng: 74.603 }).row);
});

test('короткий TEAM_CODE на сервере не принимается', async () => {
  const r = await handleTeam({ code: 'short', check: true }, { ...tenv, TEAM_CODE: 'short' }, fetch, 0);
  assert.equal(r.status, 500);
});

test('фото только из нашего хранилища; временное — только со сроком', () => {
  const base = { kind: 'steps', title: 'x', lat: 42.875, lng: 74.603 };
  const url = 'https://x.supabase.co';
  assert.ok(cleanPoint({ ...base, photo_url: 'https://evil.example/p.jpg' }, url).error);
  assert.ok(cleanPoint({ ...base, photo_url: url + '/storage/v1/object/public/photos/abcdefgh/1.jpg' }, url).row);
  assert.ok(cleanPoint({ ...base, kind: 'temp' }, url).error);
});

test('ошибка ORS 2004 — это лимиты, а не «нет маршрута»', async () => {
  const r = await handleRoute({ from: A, to: B }, env, fakeFetch(400, { error: { code: 2004 } }));
  assert.equal(r.json.error, 'limits');
});
