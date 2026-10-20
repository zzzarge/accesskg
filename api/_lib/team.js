// Добавление данных от команды: точки с пометкой «проверено командой» и важные места.
// Нужен командный код (TEAM_CODE). Запись идёт ключом service_role, он есть только на сервере.
import { KINDS } from '../../js/lib/barriers.js';
import { inBishkek } from '../../js/lib/geo.js';
import { CATEGORY } from '../../js/lib/ranking.js';
import { timingSafeEqual } from 'node:crypto';

const str = (v, max) => (typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max ? v.trim() : null);
const optNum = (v, lo, hi) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= lo && n <= hi ? n : undefined; // undefined = ошибка
};

function codeOk(given, expected) {
  if (typeof given !== 'string' || !expected) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function cleanPoint(row, supabaseUrl = '') {
  const kind = row?.kind;
  if (!KINDS[kind]) return { error: 'Неизвестный тип точки.' };
  const lat = Number(row.lat), lng = Number(row.lng);
  if (!inBishkek(lat, lng)) return { error: 'Точка должна быть в Бишкеке.' };
  const title = str(row.title, 120);
  if (!title) return { error: 'Нужно название до 120 символов.' };
  const curb_cm = optNum(row.curb_cm, 0, 60), slope_pct = optNum(row.slope_pct, 0, 40), width_cm = optNum(row.width_cm, 20, 400);
  if ([curb_cm, slope_pct, width_cm].includes(undefined)) return { error: 'Проверьте числа: бордюр 0–60 см, уклон 0–40 %, ширина 20–400 см.' };
  const photo_url = row.photo_url ? str(row.photo_url, 499) : null;
  const prefix = supabaseUrl.replace(/\/$/, '') + '/storage/v1/object/public/photos/';
  if (photo_url && !photo_url.startsWith(prefix)) return { error: 'Фото должно быть загружено через приложение.' };
  const author = row.author ? str(row.author, 60) : null;
  let expires_at = null;
  if (row.expires_at) {
    const t = Date.parse(row.expires_at);
    if (!Number.isFinite(t) || t < Date.now() || t > Date.now() + 30 * 86400e3) return { error: 'Срок временного препятствия — до 30 дней.' };
    expires_at = new Date(t).toISOString();
  }
  if (kind === 'temp' && !expires_at) return { error: 'У временного препятствия должен быть срок.' };
  return { row: { kind, title, lat, lng, curb_cm, slope_pct, width_cm, photo_url, author, expires_at, source: 'team' } };
}

export function cleanPlace(row) {
  if (!CATEGORY[row?.category]) return { error: 'Неизвестная категория места.' };
  const lat = Number(row.lat), lng = Number(row.lng);
  if (!inBishkek(lat, lng)) return { error: 'Место должно быть в Бишкеке.' };
  const name = str(row.name, 120);
  if (!name) return { error: 'Нужно название до 120 символов.' };
  const passport = {};
  if (row.passport && typeof row.passport === 'object') {
    for (const [k, v] of Object.entries(row.passport).slice(0, 12)) {
      const kk = str(k, 40), vv = str(String(v), 80);
      if (kk && vv) passport[kk] = vv;
    }
  }
  return { row: { name, category: row.category, lat, lng, passport } };
}

// body: { code, table: 'points'|'places', row }  или  { code, check: true } — только проверить код
export async function handleTeam(body, env, fetchImpl = fetch, failDelay = 1500) {
  if (!env.TEAM_CODE || !env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    return { status: 500, json: { error: 'config', message: 'На сервере не заданы TEAM_CODE / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.' } };
  }
  if (env.TEAM_CODE.length < 16) {
    return { status: 500, json: { error: 'config', message: 'TEAM_CODE слишком короткий: нужно минимум 16 символов.' } };
  }
  if (!codeOk(body?.code, env.TEAM_CODE)) {
    await new Promise(r => setTimeout(r, failDelay)); // замедляем подбор кода
    return { status: 403, json: { error: 'bad_code', message: 'Неверный командный код.' } };
  }
  if (body.check) return { status: 200, json: { ok: true } };

  const table = body.table;
  const cleaned = table === 'points' ? cleanPoint(body.row, env.SUPABASE_URL) : table === 'places' ? cleanPlace(body.row) : { error: 'Неизвестная таблица.' };
  if (cleaned.error) return { status: 400, json: { error: 'bad_row', message: cleaned.error } };

  const res = await fetchImpl(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify(cleaned.row),
  }).catch(() => null);
  if (!res) return { status: 502, json: { error: 'network', message: 'База данных недоступна.' } };
  const data = await res.json().catch(() => null);
  if (!res.ok) return { status: 502, json: { error: 'db', message: data?.message || 'Не удалось сохранить.' } };
  return { status: 200, json: { ok: true, row: Array.isArray(data) ? data[0] : data } };
}
