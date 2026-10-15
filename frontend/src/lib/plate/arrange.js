/**
 * Laying a plate's elements out by more than the hand: lining several up, spacing
 * them evenly, carrying them to another plate, labelling features without the labels
 * landing on each other, fitting a box to its words, and the lists a page writes
 * from its case (its numbered labels, its chronology, its sources).
 *
 * Pure, so each rule is read off a test.
 */
import { MAP_KINDS, MM_PER_PT, ON_THE_GROUND, dayBefore, mapsFirst, newId, shownOn } from './page.js';

const round = (value) => Math.round(value * 10) / 10;

/** The box round several boxes. */
export function bounds(boxes) {
  const x0 = Math.min(...boxes.map((box) => box[0]));
  const y0 = Math.min(...boxes.map((box) => box[1]));
  const x1 = Math.max(...boxes.map((box) => box[0] + box[2]));
  const y1 = Math.max(...boxes.map((box) => box[1] + box[3]));
  return [x0, y0, x1 - x0, y1 - y0];
}

/**
 * Several elements lined up on one edge or middle of the box round them:
 * `left`, `centre`, `right`, `top`, `middle`, `bottom`. Returns `{ id: box }`.
 */
export function align(elements, edge) {
  const [x, y, w, h] = bounds(elements.map((element) => element.box));
  const out = {};
  for (const element of elements) {
    const [ex, ey, ew, eh] = element.box;
    const next = {
      left: [x, ey], centre: [x + w / 2 - ew / 2, ey], right: [x + w - ew, ey],
      top: [ex, y], middle: [ex, y + h / 2 - eh / 2], bottom: [ex, y + h - eh],
    }[edge];
    out[element.id] = [round(next[0]), round(next[1]), ew, eh];
  }
  return out;
}

/** Three or more elements spaced evenly across (`h`) or down (`v`) the room they take. */
export function distribute(elements, axis) {
  if (elements.length < 3) return {};
  const at = axis === 'h' ? 0 : 1;
  const sorted = [...elements].sort((a, b) => a.box[at] - b.box[at]);
  const start = sorted[0].box[at];
  const end = sorted.at(-1).box[at] + sorted.at(-1).box[at + 2];
  const taken = sorted.reduce((sum, element) => sum + element.box[at + 2], 0);
  const gap = (end - start - taken) / (sorted.length - 1);
  const out = {};
  let cursor = start;
  for (const element of sorted) {
    const box = [...element.box];
    box[at] = round(cursor);
    out[element.id] = box;
    cursor += element.box[at + 2] + gap;
  }
  return out;
}

/** Every element given the width or the height (or both) of the one picked last. */
export function sameSize(elements, which, model) {
  const out = {};
  for (const element of elements) {
    const box = [...element.box];
    if (which !== 'height') box[2] = model.box[2];
    if (which !== 'width') box[3] = model.box[3];
    out[element.id] = box;
  }
  return out;
}

/**
 * Elements copied from one plate made ready for another: fresh ids, a little off
 * where they were, and every map they read pointed at its copy when it came along,
 * else at the target's own map (`target`), else left out.
 */
export function pasted(elements, target, existing = new Set()) {
  const ids = new Map();
  for (const element of elements) {
    let id = newId(element.kind);
    while (existing.has(id)) id = newId(element.kind);
    ids.set(element.id, id);
  }
  const groups = new Map();
  const out = [];
  for (const element of elements) {
    const copy = JSON.parse(JSON.stringify(element));
    copy.id = ids.get(element.id);
    copy.box = [round(copy.box[0] + 4), round(copy.box[1] + 4), copy.box[2], copy.box[3]];
    if (copy.group) {
      if (!groups.has(copy.group)) groups.set(copy.group, newId('g'));
      copy.group = groups.get(copy.group);
    }
    if (copy.of) {
      copy.of = ids.get(copy.of) ?? (existing.has(copy.of) ? copy.of : target);
      if (!copy.of) continue;
    }
    out.push(copy);
  }
  return mapsFirst(out);
}

/**
 * Where the labels of several points go so they do not cover each other: each one
 * tries the eight places round its point, nearest first, and takes the first free
 * of the boxes already placed. `points` are `{ x, y, width, height }` in millimetres.
 */
