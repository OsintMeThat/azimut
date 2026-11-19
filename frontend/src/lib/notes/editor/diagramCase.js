/**
 * A diagram from the case: a **network** from the Graph, a **timeline** from the Timeline.
 * Both read what the case already says through the routes those tools read
 * (`GET /graph`, `GET /analysis-views`, `GET /timeline`), and both make a model
 * (`editor/diagramText.js`) only of what was read: nothing is invented, and the panel that
 * offers them lists what they will take before anything is written (`editor/diagramForm.js`).
 *
 * - **The network**: the entities picked, each a box coloured by its type, and the links the
 *   Graph draws between them, each in its own words. The links that pass through an entity
 *   left out can come too, dashed, saying what they pass through (*via 2 media*). A saved
 *   Graph view picks what that view draws.
 * - **The timeline**: the case's dated events (the Timeline's statements) in a period, each
 *   on its day as the case states it, *about* where the date is approximate.
 */
import { api } from '../../api.js';
import { newModel } from './diagramText.js';

/** The most a network panel lists, and a timeline reads, at once. */
export const GRAPH_LIMIT = 200;
export const EVENT_LIMIT = 200;

/** What an entity is drawn as: someone, a place, or a box. */
const PERSON_TYPES = new Set(['account', 'person', 'organisation', 'organization', 'unit', 'group', 'actor']);
const PLACE_TYPES = new Set(['place', 'site', 'area']);

export function shapeOfType(type) {
  if (PERSON_TYPES.has(type)) return 'person';
  if (PLACE_TYPES.has(type)) return 'round';
  return 'box';
}

/** An entity's id as a box's: Mermaid reads letters, digits and `_`. */
export function boxIdOf(entityId) {
  const id = String(entityId ?? '').replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z]/.test(id) ? id : `e_${id}`;
}

/** The query a saved Graph view asks the case: its reading and its filters (`Graph.svelte`'s own `request`). */
export function viewQuery(view) {
  const spec = view?.spec ?? {};
  const graph = spec.graph ?? {};
  const params = { lens: graph.lens || 'all', limit: String(GRAPH_LIMIT) };
  if (view?.mode === 'snapshot') return { ...params, view: view.id };
  if (graph.order) params.order = graph.order;
  for (const [key, value] of Object.entries(spec.query?.terms ?? {})) if (value !== '' && value != null) params[key] = String(value);
  for (const [key, list] of [['keep', graph.kept], ['expand', graph.expanded], ['omit', graph.omitted]]) {
    if (Array.isArray(list) && list.length) params[key] = list.join(',');
  }
  return params;
}

/**
 * What the Graph draws of the case: `{ nodes, links, total, truncated }`, the whole case as
 * the Graph opens on it, or what a saved view draws (`view`, read whole from
 * `GET /analysis-views/{id}`), the families it hides left out.
 */
export async function graphReading({ caseId, view = null, ask = api.get }) {
  const params = view ? viewQuery(view) : { lens: 'all', limit: String(GRAPH_LIMIT) };
  const body = await ask(`/api/cases/${encodeURIComponent(caseId)}/graph?${new URLSearchParams(params)}`);
  const hidden = new Set(view?.spec?.graph?.families ?? []);
  const nodes = (body.nodes ?? []).filter((node) => !hidden.has(node.family));
  const ids = new Set(nodes.map((node) => node.id));
  return {
    nodes,
    links: (body.links ?? []).filter((link) => ids.has(link.from) && ids.has(link.to)),
    total: body.total ?? nodes.length,
    truncated: Boolean(body.truncated),
  };
}

/** The case's saved Graph views, by name: `[{ id, name, mode }]`. */
export async function graphViews({ caseId, ask = api.get }) {
  const body = await ask(`/api/cases/${encodeURIComponent(caseId)}/analysis-views`);
  return (body.views ?? []).filter((view) => view.surface === 'graph').sort((a, b) => a.name.localeCompare(b.name));
}

/** One saved view, whole. */
export function graphView({ caseId, id, ask = api.get }) {
  return ask(`/api/cases/${encodeURIComponent(caseId)}/analysis-views/${encodeURIComponent(id)}`);
}

