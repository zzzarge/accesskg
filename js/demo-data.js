// Встроенные демо-данные для работы без Supabase. Те же, что в supabase/demo_seed.sql.
// Координаты условные — это не проверенные барьеры.
const ago = d => new Date(Date.now() - d * 86400e3).toISOString();
let n = 0;
const P = (kind, title, lat, lng, extra = {}) => ({
  id: `demo-${++n}`, kind, title: `[демо] ${title}`, lat, lng, curb_cm: null, slope_pct: null, width_cm: null,
  photo_url: null, source: 'team', expires_at: null, is_demo: true, created_at: ago(5),
  still_votes: 1, gone_votes: 0, last_still_at: null, ...extra,
});

export function demoPoints() {
  n = 0;
  return [
    P('curb_high', 'Высокий бордюр без съезда', 42.87480, 74.60320, { curb_cm: 15, created_at: ago(4), still_votes: 2 }),
    P('curb_high', 'Бордюр 8 см на переходе', 42.87560, 74.60420, { curb_cm: 8, created_at: ago(6) }),
    P('slope', 'Крутой подъём', 42.87650, 74.60480, { slope_pct: 11, created_at: ago(2), still_votes: 3 }),
    P('broken', 'Разбитый тротуар', 42.87740, 74.60650, { source: 'user', created_at: ago(12), still_votes: 2 }),
    P('steps', 'Ступени подземного перехода', 42.87530, 74.60180, { created_at: ago(3), still_votes: 3 }),
    P('curb_ramp', 'Съезд с бордюра', 42.87700, 74.60300, { curb_cm: 1 }),
    P('ramp', 'Пандус у входа', 42.87810, 74.60760, { slope_pct: 5, created_at: ago(7) }),
    P('narrow', 'Узкий проход между столбами', 42.87690, 74.60860, { width_cm: 60, source: 'user', created_at: ago(40), still_votes: 0 }),
    P('temp', 'Машина на тротуаре', 42.87600, 74.60700, { source: 'user', created_at: ago(0), still_votes: 0, expires_at: new Date(Date.now() + 3 * 3600e3).toISOString() }),
  ];
}

export function demoPlaces() {
  return [
    { id: 'pl-1', name: '[демо] Остановка', category: 'stop', lat: 42.87420, lng: 74.60150, passport: { 'Посадка': 'Высокий бордюр у края', 'Навес': 'Есть' }, is_demo: true },
    { id: 'pl-2', name: '[демо] Поликлиника', category: 'clinic', lat: 42.87820, lng: 74.60780, passport: { 'Ступени у входа': '3', 'Пандус': 'Есть, уклон 9%, с помощником', 'Ширина двери': '90 см', 'Кнопка вызова': 'Нет', 'Доступный туалет': 'Нет' }, is_demo: true },
    { id: 'pl-3', name: '[демо] Школа', category: 'school', lat: 42.87900, lng: 74.60200, passport: { 'Ступени у входа': '4', 'Пандус': 'Нет', 'Кнопка вызова': 'Есть' }, is_demo: true },
    { id: 'pl-4', name: '[демо] Аптека', category: 'pharmacy', lat: 42.87600, lng: 74.60600, passport: { 'Вход': 'Без ступеней', 'Ширина двери': '80 см' }, is_demo: true },
    { id: 'pl-5', name: '[демо] ЦОН', category: 'gov', lat: 42.87450, lng: 74.60950, passport: { 'Пандус': 'Есть, уклон 5%', 'Кнопка вызова': 'Есть', 'Доступный туалет': 'Есть' }, is_demo: true },
  ];
}
