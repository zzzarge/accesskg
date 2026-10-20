// «Где ремонт даст больше всего пользы» — рейтинг барьеров для мэрии.
// Для каждого постоянного барьера, который непроходим для профиля, считаем,
// сколько важных мест рядом (в радиусе radius метров) он отрезает.
// Ближе и важнее место — больше вклад. Это простая и объяснимая оценка охвата.
import { whyBlocked, isActive, isTemporary, KINDS } from './barriers.js';
import { haversine } from './geo.js';

export const CATEGORY = {
  school:   { label: 'Школа',        weight: 3 },
  clinic:   { label: 'Поликлиника',  weight: 3 },
  pharmacy: { label: 'Аптека',       weight: 2 },
  stop:     { label: 'Остановка',    weight: 2 },
  gov:      { label: 'Госучреждение', weight: 2 },
  shop:     { label: 'Магазин',      weight: 1 },
  other:    { label: 'Другое',       weight: 1 },
};

export function rankBarriers(points, places, profile, { radius = 300, now = Date.now(), limit = 20 } = {}) {
  return points
    .filter(p => isActive(p, now) && !isTemporary(p) && !KINDS[p.kind]?.good && whyBlocked(p, profile))
    .map(p => {
      const nearby = places
        .map(pl => ({ place: pl, dist: Math.round(haversine(p.lat, p.lng, pl.lat, pl.lng)) }))
        .filter(n => n.dist <= radius)
        .sort((a, b) => a.dist - b.dist);
      const score = nearby.reduce((s, n) => s + (CATEGORY[n.place.category]?.weight || 1) * (1 - n.dist / radius), 0);
      return { point: p, reason: whyBlocked(p, profile), nearby, score: Math.round(score * 10) / 10 };
    })
    .filter(r => r.nearby.length > 0)
    .sort((a, b) => b.score - a.score || (b.point.still_votes || 0) - (a.point.still_votes || 0))
    .slice(0, limit);
}

// CSV для передачи в мэрию.
export function rankingToCsv(rows) {
  // Excel с русской локалью делит по «;». Значения, начинающиеся с = + - @, Excel выполнит как формулу — экранируем.
  const esc = v => { let s = String(v ?? ''); if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; return `"${s.replace(/"/g, '""')}"`; };
  const head = ['Место', 'Барьер', 'Причина', 'Широта', 'Долгота', 'Оценка охвата', 'Важные места рядом'];
  const lines = rows.map((r, i) => [
    i + 1, r.point.title, r.reason, r.point.lat, r.point.lng, r.score,
    r.nearby.map(n => `${n.place.name} (${n.dist} м)`).join('; '),
  ].map(esc).join(';'));
  return [head.map(esc).join(';'), ...lines].join('\r\n');
}
