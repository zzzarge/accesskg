import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROFILES, getProfile } from '../js/lib/profiles.js';
import { whyBlocked, isActive } from '../js/lib/barriers.js';
import { trustIndex, daysSinceCheck } from '../js/lib/trust.js';
import { haversine, distanceToLine, squareAround, inBishkek } from '../js/lib/geo.js';
import { rankBarriers, rankingToCsv } from '../js/lib/ranking.js';
import { avoidPolygons, barriersOnRoute, pointsAlongRoute } from '../js/lib/route-analysis.js';

const NOW = Date.parse('2026-10-21T00:00:00Z');
const daysAgo = d => new Date(NOW - d * 86400e3).toISOString();
const pt = o => ({ id: Math.random().toString(36), title: 't', lat: 42.875, lng: 74.603, source: 'user', created_at: daysAgo(1), still_votes: 0, gone_votes: 0, ...o });

test('бордюр 15 см блокирует коляску, съезд 1 см — нет', () => {
  assert.match(whyBlocked(pt({ kind: 'curb_high', curb_cm: 15 }), PROFILES.manual), /бордюр 15 см/);
  assert.equal(whyBlocked(pt({ kind: 'curb_ramp', curb_cm: 1 }), PROFILES.manual), null);
});

test('детская коляска проходит бордюр 8 см и разбитое покрытие, ручная — нет', () => {
  const curb8 = pt({ kind: 'curb_high', curb_cm: 8 }), broken = pt({ kind: 'broken' });
  assert.equal(whyBlocked(curb8, PROFILES.stroller), null);
  assert.equal(whyBlocked(broken, PROFILES.stroller), null);
  assert.ok(whyBlocked(curb8, PROFILES.manual));
  assert.ok(whyBlocked(broken, PROFILES.manual));
});

test('ступени и временные препятствия блокируют все профили', () => {
  for (const p of Object.values(PROFILES)) {
    assert.ok(whyBlocked(pt({ kind: 'steps' }), p));
    assert.ok(whyBlocked(pt({ kind: 'temp', title: 'Машина на тротуаре' }), p));
  }
});

test('уклон и ширина прохода', () => {
  assert.match(whyBlocked(pt({ kind: 'ramp', slope_pct: 9 }), PROFILES.manual), /уклон 9%/);
  assert.equal(whyBlocked(pt({ kind: 'ramp', slope_pct: 5 }), PROFILES.manual), null);
  assert.match(whyBlocked(pt({ kind: 'narrow', width_cm: 60 }), PROFILES.manual), /проход 60 см/);
  assert.equal(whyBlocked(pt({ kind: 'narrow', width_cm: 60 }), PROFILES.stroller), null);
});

test('строки из формы (числа текстом) обрабатываются', () => {
  assert.ok(whyBlocked(pt({ kind: 'curb_high', curb_cm: '12' }), PROFILES.manual));
  assert.equal(whyBlocked(pt({ kind: 'curb_high', curb_cm: '' }), PROFILES.manual), null);
});

test('истёкшее временное и опровергнутое — неактивны', () => {
  assert.equal(isActive(pt({ kind: 'temp', expires_at: daysAgo(0.01) }), NOW), false);
  assert.equal(isActive(pt({ kind: 'temp', expires_at: new Date(NOW + 3600e3).toISOString() }), NOW), true);
  assert.equal(isActive(pt({ gone_votes: 2, still_votes: 1 }), NOW), false);
  assert.equal(isActive(pt({ gone_votes: 1, still_votes: 0 }), NOW), true);
  assert.equal(isActive(pt({ gone_votes: 2, still_votes: 3 }), NOW), true);
});

test('индекс доверия: команда + свежая проверка = высокий; старый одиночный отчёт = низкий', () => {
  const team = trustIndex(pt({ source: 'team', still_votes: 2, created_at: daysAgo(4) }), NOW);
  assert.equal(team.level, 'high');
  assert.equal(team.parts.source, 40);
  const old = trustIndex(pt({ source: 'user', created_at: daysAgo(200) }), NOW);
  assert.equal(old.level, 'low');
  assert.equal(old.parts.fresh, 0);
  assert.ok(team.score <= 100);
});

test('подтверждение обновляет свежесть', () => {
  const p = pt({ created_at: daysAgo(90), last_still_at: daysAgo(2) });
  assert.equal(daysSinceCheck(p, NOW), 2);
});

