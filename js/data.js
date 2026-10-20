// Работа с данными: Supabase, а если он не настроен — встроенный демо-режим.
import { CONFIG } from './config.js';
import { demoPoints, demoPlaces } from './demo-data.js';

const configured = !!(CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY);
let sb = null;

async function client() {
  if (!sb) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    sb = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  }
  return sb;
}

export function deviceId() {
  try {
    let id = localStorage.getItem('akg-device');
    if (!id) { id = crypto.randomUUID(); localStorage.setItem('akg-device', id); }
    return id;
  } catch { return 'anon-' + Math.random().toString(36).slice(2, 12); }
}

// Уменьшаем фото перед загрузкой: меньше трафика на мобильном интернете.
async function shrinkPhoto(file, max = 1280) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(img.width, img.height));
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
}

const memory = { points: null, places: null };

export const store = {
  mode: configured ? 'supabase' : 'demo',

  async load() {
    if (!configured) {
      memory.points ??= demoPoints();
      memory.places ??= demoPlaces();
      return { points: memory.points, places: memory.places };
    }
    const db = await client();
    const [p, pl] = await Promise.all([
      db.from('point_stats').select('*').order('created_at', { ascending: false }).limit(2000),
      db.from('places').select('*').limit(1000),
    ]);
    if (p.error) throw new Error(p.error.message);
    if (pl.error) throw new Error(pl.error.message);
    return { points: p.data, places: pl.data };
  },

  async uploadPhoto(file) {
    if (!file) return null;
    if (!configured) return URL.createObjectURL(file);
    const db = await client();
    const blob = await shrinkPhoto(file);
    const path = `${deviceId()}/${Date.now()}.jpg`;
    const up = await db.storage.from('photos').upload(path, blob, { contentType: 'image/jpeg' });
    if (up.error) throw new Error('Фото не загрузилось: ' + up.error.message);
    return db.storage.from('photos').getPublicUrl(path).data.publicUrl;
  },

  // teamCode задан → точка сохраняется как «проверено командой» через сервер.
  async addPoint(row, teamCode) {
    if (!configured) {
      const p = { id: 'local-' + Date.now(), created_at: new Date().toISOString(), still_votes: 0, gone_votes: 0,
        source: teamCode ? 'team' : 'user', ...row };
      memory.points.unshift(p);
      return p;
    }
    if (teamCode) return teamPost({ code: teamCode, table: 'points', row });
    const db = await client();
    const { error } = await db.from('points').insert(row); // source = 'user' ставит база
    if (error) throw new Error(error.message);
  },

  async addPlace(row, teamCode) {
    if (!configured) { memory.places.push({ id: 'local-' + Date.now(), ...row }); return; }
    return teamPost({ code: teamCode, table: 'places', row });
  },

  async vote(point, vote) {
    if (!configured) {
      if (vote === 'still') { point.still_votes = (point.still_votes || 0) + 1; point.last_still_at = new Date().toISOString(); }
      else point.gone_votes = (point.gone_votes || 0) + 1;
      return;
    }
    const db = await client();
    const { error } = await db.from('votes').insert({ point_id: point.id, vote, device_id: deviceId() });
    if (error) throw new Error(error.code === '23505' ? 'вы уже голосовали за эту точку' : error.message);
  },

  async checkTeamCode(code) {
    if (!configured) return code.length >= 4; // в демо-режиме любой код от 4 символов
    await teamPost({ code, check: true });
    return true;
  },

  // Новые точки и голоса от других людей приходят сразу.
  async subscribe(onChange) {
    if (!configured) return;
    const db = await client();
    db.channel('akg')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'points' }, onChange)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'votes' }, onChange)
      .subscribe();
  },
};

async function teamPost(body) {
  const res = await fetch('/api/team', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || 'Сервер не ответил.');
  return data.row;
}
