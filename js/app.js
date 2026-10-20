// AccessKG — главный файл интерфейса.
import { CONFIG } from './config.js';
import { store } from './data.js';
import { buildRoutes } from './routing.js';
import { PROFILES, getProfile } from './lib/profiles.js';
import { KINDS, TEMP_TTL, whyBlocked, isActive, isTemporary } from './lib/barriers.js';
import { trustIndex, LEVEL_LABEL, FRESH_DAYS } from './lib/trust.js';
import { rankBarriers, rankingToCsv, CATEGORY } from './lib/ranking.js';
import { inBishkek, haversine } from './lib/geo.js';

/* ---------- утилиты ---------- */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const PHOTO_PREFIX = CONFIG.SUPABASE_URL ? CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/storage/v1/object/public/photos/' : null;
// Показываем фото только из нашего хранилища (в демо-режиме — локальные blob:), чужие ссылки игнорируем.
const safeUrl = u => (typeof u === 'string' && ((PHOTO_PREFIX && u.startsWith(PHOTO_PREFIX)) || u.startsWith('blob:')) ? u : '');
const ls = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* хранилище недоступно */ } },
};
const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const plural = (n, a, b, c) => { const m = Math.abs(n) % 100, m1 = m % 10; return m > 10 && m < 20 ? c : m1 > 1 && m1 < 5 ? b : m1 === 1 ? a : c; };
const daysTxt = d => (d === 0 ? 'сегодня' : d === 1 ? 'вчера' : `${d} ${plural(d, 'день', 'дня', 'дней')} назад`);
const minutes = (m, prof) => Math.max(1, Math.round(m / prof.speed / 60));
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200); }

/* ---------- состояние ---------- */
const state = {
  points: [], places: [],
  profile: getProfile(ls.get('akg-profile', 'manual')),
  from: null, to: null, add: null, pick: null,
  tab: 'route', routes: null, routeSeq: 0,
  fresh: ls.get('akg-fresh', false),
  teamCode: ls.get('akg-team', null),
  voted: ls.get('akg-voted', {}),
};
const active = () => state.points.filter(p => isActive(p));

/* ---------- карта ---------- */
const map = L.map('map', { zoomControl: true }).setView(CONFIG.MAP_CENTER, CONFIG.MAP_ZOOM);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
}).addTo(map);
const layers = {
  places: L.layerGroup().addTo(map), points: L.layerGroup().addTo(map),
  route: L.layerGroup().addTo(map), ab: L.layerGroup().addTo(map),
};
window.addEventListener('resize', () => map.invalidateSize());

function drawPoints() {
  layers.points.clearLayers();
  const warn = cssVar('--warn'), accent = cssVar('--accent'), low = cssVar('--low');
  for (const p of active()) {
    const why = whyBlocked(p, state.profile);
    const good = KINDS[p.kind]?.good && !why;
    const stale = state.fresh && trustIndex(p).days > FRESH_DAYS;
    const m = L.circleMarker([p.lat, p.lng], {
      radius: why ? 9 : 7, color: isTemporary(p) ? warn : '#ffffff', weight: isTemporary(p) ? 3 : 2,
      dashArray: stale ? '3 4' : null, fillColor: why ? warn : good ? accent : low,
      fillOpacity: stale ? 0.5 : 0.95, bubblingMouseEvents: false,
    });
    m.bindTooltip(esc(p.title), { direction: 'top', offset: [0, -8] });
    m.on('click', () => openPoint(p));
    m.addTo(layers.points);
  }
}

function drawPlaces() {
  layers.places.clearLayers();
  for (const pl of state.places) {
    const icon = L.divIcon({ className: '', html: `<span class="place-pin">${esc(pl.name)}</span>`, iconSize: [0, 0] });
    L.marker([pl.lat, pl.lng], { icon, keyboard: true, title: pl.name }).on('click', () => openPlace(pl)).addTo(layers.places);
  }
}