test('геометрия: расстояния и зона обхода', () => {
  const d = haversine(42.8746, 74.6037, 42.8756, 74.6037);
  assert.ok(Math.abs(d - 111) < 2, `~111 м, получили ${d}`);
  const line = [[74.6000, 42.8750], [74.6100, 42.8750]];
  assert.ok(distanceToLine(42.8750, 74.6050, line) < 0.5);
  const off = distanceToLine(42.8751, 74.6050, line);
  assert.ok(off > 10 && off < 12, `~11 м, получили ${off}`);
  const ring = squareAround(42.875, 74.603, 6);
  assert.equal(ring.length, 5);
  assert.deepEqual(ring[0], ring[4]);
  assert.ok(inBishkek(42.875, 74.603));
  assert.ok(!inBishkek(43.24, 76.89)); // Алматы
});

test('анализ маршрута: барьер на линии найден, далёкий — нет', () => {
  const line = [[74.6000, 42.8750], [74.6100, 42.8750]];
  const near = pt({ kind: 'curb_high', curb_cm: 15, lat: 42.87503, lng: 74.6050 });
  const far = pt({ kind: 'curb_high', curb_cm: 15, lat: 42.8800, lng: 74.6050 });
  const good = pt({ kind: 'curb_ramp', curb_cm: 1, lat: 42.8750, lng: 74.6020 });
  const found = barriersOnRoute(line, [near, far, good], PROFILES.manual, NOW);
  assert.equal(found.length, 1);
  assert.equal(found[0].point, near);
  assert.equal(pointsAlongRoute(line, [near, far, good], NOW).length, 2);
  assert.equal(avoidPolygons([near, far, good], PROFILES.manual, NOW).length, 2);
  assert.equal(avoidPolygons([near, far, good], PROFILES.stroller, NOW).length, 2); // 15 см > 8
});

test('рейтинг: барьер у школы и поликлиники выше барьера у магазина', () => {
  const a = pt({ id: 'a', kind: 'curb_high', curb_cm: 15, lat: 42.8750, lng: 74.6000 });
  const b = pt({ id: 'b', kind: 'steps', lat: 42.8800, lng: 74.6100 });
  const t = pt({ id: 't', kind: 'temp', title: 'машина', lat: 42.8750, lng: 74.6001 });
  const places = [
    { name: 'Школа', category: 'school', lat: 42.8752, lng: 74.6002 },
    { name: 'Поликлиника', category: 'clinic', lat: 42.8748, lng: 74.6010 },
    { name: 'Магазин', category: 'shop', lat: 42.8801, lng: 74.6101 },
  ];
  const r = rankBarriers([b, a, t], places, PROFILES.manual, { now: NOW });
  assert.deepEqual(r.map(x => x.point.id), ['a', 'b']); // временные не попадают в рейтинг
  assert.equal(r[0].nearby.length, 2);
  const csv = rankingToCsv(r);
  assert.match(csv.split('\r\n')[0], /Оценка охвата/);
  assert.equal(csv.split('\r\n').length, 3);
  assert.ok(csv.split('\r\n')[0].includes(';'));
});

test('неизвестный профиль → ручная коляска', () => {
  assert.equal(getProfile('nope').id, 'manual');
});

test('CSV: формулы из названий не выполняются в Excel', () => {
  const row = { point: { title: '=HYPERLINK("x")', lat: 1, lng: 2 }, reason: 'r', score: 1, nearby: [] };
  assert.match(rankingToCsv([row]), /"'=HYPERLINK/);
});

test('точку команды не убрать двумя голосами', () => {
  assert.equal(isActive(pt({ source: 'team', gone_votes: 2 }), NOW), true);
  assert.equal(isActive(pt({ source: 'team', gone_votes: 4, still_votes: 1 }), NOW), false);
});

test('зоны обхода: без барьеров у точек A/B и вне коридора, ближние — первыми', () => {
  const from = { lat: 42.8750, lng: 74.6000 }, to = { lat: 42.8750, lng: 74.6100 };
  const atB = pt({ kind: 'steps', lat: 42.87501, lng: 74.6100 });
  const mid = pt({ kind: 'steps', lat: 42.8751, lng: 74.6050 });
  const far = pt({ kind: 'steps', lat: 42.8900, lng: 74.6050 });
  const polys = avoidPolygons([far, atB, mid], PROFILES.manual, NOW, from, to);
  assert.equal(polys.length, 1);
  assert.ok(Math.abs(polys[0][0][0][1] - 42.8751) < 0.0001);
});
