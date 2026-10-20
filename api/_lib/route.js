// Построение маршрута через OpenRouteService. Ключ ORS живёт только на сервере.
import { PROFILES } from '../../js/lib/profiles.js';
import { inBishkek } from '../../js/lib/geo.js';
import { MAX_AVOID } from '../../js/lib/route-analysis.js';

const ORS_URL = 'https://api.openrouteservice.org/v2/directions';

function validRing(ring) {
  return Array.isArray(ring) && ring.length >= 4 && ring.length <= 10 &&
    ring.every(c => Array.isArray(c) && c.length === 2 && inBishkek(c[1], c[0]));
}

// body: { from:[lng,lat], to:[lng,lat], mode:'foot'|'wheel', profile:'manual'|..., avoid:[ [ring], ... ] }
export async function handleRoute(body, env, fetchImpl = fetch) {
  if (!env.ORS_API_KEY) return { status: 500, json: { error: 'config', message: 'На сервере не задан ORS_API_KEY.' } };
  const { from, to, mode = 'wheel', profile = 'manual', avoid = [] } = body || {};
  const okPt = p => Array.isArray(p) && p.length === 2 && inBishkek(Number(p[1]), Number(p[0]));
  if (!okPt(from) || !okPt(to)) return { status: 400, json: { error: 'bad_points', message: 'Точки маршрута должны быть в Бишкеке.' } };
  if (mode !== 'foot' && mode !== 'wheel') return { status: 400, json: { error: 'bad_mode' } };
  const prof = PROFILES[profile];
  if (mode === 'wheel' && !prof) return { status: 400, json: { error: 'bad_profile' } };
  if (!Array.isArray(avoid) || avoid.length > MAX_AVOID || !avoid.every(p => Array.isArray(p) && p.length === 1 && validRing(p[0]))) {
    return { status: 400, json: { error: 'bad_avoid' } };
  }

  const orsProfile = mode === 'foot' ? 'foot-walking' : 'wheelchair';
  const req = { coordinates: [from.map(Number), to.map(Number)], instructions: false, elevation: false };
  const options = {};
  if (mode === 'wheel') options.profile_params = { restrictions: { ...prof.ors } };
  // Зоны обхода работают для обоих режимов: если в OpenStreetMap мало данных о тротуарах
  // и профиль wheelchair не находит путь, приложение строит пеший маршрут в обход наших барьеров.
  if (avoid.length) options.avoid_polygons = { type: 'MultiPolygon', coordinates: avoid };
  if (Object.keys(options).length) req.options = options;

  let res;
  try {
    res = await fetchImpl(`${ORS_URL}/${orsProfile}/geojson`, {
      method: 'POST',
      headers: { Authorization: env.ORS_API_KEY, 'Content-Type': 'application/json', Accept: 'application/geo+json' },
      body: JSON.stringify(req),
    });
  } catch {
    return { status: 502, json: { error: 'network', message: 'Сервис маршрутов недоступен. Попробуйте ещё раз.' } };
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error?.code;
    if (code === 2004) return { status: 400, json: { error: 'limits', message: 'Маршрут слишком длинный или сложный для сервиса. Выберите точки ближе.' } };
    // 2009/2010 — маршрут не найден с такими ограничениями
    if (res.status === 404 || [2009, 2010].includes(code)) {
      return { status: 404, json: { error: 'no_route', message: 'Доступного маршрута с такими ограничениями нет.' } };
    }
    if (res.status === 429) return { status: 429, json: { error: 'rate_limit', message: 'Лимит запросов к картам исчерпан, попробуйте через минуту.' } };
    return { status: 502, json: { error: 'ors', message: data?.error?.message || 'Ошибка сервиса маршрутов.' } };
  }
  const f = data?.features?.[0];
  if (!f) return { status: 404, json: { error: 'no_route', message: 'Маршрут не найден.' } };
  return {
    status: 200,
    json: {
      line: f.geometry.coordinates.map(c => [c[0], c[1]]),
      distance: Math.round(f.properties?.summary?.distance || 0),
      duration: Math.round(f.properties?.summary?.duration || 0),
    },
  };
}
