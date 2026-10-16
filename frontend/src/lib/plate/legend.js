/**
 * What a plate's legend lists, worked out without the page so the rules are read off
 * a test.
 *
 * - **Only what the map draws.** A look is listed when a feature wearing it is drawn
 *   inside the map's frame on the plate's day. What the layer holds elsewhere is left
 *   out unless the legend asks for it (`offmap`), because a legend that names marks
 *   nobody can find on the page reads as wrong.
 * - **A row is a look**, a kind of mark in one colour and one icon, named after what
 *   it shows: the group when the group has one style, else the icon, with the colour's
 *   name in the case's palette ("Side A") when it has one, and the status after it.
 * - **The analyst has the last word**: a row can be renamed, left out (`off`), moved
 *   (`order`), and rows can be written by hand (`extra`).
 * - **A played plate keeps one legend**: given several days (`days`), it lists what
 *   any of them draws, so the legend does not jump from one frame to the next.
 */
import { inFrame } from './geo.js';

const KIND_WORDS = { point: 'marks', line: 'lines', area: 'areas' };
const STATUS_WORDS = { damaged: 'damaged', destroyed: 'destroyed' };

/** A geometry's kind of mark: a point, a line or an area. */
export function kindOf(geometry) {
  const type = String(geometry?.type ?? '');
  if (type.includes('Point')) return 'point';
  if (type.includes('Line')) return 'line';
  return 'area';
}

/**
 * The rows a map's legend shows, `{ key, label, kind, colour, symbol, status, off }`,
 * `off` set on the rows the analyst left out (the inspector lists them, the page does not).
 *
 * `context`:
 * - `rows`: the case's layers; `collection(name)`: a layer's features, or null while unread;
 * - `view`, `frame`: where the map looks, as it reports it (no frame: everything counts); `place`, how a
 *   map in 3D places a point of the ground on its frame through its own camera;
 * - `days`: the moments the legend speaks for (`[null]` for now);
 * - `standing(row, feature, at)`: the feature as it stands then, or null when absent;
 * - `past(row, collection, at)`: the trail, new and gained or lost features the map draws;
 * - `colourName(hex)`, `symbolName(id)`, `categoryColour(group, index)`, `newColour`, `ink`.
 */
export function legendRows(map, context) {
  const { rows = [], collection, view = null, frame = null, place = null, days = [null], standing, past, colourName = () => '',
    symbolName = (id) => id, categoryColour = (group) => group?.colour ?? '#888888', newColour = '#ffd400', ink = '#15181e' } = context;
  const drawn = (geometry) => map.offmap || !view || !frame || inFrame(geometry, view, frame, 6, place);
  const looks = new Map();
  const changes = new Set();
  for (const entry of map.layers ?? []) {
    const row = rows.find((item) => item.name === entry.name);
    if (!row) continue;
    const features = collection?.(row.name);
    if (!features) {
      // not read yet: the groups stand in for the looks
      row.categories?.forEach((group, index) => {
        if (entry.hidden?.includes(group.name)) return;
        const kinds = group.kinds ?? [];
        const kind = kinds.includes('point') ? 'point' : kinds.includes('line') ? 'line' : 'area';
        const key = `${row.name}/${group.name}`;
        if (!looks.has(key)) looks.set(key, { key, label: group.name, kind, colour: entry.colour || group.colour || categoryColour(group, index), symbol: group.symbol || 'pin', status: '' });
      });
      continue;
    }
    // read once a layer, not once a feature: the groups and the hidden ones are the page's live state
    const hidden = new Set(entry.hidden ?? []);
    const groups = [...(row.categories ?? [])];
    const groupIndex = new Map();
    groups.forEach((group, index) => { if (!groupIndex.has(group.name)) groupIndex.set(group.name, index); });
    for (const at of days) {
      for (const feature of features.features ?? []) {
        const state = standing ? standing(row, feature, at) : feature;
        const properties = state?.properties;
        if (!properties || hidden.has(properties.category)) continue;
        const kind = kindOf(state.geometry);
        const groupAt = groupIndex.get(properties.category) ?? -1;
        const group = groups[groupAt];
        const colour = String(entry.colour || properties.colour || categoryColour(group, Math.max(0, groupAt))).toLowerCase();
        const symbol = kind === 'point' ? properties.symbol || group?.symbol || 'pin' : '';
        const status = kind === 'point' ? properties.status ?? '' : '';
        const key = [row.name, properties.category, kind, colour, symbol, status].join('/');
        // a look already listed needs no other feature placed in the frame
        if (looks.has(key) || !drawn(state.geometry)) continue;
        const named = colourName(colour);
        const uniform = group?.mode === 'uniform';
        let label = uniform ? group.name : kind === 'point' ? symbolName(symbol) : named || properties.category || row.title;
        if (!uniform && named && label !== named) label = `${label}, ${named}`;
        if (STATUS_WORDS[status]) label = `${label}, ${STATUS_WORDS[status]}`;
        looks.set(key, { key, label, kind, colour, symbol, status, group: properties.category || row.title });
      }
      if (past) for (const feature of past(row, features, at)) {
        const said = feature.properties ?? {};
        const brings = [said.$new && '$new', said.$trail && '$trail', said.$change].filter((mark) => mark && !changes.has(mark));
        if (!brings.length || !drawn(feature.geometry)) continue;
        for (const mark of brings) changes.add(mark);
      }
    }
  }
  // two looks named alike say what kind of mark, then which group, they are
  const found = [...looks.values()];
  for (const pass of [(look) => `${look.label}, ${KIND_WORDS[look.kind]}`, (look) => `${look.label} (${look.group})`]) {
    const said = new Map();
    for (const look of found) said.set(look.label, (said.get(look.label) ?? 0) + 1);
    for (const look of found) if (said.get(look.label) > 1) look.label = pass(look);
  }
  const entries = found.map(({ group, ...look }) => look);
  if (changes.has('$new')) entries.push({ key: '$new', label: context.newLabel ?? 'New on this day', kind: 'new', colour: newColour });
  if (changes.has('$trail')) entries.push({ key: '$trail', label: context.trailLabel ?? 'The state before', kind: 'trail', colour: ink });
  for (const change of ['gained', 'lost']) {
    if (changes.has(change)) entries.push({ key: change, label: context[`${change}Label`] ?? (change === 'gained' ? 'Gained' : 'Lost'), kind: change, colour: ink });
  }
  for (const [index, extra] of (map.extra ?? []).entries()) {
    entries.push({ key: `extra/${index}`, label: extra.label, kind: extra.kind ?? 'point', colour: extra.colour, symbol: extra.symbol || 'pin', status: '', extra: true });
  }
  return arrange(entries, map);
}

/** The rows in the analyst's order, the ones they left out marked, their own names on them. */
export function arrange(entries, legend) {
  const order = legend.order ?? [];
  const rank = (entry) => {
    const at = order.indexOf(entry.key);
    return at < 0 ? order.length + entries.indexOf(entry) : at;
  };
  const off = new Set(legend.off ?? []);
  return [...entries].sort((a, b) => rank(a) - rank(b))
    .map((entry) => ({ ...entry, label: legend.names?.[entry.key] || entry.label, said: entry.label, off: off.has(entry.key) }));
}

/** The keys in their new order once `key` moves one step `by` among the rows shown. */
export function moveRow(entries, key, by) {
  const keys = entries.map((entry) => entry.key);
  const from = keys.indexOf(key);
  const to = Math.max(0, Math.min(keys.length - 1, from + by));
  if (from < 0 || from === to) return keys;
  keys.splice(from, 1);
  keys.splice(to, 0, key);
  return keys;
}
