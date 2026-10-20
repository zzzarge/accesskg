-- AccessKG: схема базы данных для Supabase.
-- Запуск: Supabase → SQL Editor → вставить весь файл → Run.
-- Повторный запуск безопасен.

-- ============ Точки на карте: барьеры и удобства ============
create table if not exists public.points (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in
                ('curb_ramp','ramp','curb_high','steps','slope','broken','narrow','temp')),
  title       text not null check (char_length(title) between 1 and 120),
  lat         double precision not null check (lat between 42.70 and 43.00),
  lng         double precision not null check (lng between 74.40 and 74.80),
  curb_cm     numeric check (curb_cm is null or curb_cm between 0 and 60),
  slope_pct   numeric check (slope_pct is null or slope_pct between 0 and 40),
  width_cm    numeric check (width_cm is null or width_cm between 20 and 400),
  photo_url   text check (photo_url is null or char_length(photo_url) < 500),
  source      text not null default 'user' check (source in ('team','user')),
  author      text check (author is null or char_length(author) <= 60),
  expires_at  timestamptz,
  is_demo     boolean not null default false,
  created_at  timestamptz not null default now()
);
create index if not exists points_created_idx on public.points (created_at desc);

-- Временное препятствие обязано иметь срок, не больше 30 дней.
-- Фото — только из нашего хранилища.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'points_temp_expiry') then
    alter table public.points add constraint points_temp_expiry
      check (kind <> 'temp' or (expires_at is not null and expires_at <= created_at + interval '30 days'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'points_photo_bucket') then
    alter table public.points add constraint points_photo_bucket
      check (photo_url is null or photo_url like '%/storage/v1/object/public/photos/%');
  end if;
end $$;

-- ============ Голоса: «всё ещё так» / «уже не актуально» ============
create table if not exists public.votes (
  id         uuid primary key default gen_random_uuid(),
  point_id   uuid not null references public.points(id) on delete cascade,
  vote       text not null check (vote in ('still','gone')),
  device_id  text not null check (char_length(device_id) between 8 and 64),
  created_at timestamptz not null default now()
);
create index if not exists votes_point_idx on public.votes (point_id);
-- Один голос с одного устройства за точку.
create unique index if not exists votes_point_device_uidx on public.votes (point_id, device_id);

-- ============ Важные места: школы, поликлиники, аптеки, остановки ============
create table if not exists public.places (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 120),
  category   text not null check (category in ('school','clinic','pharmacy','stop','gov','shop','other')),
  lat        double precision not null check (lat between 42.70 and 43.00),
  lng        double precision not null check (lng between 74.40 and 74.80),
  passport   jsonb not null default '{}'::jsonb,   -- паспорт входа: {"Ступени":"3","Пандус":"есть, 9%"}
  is_demo    boolean not null default false,
  created_at timestamptz not null default now()
);

-- ============ Точки вместе со счётчиками голосов ============
create or replace view public.point_stats
with (security_invoker = on) as
select p.*,
       coalesce(count(v.*) filter (where v.vote = 'still'), 0)::int as still_votes,
       coalesce(count(v.*) filter (where v.vote = 'gone'),  0)::int as gone_votes,
       max(v.created_at) filter (where v.vote = 'still')            as last_still_at
from public.points p
left join public.votes v on v.point_id = p.id
group by p.id;

-- ============ Доступ (Row Level Security) ============
-- Читать могут все. Добавлять точки и голоса может любой (как пользователь, source = 'user').
-- Точки от команды (source = 'team') и важные места добавляются только через /api/team
-- с командным кодом: сервер пишет их ключом service_role, который обходит эти правила.
alter table public.points enable row level security;
alter table public.votes  enable row level security;
alter table public.places enable row level security;

drop policy if exists "points read"   on public.points;
drop policy if exists "points insert" on public.points;
drop policy if exists "votes read"    on public.votes;
drop policy if exists "votes insert"  on public.votes;
drop policy if exists "places read"   on public.places;

create policy "points read"   on public.points for select using (true);
create policy "points insert" on public.points for insert to anon, authenticated
  with check (source = 'user' and is_demo = false);
create policy "votes read"    on public.votes  for select using (true);
create policy "votes insert"  on public.votes  for insert to anon, authenticated with check (true);
create policy "places read"   on public.places for select using (true);

grant select on public.point_stats to anon, authenticated;

-- Пользователи могут заполнять только эти поля: id, created_at, source, is_demo ставит база.
revoke insert, update, delete on public.points from anon, authenticated;
grant insert (kind, title, lat, lng, curb_cm, slope_pct, width_cm, photo_url, author, expires_at)
  on public.points to anon, authenticated;
revoke insert, update, delete on public.votes from anon, authenticated;
grant insert (point_id, vote, device_id) on public.votes to anon, authenticated;
revoke insert, update, delete on public.places from anon, authenticated;

-- ============ Хранилище фото ============
-- Только JPEG до 2 МБ (приложение само сжимает фото перед загрузкой).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', true, 2097152, '{image/jpeg}')
on conflict (id) do update
  set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "photos read"   on storage.objects;
drop policy if exists "photos upload" on storage.objects;
create policy "photos read"   on storage.objects for select using (bucket_id = 'photos');
create policy "photos upload" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'photos' and name ~ '^[A-Za-z0-9-]{8,64}/[0-9]+\.jpg$');

-- ============ Обновления в реальном времени ============
-- Новая точка или голос сразу появляются у всех, у кого открыто приложение.
do $$
begin
  begin alter publication supabase_realtime add table public.points; exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.votes;  exception when duplicate_object then null; end;
end $$;
