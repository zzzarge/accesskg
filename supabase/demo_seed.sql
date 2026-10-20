-- AccessKG: ДЕМО-данные, чтобы приложение не было пустым до сбора настоящих.
-- Все записи помечены is_demo = true и «[демо]» в названии.
-- Координаты условные (центр Бишкека), это НЕ проверенные барьеры.
-- Когда команда соберёт настоящие точки, удалите демо одной командой:
--   delete from public.points where is_demo; delete from public.places where is_demo;

insert into public.places (name, category, lat, lng, passport, is_demo) values
 ('[демо] Остановка',   'stop',     42.87420, 74.60150, '{"Посадка":"Высокий бордюр у края","Навес":"Есть"}', true),
 ('[демо] Поликлиника', 'clinic',   42.87820, 74.60780, '{"Ступени у входа":"3","Пандус":"Есть, уклон 9%, с помощником","Ширина двери":"90 см","Кнопка вызова":"Нет","Доступный туалет":"Нет"}', true),
 ('[демо] Школа',       'school',   42.87900, 74.60200, '{"Ступени у входа":"4","Пандус":"Нет","Кнопка вызова":"Есть"}', true),
 ('[демо] Аптека',      'pharmacy', 42.87600, 74.60600, '{"Вход":"Без ступеней","Ширина двери":"80 см"}', true),
 ('[демо] ЦОН',         'gov',      42.87450, 74.60950, '{"Пандус":"Есть, уклон 5%","Кнопка вызова":"Есть","Доступный туалет":"Есть"}', true);

insert into public.points (kind, title, lat, lng, curb_cm, slope_pct, width_cm, source, is_demo, created_at) values
 ('curb_high', '[демо] Высокий бордюр без съезда', 42.87480, 74.60320, 15,  null, null, 'team', true, now() - interval '4 days'),
 ('curb_high', '[демо] Бордюр 8 см на переходе',   42.87560, 74.60420, 8,   null, null, 'team', true, now() - interval '6 days'),
 ('slope',     '[демо] Крутой подъём',             42.87650, 74.60480, null, 11,  null, 'team', true, now() - interval '2 days'),
 ('broken',    '[демо] Разбитый тротуар',          42.87740, 74.60650, null, null, null, 'user', true, now() - interval '12 days'),
 ('steps',     '[демо] Ступени подземного перехода', 42.87530, 74.60180, null, null, null, 'team', true, now() - interval '3 days'),
 ('curb_ramp', '[демо] Съезд с бордюра',           42.87700, 74.60300, 1,   null, null, 'team', true, now() - interval '5 days'),
 ('ramp',      '[демо] Пандус у входа',            42.87810, 74.60760, null, 5,   null, 'team', true, now() - interval '7 days'),
 ('narrow',    '[демо] Узкий проход между столбами', 42.87690, 74.60860, null, null, 60, 'user', true, now() - interval '40 days');
