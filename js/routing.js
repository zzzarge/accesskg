// Запросы маршрутов к нашему серверу (/api/route), который ходит в OpenRouteService.
import { avoidPolygons, barriersOnRoute, pointsAlongRoute } from './lib/route-analysis.js';

async function call(body) {
  let res;
  try {
    res = await fetch('/api/route', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  } catch {
    return { error: 'network', message: 'Нет связи с сервером маршрутов.' };
  }
  const data = await res.json().catch(() => null);
  if (!data) return { error: 'server', message: 'Сервер маршрутов не настроен. Маршруты заработают после выкладки на Vercel с ключом ORS.' };
  return data; // при ошибке сервер возвращает { error, message }
}

// Строит два маршрута: кратчайший пеший и доступный для профиля.
export async function buildRoutes(from, to, profile, points) {
  const A = [from.lng, from.lat], B = [to.lng, to.lat];
  const avoid = avoidPolygons(points, profile, Date.now(), from, to);
  const [foot, wheelFirst] = await Promise.all([
    call({ from: A, to: B, mode: 'foot' }),
    call({ from: A, to: B, mode: 'wheel', profile: profile.id, avoid }),
  ]);
  let wheel = wheelFirst, fallback = false;
  // В OpenStreetMap бывает мало данных о тротуарах: тогда строим пеший путь в обход наших барьеров.
  if (wheel.error === 'no_route' || wheel.error === 'ors') {
    const alt = await call({ from: A, to: B, mode: 'foot', avoid });
    if (!alt.error) { wheel = alt; fallback = true; }
  }
  const footBarriers = foot.line ? barriersOnRoute(foot.line, points, profile) : [];
  const wheelBarriers = wheel.line ? barriersOnRoute(wheel.line, points, profile) : [];
  const along = wheel.line ? pointsAlongRoute(wheel.line, points) : [];
  return { foot, wheel, fallback, footBarriers, wheelBarriers, along };
}