/** The most entities left out a link passes through: two, so a link says a short way, never the whole case. */
export const THROUGH_STEPS = 2;

/**
 * Each pair of `picked` entities the reading joins only through entities left out, by its
 * shortest way of at most `THROUGH_STEPS` of them: `{ from, to, steps }`, `steps` the entities
 * met at each step along every shortest way (a Map of id to type), from `from`. A pair joined
 * directly (`direct`, keyed `from>to`) is left to its own link.
 */
export function throughPairs(reading, picked, direct = new Map()) {
  const wanted = new Set(picked);
  const typeOf = new Map(reading.nodes.map((node) => [node.id, node.type]));
  const around = new Map();
  for (const link of reading.links) {
    if (link.from === link.to) continue;
    for (const [one, other] of [[link.from, link.to], [link.to, link.from]]) {
      if (!around.has(one)) around.set(one, new Set());
      around.get(one).add(other);
    }
  }
  // how far each entity is from `start`, walking only through what was left out
  const reach = new Map();
  const distances = (start) => {
    if (reach.has(start)) return reach.get(start);
    const far = new Map([[start, 0]]);
    let frontier = [start];
    for (let depth = 1; depth <= THROUGH_STEPS + 1 && frontier.length; depth += 1) {
      const next = [];
      for (const node of frontier) {
        for (const other of around.get(node) ?? []) {
          if (far.has(other)) continue;
          far.set(other, depth);
          if (!wanted.has(other)) next.push(other);
        }
      }
      frontier = next;
    }
    reach.set(start, far);
    return far;
  };
  const pairs = [];
  picked.forEach((from, at) => {
    const fromFar = distances(from);
    for (const to of picked.slice(at + 1)) {
      const length = fromFar.get(to);
      if (!length || length < 2 || direct.has(`${from}>${to}`) || direct.has(`${to}>${from}`)) continue;
      const toFar = distances(to);
      const steps = Array.from({ length: length - 1 }, () => new Map());
      for (const [node, step] of fromFar) {
        if (wanted.has(node) || step < 1 || step >= length || toFar.get(node) !== length - step) continue;
        steps[step - 1].set(node, typeOf.get(node));
      }
      if (steps.every((step) => step.size)) pairs.push({ from, to, steps });
    }
  });
  return pairs;
}

/** "2 media", "1 proof and 3 places": how many of each type a link passes through. */
function throughSaid(middles, typeName) {
  const counts = new Map();
  for (const type of middles.values()) counts.set(type, (counts.get(type) ?? 0) + 1);
  const parts = [...counts].map(([type, count]) => `${count} ${typeName(type, count)}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0];
}

/** A type's name, said for a count: "1 place", "3 places"; a word whose plural is itself stays. */
function plainType(label) {
  return (type, count) => {
    const name = String(label(type) || type).toLowerCase();
    if (count === 1 || /(s|media|data)$/.test(name)) return name;
    return name.endsWith('y') && !/[aeiou]y$/.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`;
  };
}

/**
 * The network `picked` (entity ids, in the reading's order) makes of a reading: each a
 * box coloured by its type, the links the Graph draws between them with their verbs, and,
 * with `through`, a dashed link for each pair joined only through what was left out, saying
 * what it passes through. `label(type)` names a type, `verb(type)` a link's.
 */