export function placeLabels(points, taken = [], gap = 1.5) {
  const placed = [...taken];
  const clash = (box) => placed.some((other) => box[0] < other[0] + other[2] && box[0] + box[2] > other[0]
    && box[1] < other[1] + other[3] && box[1] + box[3] > other[1]);
  return points.map(({ x, y, width, height }) => {
    const spots = [[gap, -height - gap], [gap, gap], [-width - gap, -height - gap], [-width - gap, gap],
      [-width / 2, -height - gap * 2], [-width / 2, gap * 2], [gap * 2, -height / 2], [-width - gap * 2, -height / 2]];
    let box = null;
    for (const [dx, dy] of spots) {
      const candidate = [round(x + dx), round(y + dy), width, height];
      if (!clash(candidate)) { box = candidate; break; }
    }
    box ??= [round(x + gap), round(y - height - gap), width, height];
    placed.push(box);
    return box;
  });
}

/**
 * The height a text box needs for its words at its width, read with `measure(line)`
 * in millimetres, so a box the words ran past can be fitted to them.
 */
export function fittedHeight(element, measure) {
  const size = element.size ?? 10;
  const pad = element.fill || element.border ? 3.2 : 0;
  const room = element.box[2] - pad;
  let count = 0;
  for (const paragraph of String(element.text ?? '').split('\n')) {
    let line = '';
    let lines = 1;
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const next = line ? `${line} ${word}` : word;
      if (line && measure(next, element) > room) { lines += 1; line = word; } else line = next;
    }
    count += lines;
  }
  return round(count * size * MM_PER_PT * (element.leading ?? 1.25) + pad + 0.6);
}

/** The labels drawn as numbers on the day `at` (at the step `place` says), in page order, and the number each one shows. */
export function numbered(elements, at, shown = () => true, place = null) {
  const list = elements.filter((element) => element.kind === 'label' && element.style === 'number' && !element.hidden
    && shownOn(element, at, place) && shown(element));
  return list.map((element, index) => ({ id: element.id, number: index + 1, text: element.text, fill: element.fill }));
}

/** A day as a table writes it: `12 Oct 2026`. */
export function shortDay(moment) {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}:\d{2}))?/.exec(String(moment ?? ''));
  if (!match) return '';
  const month = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(match[2]) - 1];
  return `${Number(match[3])} ${month} ${match[1]}${match[4] ? ` ${match[4]}` : ''}`;
}

/**
 * What a table lists, `[lead, text]` rows:
 * - `events`: the features of its layers that carry a day, or a state of their history,
 *   oldest first, and only up to the plate's day when it has one, so a played plate's
 *   chronology grows with it;
 * - `sources`: each address the features cite, once, by its site.
 * `features` are `[{ properties }]` of the layers the table reads.
 */
export function tableRows(element, features, at = null) {
  const limit = element.rows ?? 12;
  if (element.source === 'sources') {
    const seen = new Map();
    for (const feature of features) {
      for (const link of feature.properties?.links ?? []) {
        if (seen.has(link)) continue;
        let host = link;
        try { host = new URL(link).hostname.replace(/^www\./, ''); } catch { /* the address as written */ }
        seen.set(link, [host, link]);
      }
    }
    return [...seen.values()].slice(0, limit);
  }
  const rows = [];
  for (const feature of features) {
    const said = feature.properties ?? {};
    const name = said.name || said.category || 'Unnamed';
    const states = Array.isArray(said.states) && said.states.length ? said.states : null;
    if (states) {
      for (const state of states) {
        if (!state.at) continue;
        rows.push([state.at, `${name}${state.gone ? ', gone' : state.status ? `, ${state.status}` : ''}`]);
      }
    } else if (said.date) rows.push([said.date, name]);
  }
  return rows
    .filter(([day]) => !at || !dayBefore(at, day))
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(-limit)
    .map(([day, text]) => [shortDay(day), text]);
}

/** The elements a list of ids picks, keeping the ones that can be moved together. */
export function movable(spec, ids) {
  return spec.elements.filter((element) => ids.includes(element.id) && !element.locked && !ON_THE_GROUND.includes(element.kind));
}

/** Whether an element is a map the page draws under its writing. */
export const isMap = (element) => MAP_KINDS.includes(element.kind);