function drawAB() {
  layers.ab.clearLayers();
  const pin = (ll, c) => L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: '', html: `<div class="ab-pin ${c}">${c.toUpperCase()}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] }), interactive: false });
  if (state.from) pin(state.from, 'a').addTo(layers.ab);
  if (state.to) pin(state.to, 'b').addTo(layers.ab);
  if (state.add) L.circleMarker([state.add.lat, state.add.lng], { radius: 10, color: cssVar('--warn'), weight: 3, fillOpacity: 0.15, interactive: false }).addTo(layers.ab);
}

function drawRoutes() {
  layers.route.clearLayers();
  const r = state.routes; if (!r) return;
  const toLL = line => line.map(([lng, lat]) => [lat, lng]);
  const lines = [];
  if (r.foot.line) lines.push(L.polyline(toLL(r.foot.line), { color: cssVar('--warn'), weight: 5, dashArray: '10 9', opacity: 0.9, interactive: false }).addTo(layers.route));
  if (r.wheel.line) lines.push(L.polyline(toLL(r.wheel.line), { color: cssVar('--accent'), weight: 7, opacity: 0.9, interactive: false }).addTo(layers.route));
  if (lines.length) map.fitBounds(L.featureGroup(lines).getBounds(), { padding: [40, 40] });
}

/* ---------- выбор точек на карте ---------- */
const PICK_TEXT = { from: 'Нажмите на карту: откуда', to: 'Нажмите на карту: куда', add: 'Нажмите на карту: где точка' };
function setPick(target) {
  state.pick = state.pick === target ? null : target;
  document.querySelectorAll('[data-pick]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pick === state.pick)));
  $('pickHint').hidden = !state.pick;
  $('pickHint').textContent = PICK_TEXT[state.pick] || '';
}
function setEnd(target, ll, label) {
  if (!inBishkek(ll.lat, ll.lng)) { toast('Пока работаем только в Бишкеке.'); return; }
  const v = { lat: ll.lat, lng: ll.lng, label };
  if (target === 'add') { state.add = v; $('addWhere').textContent = label; }
  else { state[target] = v; $(target === 'from' ? 'fromVal' : 'toVal').textContent = label; }
  drawAB();
  if (target !== 'add') route();
}
map.on('click', e => {
  if (!state.pick) return;
  const t = state.pick; setPick(null);
  setEnd(t, e.latlng, `Точка на карте`);
});
document.querySelectorAll('[data-pick]').forEach(b => b.addEventListener('click', () => setPick(b.dataset.pick)));
document.querySelectorAll('[data-geo]').forEach(b => b.addEventListener('click', () => {
  if (!navigator.geolocation) { toast('Телефон не даёт определить местоположение. Выберите точку на карте.'); return; }
  b.disabled = true;
  navigator.geolocation.getCurrentPosition(
    pos => { b.disabled = false; const ll = { lat: pos.coords.latitude, lng: pos.coords.longitude }; setEnd(b.dataset.geo, ll, 'Моё местоположение'); map.setView([ll.lat, ll.lng], 17); },
    () => { b.disabled = false; toast('Не удалось определить местоположение. Разрешите доступ к геолокации или выберите точку на карте.'); },
    { enableHighAccuracy: true, timeout: 10000 },
  );
}));
$('placeTo').addEventListener('change', e => {
  const pl = state.places.find(p => String(p.id) === e.target.value);
  if (pl) setEnd('to', pl, pl.name);
});

/* ---------- профили ---------- */
function renderProfiles() {
  $('profiles').innerHTML = Object.values(PROFILES).map(p => `<button class="chip" data-p="${p.id}" aria-pressed="${p.id === state.profile.id}">${esc(p.name)}</button>`).join('');
  $('profiles').querySelectorAll('.chip').forEach(b => b.addEventListener('click', () => {
    state.profile = getProfile(b.dataset.p); ls.set('akg-profile', state.profile.id);
    renderProfiles(); drawPoints(); renderCity(); route();
  }));
}
$('fresh').checked = state.fresh;
$('fresh').addEventListener('change', e => { state.fresh = e.target.checked; ls.set('akg-fresh', state.fresh); drawPoints(); renderRouteOut(); });

/* ---------- маршрут ---------- */
async function route() {
  if (!state.from || !state.to) { renderRouteOut(); return; }
  const seq = ++state.routeSeq;
  $('routeOut').innerHTML = `<p class="hint">Строю маршрут…</p>`;
  const r = await buildRoutes(state.from, state.to, state.profile, active());
  if (seq !== state.routeSeq) return; // пришёл ответ на устаревший запрос
  state.routes = r; drawRoutes(); renderRouteOut();
}

function pointRow(p, extra = '') {
  const why = whyBlocked(p, state.profile), color = why ? cssVar('--warn') : KINDS[p.kind]?.good ? cssVar('--accent') : cssVar('--low');
  return `<li data-id="${esc(p.id)}"><span class="sw" style="background:${color}"></span><span>${esc(p.title)}</span><span class="meta">${extra}</span></li>`;
}
function bindRows(root) {
  root.querySelectorAll('li[data-id]').forEach(li => li.addEventListener('click', () => {
    const p = state.points.find(x => String(x.id) === li.dataset.id); if (p) { map.setView([p.lat, p.lng], 18); openPoint(p); }
  }));
}

function renderRouteOut() {
  const out = $('routeOut'), r = state.routes, prof = state.profile;
  if (!state.from || !state.to) { out.innerHTML = `<p class="hint">Выберите точки A и B — построим кратчайший и доступный маршруты.</p>`; return; }
  if (!r) return;
  if (r.foot.error && r.wheel.error) { out.innerHTML = `<p class="err">${esc(r.wheel.message || r.foot.message)}</p>`; return; }

  const fb = r.footBarriers.length;
  let html = `<div class="routes">`;
  html += r.foot.line
    ? `<div class="rc foot"><span class="k">Кратчайший</span><span class="v">${r.foot.distance} м</span><span class="s">≈ ${minutes(r.foot.distance, prof)} мин</span>
       <span class="pill ${fb ? 'bad' : 'ok'}">${fb} ${plural(fb, 'барьер', 'барьера', 'барьеров')}</span></div>`
    : `<div class="rc foot"><span class="k">Кратчайший</span><span class="s">${esc(r.foot.message)}</span></div>`;
  if (r.wheel.line) {
    const wb = r.wheelBarriers.length, diff = r.foot.line ? r.wheel.distance - r.foot.distance : 0;
    html += `<div class="rc wheel"><span class="k">Доступный</span><span class="v">${r.wheel.distance} м</span>
      <span class="s">≈ ${minutes(r.wheel.distance, prof)} мин${diff > 0 ? ` · +${diff} м` : ''}</span>
      <span class="pill ${wb ? 'bad' : 'ok'}">${wb ? `${wb} ${plural(wb, 'барьер', 'барьера', 'барьеров')} не обойти` : '0 барьеров'}</span></div>`;
  } else {
    html += `<div class="rc wheel"><span class="k">Доступный</span><span class="v">нет</span><span class="s">${esc(r.wheel.message || '')}</span></div>`;
  }
  html += `</div>`;

  if (r.wheel.line && r.foot.line) {
    html += `<p class="hint">${r.wheel.distance > r.foot.distance
      ? `Длиннее на ${r.wheel.distance - r.foot.distance} м, зато проходимо для профиля «${esc(prof.name)}».`
      : `Кратчайший путь подходит и для профиля «${esc(prof.name)}».`}</p>`;
  }
  if (r.fallback) html += `<p class="hint">В OpenStreetMap мало данных о тротуарах на этом участке, поэтому путь построен в обход барьеров из базы AccessKG.</p>`;
  if (!r.wheel.line) html += `<p class="hint">Посмотрите вкладку «Для мэрии»: там видно, какой ремонт откроет путь.</p>`;

  if (fb) html += `<h2>Барьеры на кратчайшем пути</h2><ul class="list" id="footList">${r.footBarriers.map(x => pointRow(x.point, esc(x.reason))).join('')}</ul>`;
  if (r.along.length) {
    const stale = r.along.filter(x => trustIndex(x.point).days > FRESH_DAYS);
    html += `<h2>Проверено на доступном пути</h2>`;
    if (state.fresh && stale.length) html += `<p class="err">${stale.length} ${plural(stale.length, 'точка', 'точки', 'точек')} на пути не ${stale.length === 1 ? 'проверялась' : 'проверялись'} больше ${FRESH_DAYS} дней.</p>`;
    html += `<ul class="list" id="alongList">${r.along.map(x => { const t = trustIndex(x.point); return pointRow(x.point, `${t.score} · ${daysTxt(t.days)}`); }).join('')}</ul>`;
  }
  out.innerHTML = html;
  bindRows(out);
}

/* ---------- вкладки и карточки ---------- */
const VIEWS = ['route', 'add', 'city'];
function setTab(t) {
  state.tab = t;
  VIEWS.forEach(v => { $('view-' + v).hidden = v !== t; $('tab-' + v).setAttribute('aria-selected', String(v === t)); });
  $('view-card').hidden = true;
  if (t === 'city') renderCity();
}
VIEWS.forEach(v => $('tab-' + v).addEventListener('click', () => setTab(v)));

function showCard(html) {
  VIEWS.forEach(v => ($('view-' + v).hidden = true));
  const c = $('view-card'); c.hidden = false;
  c.innerHTML = `<button class="back" type="button">← Назад</button>` + html;
  c.querySelector('.back').addEventListener('click', () => setTab(state.tab));
  $('sheet').scrollTop = 0;
  return c;
}

function openPoint(p) {
  const t = trustIndex(p), why = whyBlocked(p, state.profile), voted = state.voted[p.id];
  const color = t.level === 'high' ? cssVar('--good') : t.level === 'medium' ? cssVar('--accent') : cssVar('--warn');
  const facts = [
    KINDS[p.kind]?.label,
    p.curb_cm != null ? `Бордюр ${p.curb_cm} см` : null,
    p.slope_pct != null ? `Уклон ${p.slope_pct}%` : null,
    p.width_cm != null ? `Ширина ${p.width_cm} см` : null,
  ].filter(Boolean);
  let expiry = '';
  if (p.expires_at) {
    const ms = new Date(p.expires_at) - Date.now(), h = Math.floor(ms / 3600e3), m = Math.round((ms % 3600e3) / 60e3);
    expiry = `<p class="hint">Временное: исчезнет через ${h >= 48 ? Math.round(h / 24) + ' дн.' : `${h} ч ${m} мин`}, если никто не подтвердит снова.</p>`;
  }
  const src = p.source === 'team' ? 'Проверено командой на месте' : p.photo_url ? 'Фото пользователя' : 'Отчёт пользователя без фото';
  const photo = safeUrl(p.photo_url);
  const c = showCard(`
    <span class="lbl">Карточка точки${p.is_demo ? ' · демо' : ''}</span>
    <h2>${esc(p.title)}</h2>
    ${photo ? `<img class="card-photo" src="${esc(photo)}" alt="Фото: ${esc(p.title)}" loading="lazy">` : `<div class="nophoto">Фото пока нет</div>`}
    <div class="facts">${facts.map(f => `<span class="fact">${esc(f)}</span>`).join('')}</div>
    ${expiry}
    <div class="field"><div style="display:flex;justify-content:space-between;gap:8px"><span class="lbl">Индекс доверия</span><b style="color:${color}">${t.score} · ${LEVEL_LABEL[t.level]}</b></div>
      <div class="meter"><b style="width:${t.score}%;background:${color}"></b></div>
      <span class="hint">${src} · подтвердили ${p.still_votes || 0} ${plural(p.still_votes || 0, 'человек', 'человека', 'человек')} · проверено ${daysTxt(t.days)}</span></div>
    <div class="verdict ${why ? 'bad' : 'ok'}">Для профиля «${esc(state.profile.name)}»: ${why ? 'не проехать — ' + esc(why) : 'можно проехать'}</div>
    <div class="btns">
      <button class="btn blue" data-v="still" ${voted ? 'disabled' : ''}>Всё ещё так</button>
      <button class="btn warn" data-v="gone" ${voted ? 'disabled' : ''}>Уже не актуально</button>
    </div>
    ${voted ? `<p class="hint">Вы уже отметили эту точку с этого устройства.</p>` : ''}
    <button class="btn ghost" data-to="1">Построить маршрут сюда</button>`);
  c.querySelectorAll('[data-v]').forEach(b => b.addEventListener('click', async () => {
    c.querySelectorAll('[data-v]').forEach(x => (x.disabled = true));
    try {
      await store.vote(p, b.dataset.v);
      state.voted[p.id] = b.dataset.v; ls.set('akg-voted', state.voted);
      toast(b.dataset.v === 'still' ? 'Спасибо, точка подтверждена' : 'Отмечено. Если ещё кто-то подтвердит, точка исчезнет с карты');
      await reload(); const fresh = state.points.find(x => x.id === p.id); if (fresh) openPoint(fresh);
    } catch (e) { toast('Не удалось сохранить: ' + e.message); c.querySelectorAll('[data-v]').forEach(x => (x.disabled = false)); }
  }));
  c.querySelector('[data-to]').addEventListener('click', () => { setTab('route'); setEnd('to', p, p.title); });
}

function openPlace(pl) {
  const rows = Object.entries(pl.passport || {});
  const near = active().filter(p => whyBlocked(p, state.profile) && haversine(p.lat, p.lng, pl.lat, pl.lng) <= 150).length;
  const c = showCard(`
    <span class="lbl">${esc(CATEGORY[pl.category]?.label || 'Место')} · паспорт входа</span>
    <h2>${esc(pl.name)}</h2>
    ${rows.length ? `<table>${rows.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table>` : `<p class="hint">Паспорт входа ещё не заполнен.</p>`}
    <p class="hint">${near ? `${near} ${plural(near, 'барьер', 'барьера', 'барьеров')} для профиля «${esc(state.profile.name)}» в 150 м от входа.` : `Рядом нет известных барьеров для профиля «${esc(state.profile.name)}».`}</p>
    <div class="btns"><button class="btn" data-end="from">Отсюда</button><button class="btn" data-end="to">Сюда</button></div>`);
  c.querySelectorAll('[data-end]').forEach(b => b.addEventListener('click', () => { setTab('route'); setEnd(b.dataset.end, pl, pl.name); }));
}

/* ---------- добавление точки ---------- */
$('kind').innerHTML = Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
$('tempType').innerHTML = Object.entries(TEMP_TTL).map(([k, v]) => `<option value="${k}">${esc(v.label)} · ${v.hours >= 48 ? v.hours / 24 + ' дн.' : v.hours + ' ч'}</option>`).join('');
function syncKind() {
  const k = $('kind').value, fields = KINDS[k].fields;
  document.querySelectorAll('[data-f]').forEach(el => (el.hidden = !fields.includes(el.dataset.f)));
  $('tempWrap').hidden = k !== 'temp';
  $('title').placeholder = k === 'temp' ? TEMP_TTL[$('tempType').value].label : KINDS[k].label;
}
$('kind').addEventListener('change', syncKind); $('tempType').addEventListener('change', syncKind); syncKind();

const formErr = (id, msg) => { $(id).textContent = msg; $(id).hidden = !msg; };
$('addForm').addEventListener('submit', async e => {
  e.preventDefault(); formErr('addErr', '');
  if (!state.add) return formErr('addErr', 'Выберите место: нажмите «На карте» и коснитесь карты, или «Я здесь».');
  const kind = $('kind').value, title = $('title').value.trim() || $('title').placeholder;
  const num = id => { const el = $(id); if (el.closest('[data-f]').hidden || el.value === '') return null; const n = Number(el.value); return Number.isFinite(n) ? n : NaN; };
  const row = { kind, title, lat: state.add.lat, lng: state.add.lng, curb_cm: num('curb_cm'), slope_pct: num('slope_pct'), width_cm: num('width_cm') };
  if ([row.curb_cm, row.slope_pct, row.width_cm].some(Number.isNaN)) return formErr('addErr', 'Проверьте числа.');
  if (row.curb_cm != null && (row.curb_cm < 0 || row.curb_cm > 60)) return formErr('addErr', 'Высота бордюра — от 0 до 60 см.');
  if (row.slope_pct != null && (row.slope_pct < 0 || row.slope_pct > 40)) return formErr('addErr', 'Уклон — от 0 до 40 %.');
  if (row.width_cm != null && (row.width_cm < 20 || row.width_cm > 400)) return formErr('addErr', 'Ширина — от 20 до 400 см.');
  if (kind === 'curb_high' && row.curb_cm == null) return formErr('addErr', 'Укажите высоту бордюра — от неё зависит, кто проедет.');
  if (kind === 'slope' && row.slope_pct == null) return formErr('addErr', 'Укажите уклон в процентах.');
  if (kind === 'temp') row.expires_at = new Date(Date.now() + TEMP_TTL[$('tempType').value].hours * 3600e3).toISOString();
  const btn = $('addSubmit'); btn.disabled = true; btn.textContent = 'Сохраняю…';
  try {
    row.photo_url = await store.uploadPhoto($('photo').files[0]);
    await store.addPoint(row, state.teamCode);
    toast(state.teamCode ? 'Точка сохранена как проверенная командой' : 'Точка сохранена. Спасибо!');
    $('addForm').reset(); syncKind(); state.add = null; $('addWhere').textContent = 'Нажмите на карту или «Я здесь»'; drawAB();
    await reload(); route();
  } catch (err) { formErr('addErr', 'Не удалось сохранить: ' + err.message); }
  finally { btn.disabled = false; btn.textContent = 'Сохранить точку'; }
});

/* ---------- команда и важные места ---------- */
$('placeCat').innerHTML = Object.entries(CATEGORY).map(([k, v]) => `<option value="${k}">${esc(v.label)}</option>`).join('');
function renderTeam() {
  const on = !!state.teamCode;
  $('teamBadge').hidden = !on; $('placeForm').hidden = !on;
  $('teamCode').hidden = on; $('teamBtn').textContent = on ? 'Выйти из режима команды' : 'Войти';
}
$('teamBtn').addEventListener('click', async () => {
  formErr('teamErr', '');
  if (state.teamCode) { state.teamCode = null; ls.set('akg-team', null); renderTeam(); return; }
  const code = $('teamCode').value.trim(); if (!code) return formErr('teamErr', 'Введите командный код.');
  try { if (await store.checkTeamCode(code)) { state.teamCode = code; ls.set('akg-team', code); $('teamCode').value = ''; renderTeam(); toast('Режим команды включён'); } else formErr('teamErr', 'Код слишком короткий.'); }
  catch (e) { formErr('teamErr', e.message); }
});
$('placeForm').addEventListener('submit', async e => {
  e.preventDefault(); formErr('placeErr', '');
  if (!state.add) return formErr('placeErr', 'Сначала выберите место на карте в форме выше.');
  const name = $('placeName').value.trim(); if (!name) return formErr('placeErr', 'Введите название.');
  const passport = {};
  $('placePass').value.split('\n').forEach(line => { const i = line.indexOf(':'); if (i > 0) passport[line.slice(0, i).trim()] = line.slice(i + 1).trim(); });
  try {
    await store.addPlace({ name, category: $('placeCat').value, lat: state.add.lat, lng: state.add.lng, passport }, state.teamCode);
    toast('Место сохранено'); $('placeForm').reset(); await reload();
  } catch (err) { formErr('placeErr', 'Не удалось сохранить: ' + err.message); }
});

/* ---------- для мэрии ---------- */
let lastRank = [];
function renderCity() {
  lastRank = rankBarriers(state.points, state.places, state.profile);
  $('cityNote').textContent = !state.places.length
    ? 'Добавьте важные места (школы, поликлиники, аптеки, остановки) в режиме команды — по ним считается рейтинг.'
    : `Барьеры для профиля «${state.profile.name}», ранжированные по тому, сколько важных мест в 300 м от них. Чем ближе и важнее место, тем выше оценка.`;
  $('rank').innerHTML = lastRank.length
    ? lastRank.map(r => `<li data-id="${esc(r.point.id)}"><div><b>${esc(r.point.title)}</b><span>${esc(r.reason)} · оценка ${r.score} · рядом: ${r.nearby.slice(0, 3).map(n => `${esc(n.place.name)} (${n.dist} м)`).join(', ')}${r.nearby.length > 3 ? ` и ещё ${r.nearby.length - 3}` : ''}</span></div></li>`).join('')
    : `<li><div><b>Пока нечего ранжировать</b><span>Рядом с важными местами нет известных барьеров для этого профиля.</span></div></li>`;
  bindRows($('rank'));
  $('csvBtn').disabled = !lastRank.length;
}
$('csvBtn').addEventListener('click', () => {
  const blob = new Blob(['﻿' + rankingToCsv(lastRank)], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `accesskg-priorities-${state.profile.id}.csv` });
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ---------- данные ---------- */
function fillPlaceSelect() {
  const sel = $('placeTo'), cur = sel.value;
  sel.innerHTML = `<option value="">Важное место как пункт B…</option>` + state.places.map(p => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join('');
  sel.value = cur;
}
async function reload() {
  try {
    const { points, places } = await store.load();
    state.points = points; state.places = places;
    drawPoints(); drawPlaces(); fillPlaceSelect();
    if (state.tab === 'city') renderCity();
  } catch (e) { toast('Не удалось загрузить данные: ' + e.message); }
}
let reloadTimer;
const reloadSoon = () => { clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 800); };

/* ---------- запуск ---------- */
$('demoBadge').hidden = store.mode !== 'demo';
renderProfiles(); renderTeam(); renderRouteOut();
await reload();
store.subscribe(reloadSoon).catch(() => {});
setInterval(() => { drawPoints(); }, 60e3); // временные препятствия исчезают сами
if (store.mode === 'demo') toast('Демо-режим: данные встроенные и видны только вам. Подключите Supabase в js/config.js.');
if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('/sw.js').catch(() => {});
