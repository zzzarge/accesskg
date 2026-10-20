// Связь точек на карте с маршрутом: что обойти и что лежит на пути.
import { whyBlocked, isActive } from './barriers.js';
import { distanceToLine, squareAround, haversine } from './geo.js';

export const MAX_AVOID = 60;     // ORS не любит слишком много зон обхода
export const ON_ROUTE_M = 12;    // точка «на маршруте», если ближе 12 м к линии
export const NEAR_END_M = 15;    // барьер у самой точки A или B не обходим: в зону обхода нельзя прийти
export const CORRIDOR_M = 500;   // зоны обхода берём только в коридоре вокруг отрезка A–B

// Зоны обхода: актуальные точки, непроходимые для профиля (временные тоже),
// в коридоре вокруг A–B, ближайшие к прямой A–B — первыми.
export function avoidPolygons(points, profile, now = Date.now(), from = null, to = null) {
  let list = points.filter(p => isActive(p, now) && whyBlocked(p, profile));
  if (from && to) {
    const ab = [[from.lng, from.lat], [to.lng, to.lat]];
    list = list
      .filter(p => haversine(p.lat, p.lng, from.lat, from.lng) > NEAR_END_M && haversine(p.lat, p.lng, to.lat, to.lng) > NEAR_END_M)
      .map(p => ({ p, d: distanceToLine(p.lat, p.lng, ab) }))
      .filter(x => x.d <= CORRIDOR_M)
      .sort((a, b) => a.d - b.d)
      .map(x => x.p);
  }
  return list.slice(0, MAX_AVOID).map(p => [squareAround(p.lat, p.lng, 6)]);
}

// Барьеры для профиля, через которые проходит линия маршрута.
export function barriersOnRoute(line, points, profile, now = Date.now(), maxDist = ON_ROUTE_M) {
  return points
    .filter(p => isActive(p, now) && whyBlocked(p, profile))
    .map(p => ({ point: p, reason: whyBlocked(p, profile), dist: distanceToLine(p.lat, p.lng, line) }))
    .filter(x => x.dist <= maxDist);
}

// Все актуальные точки вдоль маршрута — «доказательства», что по нему можно проехать.
export function pointsAlongRoute(line, points, now = Date.now(), maxDist = ON_ROUTE_M + 3) {
  return points
    .filter(p => isActive(p, now))
    .map(p => ({ point: p, dist: distanceToLine(p.lat, p.lng, line) }))
    .filter(x => x.dist <= maxDist);
}
