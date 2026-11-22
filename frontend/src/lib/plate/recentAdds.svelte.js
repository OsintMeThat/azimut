/**
 * The tiles of Add picked lately, the newest first, which Add offers back in a first
 * row. Kept in this browser between visits, as the editor's layout is: a convenience,
 * so a stored list that is wrong, or names a tile Add no longer has, is read as less.
 */
import { ADDS } from './adds.js';

const KEY = 'azimut:plateRecentAdds';
/** How many tiles the row keeps. */
export const RECENT_ADDS = 6;
const KINDS = new Set(ADDS.flatMap((group) => group.items.map(([kind]) => kind)));

/** A stored list made safe: the tiles Add has, once each, in order, as many as the row keeps. */
export function readRecentAdds(raw) {
  let value = null;
  try { value = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch { value = null; }
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((kind) => typeof kind === 'string' && KINDS.has(kind)))].slice(0, RECENT_ADDS);
}

function stored() {
  try { return readRecentAdds(localStorage.getItem(KEY)); } catch { return []; }
}

export const recentAdds = $state({ list: stored() });

/** A tile picked from Add goes first, the oldest past the row's length dropping out. */
export function keepRecentAdd(kind) {
  if (!KINDS.has(kind)) return;
  recentAdds.list = [kind, ...recentAdds.list.filter((item) => item !== kind)].slice(0, RECENT_ADDS);
  try { localStorage.setItem(KEY, JSON.stringify(recentAdds.list)); } catch { /* a browser that keeps nothing forgets on reload */ }
}
