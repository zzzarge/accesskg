// Индекс доверия точки, 0–100:
//   источник до 40 (команда на месте 40, пользователь с фото 30, без фото 15)
// + подтверждения до 30 (10 за каждое «всё ещё так», максимум 3)
// + свежесть до 30 (линейно падает до нуля за 180 дней с последней проверки).
const DAY = 86400e3;
export const FRESH_DAYS = 30;

export function lastCheckedAt(point) {
  const created = new Date(point.created_at).getTime();
  const still = point.last_still_at ? new Date(point.last_still_at).getTime() : 0;
  return Math.max(created, still);
}

export function daysSinceCheck(point, now = Date.now()) {
  return Math.max(0, Math.floor((now - lastCheckedAt(point)) / DAY));
}

export function trustIndex(point, now = Date.now()) {
  const source = point.source === 'team' ? 40 : point.photo_url ? 30 : 15;
  const votes = Math.min(point.still_votes || 0, 3) * 10;
  const days = daysSinceCheck(point, now);
  const fresh = Math.round(30 * Math.max(0, 1 - days / 180));
  const score = source + votes + fresh;
  const level = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return { score, level, days, parts: { source, votes, fresh } };
}

export const LEVEL_LABEL = { high: 'высокий', medium: 'средний', low: 'низкий' };
