/**
 * The colours picked lately, wherever: a layer's palette and a plate's colour
 * fields offer them back, so a colour made once is one press away after. Kept in
 * this browser only, as a convenience.
 */
const KEY = 'azimut:recent-colours';
/** Where the plate kept its own before the list was shared. */
const OLD = 'azimut:plate-colours';
const LIMIT = 8;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? localStorage.getItem(OLD) ?? '[]');
    return Array.isArray(list) ? list.map((hex) => String(hex).toLowerCase()).filter((hex) => /^#[0-9a-f]{6}$/.test(hex)).slice(0, LIMIT) : [];
  } catch { return []; }
}

let list = $state(read());

export const recentColours = {
  get list() { return list; },
  /** Put a colour first, the oldest past the limit dropping out. */
  keep(colour) {
    const hex = String(colour ?? '').toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(hex)) return;
    list = [hex, ...list.filter((item) => item !== hex)].slice(0, LIMIT);
    try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* this browser keeps nothing */ }
  },
};
