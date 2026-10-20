// Простая геометрия в метрах для небольших расстояний (внутри города этого достаточно).
const R = 6371000;
const rad = d => (d * Math.PI) / 180;

export function haversine(lat1, lng1, lat2, lng2) {
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Расстояние от точки до ломаной; line — массив [lng, lat] (формат GeoJSON).
export function distanceToLine(lat, lng, line) {
  if (!line || line.length === 0) return Infinity;
  const kx = R * rad(1) * Math.cos(rad(lat)), ky = R * rad(1);
  const px = lng * kx, py = lat * ky;
  let best = Infinity;
  for (let i = 0; i < line.length; i++) {
    const ax = line[i][0] * kx, ay = line[i][1] * ky;
    if (line.length === 1) return Math.hypot(px - ax, py - ay);
    if (i === line.length - 1) break;
    const bx = line[i + 1][0] * kx, by = line[i + 1][1] * ky;
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
    best = Math.min(best, Math.hypot(px - (ax + t * dx), py - (ay + t * dy)));
  }
  return best;
}

// Квадрат вокруг точки со стороной 2*half метров — зона, которую маршрут должен обойти.
export function squareAround(lat, lng, half = 6) {
  const dLat = half / (R * rad(1));
  const dLng = half / (R * rad(1) * Math.cos(rad(lat)));
  const ring = [
    [lng - dLng, lat - dLat], [lng + dLng, lat - dLat],
    [lng + dLng, lat + dLat], [lng - dLng, lat + dLat], [lng - dLng, lat - dLat],
  ];
  return ring.map(([x, y]) => [round6(x), round6(y)]);
}

const round6 = v => Math.round(v * 1e6) / 1e6;

export const BISHKEK = { lat: 42.8746, lng: 74.6037, bbox: { minLat: 42.70, maxLat: 43.00, minLng: 74.40, maxLng: 74.80 } };

export function inBishkek(lat, lng) {
  const b = BISHKEK.bbox;
  return Number.isFinite(lat) && Number.isFinite(lng) && lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}
