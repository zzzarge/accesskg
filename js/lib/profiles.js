// Профили мобильности: что человек может преодолеть сам.
// slope — максимальный уклон, %; curb — максимальная высота бордюра, см;
// width — минимальная ширина прохода, см; broken — проходит ли по разбитому покрытию.
// ors — параметры для OpenRouteService (профиль wheelchair). ORS принимает только
// фиксированные значения: уклон 3/6/10/15 %, бордюр 0.03/0.06/0.1 м.
export const PROFILES = {
  manual: {
    id: 'manual', name: 'Ручная коляска',
    slope: 6, curb: 2, width: 80, broken: false, speed: 0.9,
    ors: { maximum_incline: 6, maximum_sloped_kerb: 0.03, minimum_width: 0.9 },
  },
  electric: {
    id: 'electric', name: 'Электроколяска',
    slope: 8, curb: 4, width: 80, broken: true, speed: 1.2,
    ors: { maximum_incline: 6, maximum_sloped_kerb: 0.03, minimum_width: 0.9 },
  },
  stroller: {
    id: 'stroller', name: 'Детская коляска',
    slope: 10, curb: 8, width: 60, broken: true, speed: 1.1,
    ors: { maximum_incline: 10, maximum_sloped_kerb: 0.06, minimum_width: 0.6 },
  },
  walker: {
    id: 'walker', name: 'Ходунки',
    slope: 8, curb: 5, width: 70, broken: false, speed: 0.7,
    ors: { maximum_incline: 6, maximum_sloped_kerb: 0.03, minimum_width: 0.7 },
  },
};

export const DEFAULT_PROFILE = 'manual';

export function getProfile(id) {
  return PROFILES[id] || PROFILES[DEFAULT_PROFILE];
}