export function networkModel(reading, picked, { through = true, label = (type) => type, verb = (type) => type } = {}) {
  const wanted = new Set(picked);
  const nodes = reading.nodes.filter((node) => wanted.has(node.id));
  const boxOf = new Map(nodes.map((node) => [node.id, boxIdOf(node.id)]));
  const boxes = nodes.map((node) => ({
    id: boxOf.get(node.id),
    text: String(node.caption || node.label || node.id),
    shape: shapeOfType(node.type),
    category: label(node.type) || node.type,
  }));
  const direct = new Map();
  for (const link of reading.links) {
    if (!boxOf.has(link.from) || !boxOf.has(link.to) || link.from === link.to) continue;
    const key = `${link.from}>${link.to}`;
    const words = link.folded ? `${verb(link.type)} (${link.folded.sources} source${link.folded.sources === 1 ? '' : 's'})` : verb(link.type);
    const known = direct.get(key) ?? { from: link.from, to: link.to, words: [] };
    if (!known.words.includes(words)) known.words.push(words);
    direct.set(key, known);
  }
  const links = [...direct.values()].map((one) => ({ from: boxOf.get(one.from), to: boxOf.get(one.to), text: one.words.join(', '), arrow: true }));
  if (through) {
    for (const pair of throughPairs(reading, nodes.map((node) => node.id), direct)) {
      links.push({ from: boxOf.get(pair.from), to: boxOf.get(pair.to), text: `via ${pair.steps.map((step) => throughSaid(step, plainType(label))).join(' → ')}`, dashed: true, arrow: false });
    }
  }
  return newModel('network', { boxes, links });
}

// -- the timeline -------------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** One end of a stated date, as words: `18 Oct 2026`, `Oct 2026`, `2026`, a time kept. */
function dayWords(value) {
  const found = /^(\d{4})(?:-(\d{2})(?:-(\d{2})(?:[T ](\d{2}):(\d{2}))?)?)?/.exec(value);
  if (!found) return null;
  const [, year, month, day, hour, minute] = found;
  const parts = [];
  if (day) parts.push(String(Number(day)));
  if (month) parts.push(MONTHS[Number(month) - 1] ?? month);
  parts.push(year);
  const said = parts.join(' ');
  return hour ? `${said}, ${hour}:${minute}` : said;
}

/**
 * The day an event is stated on, in words, as the case states it (`raw`): `18 Oct 2026`,
 * `about 18 Oct 2026` where it is approximate (`~`), `10 Nov 2026 – 14 Nov 2026` for a
 * span, `18 Oct 2026?` where it is uncertain. A date written another way is left as written.
 */
export function eventDay(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const about = text.includes('~');
  const unsure = text.includes('?');
  const ends = text.replace(/[~?]/g, '').split('/').map((one) => one.trim());
  const said = ends.map((one) => (one === '..' || one === '' ? '…' : dayWords(one)));
  if (said.some((one) => one === null)) return text;
  const words = said.length > 1 && said[0] === said[1] ? said[0] : said.join(' – ');
  return `${about ? 'about ' : ''}${words}${unsure ? '?' : ''}`;
}

/**
 * The case's dated events between `from` and `to` (days, either left open), as the Timeline
 * reads them: `{ events: [{ id, day, text, type }], total, extent, more }`, `more` when the case
 * holds more than one read returns.
 */
export async function caseEvents({ caseId, from = '', to = '', ask = api.get }) {
  const params = new URLSearchParams({ category: 'statement', include_undated: 'false', limit: String(EVENT_LIMIT) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  const body = await ask(`/api/cases/${encodeURIComponent(caseId)}/timeline?${params}`);
  const events = (body.items ?? [])
    .filter((item) => item.earliest)
    .map((item) => ({ id: String(item.id), day: eventDay(item.raw) || eventDay(String(item.earliest).slice(0, 10)), text: String(item.label ?? ''), type: item.owner_type ?? '' }));
  return {
    events,
    total: body.total ?? events.length,
    extent: { from: String(body.extent?.from ?? '').slice(0, 10), to: String(body.extent?.to ?? '').slice(0, 10) },
    more: Boolean(body.next_cursor),
  };
}

/** How many events a timeline from the case draws left to right; more read better top down. */
export const ACROSS = 6;

/** The timeline `picked` events make, in the order the case dates them: top down past `ACROSS` of them. */
export function timelineModel(events, picked) {
  const wanted = new Set(picked);
  const chosen = events.filter((one) => wanted.has(one.id));
  return newModel('timeline', {
    direction: chosen.length > ACROSS ? 'TD' : 'LR',
    events: chosen.map((one, at) => ({ id: `n${at + 1}`, when: one.day, text: one.text })),
  });
}
