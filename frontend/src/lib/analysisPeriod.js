/** A fact-time window shared by Board and Graph after an explicit handoff. */

export const PERIOD_CATEGORIES = ['statement', 'media', 'case_activity'];

export function emptyAnalysisPeriod() {
  return { from: '', to: '', categories: ['statement', 'media'] };
}

export function normalizeAnalysisPeriod(value) {
  const raw = value && typeof value === 'object' ? value : {};
  const from = typeof raw.from === 'string' ? raw.from.slice(0, 40) : '';
  const to = typeof raw.to === 'string' ? raw.to.slice(0, 40) : '';
  const categories = Array.isArray(raw.categories)
    ? [...new Set(raw.categories.filter((entry) => PERIOD_CATEGORIES.includes(entry)))]
    : [];
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!from || !to || !Number.isFinite(start) || !Number.isFinite(end) || start >= end) {
    return emptyAnalysisPeriod();
  }
  return {
    from,
    to,
    categories: categories.length ? categories : ['statement', 'media'],
  };
}

export function hasAnalysisPeriod(value) {
  const period = normalizeAnalysisPeriod(value);
  return Boolean(period.from && period.to);
}

export function analysisPeriodQuery(value) {
  const period = normalizeAnalysisPeriod(value);
  if (!period.from || !period.to) return {};
  return {
    temporalFrom: period.from,
    temporalTo: period.to,
    temporalCategories: period.categories,
  };
}

export function analysisPeriodSpec(value) {
  const period = normalizeAnalysisPeriod(value);
  return {
    from: period.from || null,
    to: period.to || null,
    field: period.from ? 'fact-time' : null,
    categories: period.categories,
  };
}
