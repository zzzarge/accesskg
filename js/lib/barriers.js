// Типы точек и правило «проходит ли человек с этим профилем».

export const KINDS = {
  curb_ramp: { label: 'Съезд с бордюра',        good: true,  fields: ['curb_cm'] },
  ramp:      { label: 'Пандус',                 good: true,  fields: ['slope_pct', 'width_cm'] },
  curb_high: { label: 'Высокий бордюр',         good: false, fields: ['curb_cm'] },
  steps:     { label: 'Ступени',                good: false, fields: [] },
  slope:     { label: 'Крутой уклон',           good: false, fields: ['slope_pct'] },
  broken:    { label: 'Разбитое покрытие',      good: false, fields: [] },
  narrow:    { label: 'Узкий проход',           good: false, fields: ['width_cm'] },
  temp:      { label: 'Временное препятствие',  good: false, fields: [] },
};

// Сколько живёт временное препятствие, если его не подтвердить снова.
export const TEMP_TTL = {
  car:   { label: 'Машина на тротуаре',   hours: 4 },
  works: { label: 'Раскопки или ремонт',  hours: 24 * 7 },
  other: { label: 'Другое',               hours: 24 },
};

const num = v => (v === null || v === undefined || v === '' ? null : Number(v));

// Причина, по которой точка непроходима для профиля, или null, если проходима.
export function whyBlocked(point, profile) {
  const curb = num(point.curb_cm), slope = num(point.slope_pct), width = num(point.width_cm);
  switch (point.kind) {
    case 'steps':  return 'ступени';
    case 'temp':   return point.title || 'временное препятствие';
    case 'broken': return profile.broken ? null : 'разбитое покрытие';
  }
  if (curb !== null && curb > profile.curb) return `бордюр ${curb} см (можно до ${profile.curb} см)`;
  if (slope !== null && slope > profile.slope) return `уклон ${slope}% (можно до ${profile.slope}%)`;
  if (width !== null && width < profile.width) return `проход ${width} см (нужно от ${profile.width} см)`;
  return null;
}

// Точка ещё актуальна: временная не истекла и её не отметили как устаревшую.
export function isActive(point, now = Date.now()) {
  if (point.expires_at && new Date(point.expires_at).getTime() <= now) return false;
  const gone = point.gone_votes || 0, still = point.still_votes || 0;
  // Точку команды убрать сложнее: проверенный на месте барьер не должен исчезать от пары голосов.
  const need = point.source === 'team' ? 4 : 2;
  if (gone >= need && gone > still) return false;
  return true;
}

export function isTemporary(point) {
  return point.kind === 'temp' || !!point.expires_at;
}
