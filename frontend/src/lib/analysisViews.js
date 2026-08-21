/** Naming, ordering and dating the saved readings a Views menu lists. */

const ORDER_KEY = 'azimut:view-order';

export function copyName(name, existing = []) {
  const used = new Set(existing.map((value) => String(value).trim().toLocaleLowerCase()));
  const base = `${String(name).trim()} copy`;
  if (!used.has(base.toLocaleLowerCase())) return base;
  let index = 2;
  while (used.has(`${base} ${index}`.toLocaleLowerCase())) index += 1;
  return `${base} ${index}`;
}

/**
 * The orderings a menu offers. `recent` leads because it is the order the case
 * itself wrote, and the reading being worked on is the one just saved.
 *
 * `surface` is offered to the catalog family only: the Timeline's own list holds
 * one surface, so sorting it by surface would move nothing.
 */
export const VIEW_ORDERS = [
  { id: 'recent', label: 'Recently updated', families: ['catalog', 'timeline'] },
  { id: 'name', label: 'Name A→Z', families: ['catalog', 'timeline'] },
  { id: 'surface', label: 'Surface', families: ['catalog'] },
];

export function viewOrders(family) {
  return VIEW_ORDERS.filter((order) => order.families.includes(family));
}

export function normalizeViewOrder(value, family = 'catalog') {
  return viewOrders(family).some((order) => order.id === value) ? value : 'recent';
}

const byName = (a, b) =>
  String(a.name ?? '').localeCompare(String(b.name ?? ''), undefined, { sensitivity: 'base' });

/** Order a list of view summaries. Pure: the caller keeps its own array. */
export function sortViews(views, order = 'recent') {
  const rows = [...(views ?? [])];
  if (order === 'name') return rows.sort(byName);
  if (order === 'surface') {
    return rows.sort(
      (a, b) => String(a.surface ?? '').localeCompare(String(b.surface ?? '')) || byName(a, b)
    );
  }
  // Newest edit first, and a name breaks the tie so two views saved in the same
  // second do not swap places between reads.
  return rows.sort(
    (a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')) || byName(a, b)
  );
}

/** The chosen ordering, per family. A missing or unavailable store is not fatal. */
export function readViewOrder(family) {
  try {
    return normalizeViewOrder(localStorage.getItem(`${ORDER_KEY}:${family}`), family);
  } catch {
    return 'recent'; // localStorage unavailable (private mode) — non-fatal
  }
}

export function writeViewOrder(family, order) {
  try {
    localStorage.setItem(`${ORDER_KEY}:${family}`, normalizeViewOrder(order, family));
  } catch {
    /* localStorage unavailable (private mode) — non-fatal */
  }
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

const pad = (value) => String(value).padStart(2, '0');

/** The exact UTC minute a row was last written, for the row's tooltip. */
export function exactStamp(iso) {
  const at = new Date(String(iso ?? ''));
  if (Number.isNaN(at.getTime())) return String(iso ?? '');
  return (
    `${at.getUTCFullYear()}-${pad(at.getUTCMonth() + 1)}-${pad(at.getUTCDate())}` +
    ` ${pad(at.getUTCHours())}:${pad(at.getUTCMinutes())} UTC`
  );
}

/**
 * How long ago, in the terse register the rest of the app reads in. Past a week the
 * distance stops meaning anything to an analyst, so the date itself is shown.
 */
export function timeAgo(iso, now = Date.now()) {
  const at = new Date(String(iso ?? ''));
  if (Number.isNaN(at.getTime())) return '';
  const seconds = Math.round((now - at.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} d ago`;
  return `${at.getUTCDate()} ${MONTHS[at.getUTCMonth()]} ${at.getUTCFullYear()}`;
}
