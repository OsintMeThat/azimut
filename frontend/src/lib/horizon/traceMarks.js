/**
 * What the analyst marks on a photo beside its skyline: which strokes are
 * inner ridges, which ridge stands in front of which, and where a collage is
 * cut in pieces. The search reads them (engine/skymatch.py `Marks`).
 *
 * The strokes stay `[{ u, v }]` in the photo's own coordinates
 * (tools/horizon/state/overlay.svelte.js) and the marks ride beside them:
 *
 *   lines  one id per stroke; the pieces of a stroke a rubber cut keep its id
 *   inner  the ids of inner edges: a ridge seen against farther land, not the sky
 *   pairs  `[front, back]` ids: the first stands in front of the second
 *   cuts   where a collage is cut, across the photo (u, 0 to 1)
 *   far    how far some lines stand: `{ line, bands }`, the ids of the
 *          distances ticked (`DISTANCE_BANDS`), several when unsure
 *   sea    the ids of lines along the sea's horizon: sky above, open sea below
 *   clear  the ids of skyline lines the analyst is sure have only sky above them
 *   key    the ids of skyline lines that matter most, a peak or a notch known
 *          anywhere: a place that misses them pays (`KEYS_MAX` at most)
 *   bent   the parts of the picture brushed as bent, a wide lens's edge or a
 *          piece stretched: `{ path, r }`, the brush's path on the photo and
 *          its radius as a share of the photo's width (`BENT_MAX` at most).
 *          The lines there count less, whatever line runs through
 *   hazy   the parts brushed where far land may be hidden, by haze or the
 *          night, kept as `bent` is. A skyline line there is read as a ridge
 *          is: an edge in front of land the photo does not show
 *
 * A stroke drawn along the skyline that lies under another one is an inner
 * edge whatever pen drew it: nothing under a line can be the sky's edge.
 */

export const NO_MARKS = Object.freeze({
  lines: [],
  inner: [],
  pairs: [],
  cuts: [],
  far: [],
  sea: [],
  clear: [],
  key: [],
  bent: [],
  hazy: [],
});

/** The brushes' kinds: a part that may be bent, and one where far land may be hidden. */
export const BRUSHES = Object.freeze(["bent", "hazy"]);

/** How many brushings of each kind a photo keeps, and how many points each path keeps. */
export const BENT_MAX = 24;
const BENT_POINTS_MAX = 2000;

/** How many lines may be key: past that, the newest takes the oldest's place. */
export const KEYS_MAX = 3;

/**
 * How far a line may stand, in the words the tool offers, and the metres each
 * stands for. The search lays a line only on ground within the distances ticked
 * (engine/skymatch.py `Marks.far`), give or take a third for the guess.
 */
export const DISTANCE_BANDS = Object.freeze([
  { id: "near", label: "< 1 km", low: 0, high: 1_000 },
  { id: "b1", label: "1–3 km", low: 1_000, high: 3_000 },
  { id: "b3", label: "3–10 km", low: 3_000, high: 10_000 },
  { id: "b10", label: "10–30 km", low: 10_000, high: 30_000 },
  { id: "b30", label: "> 30 km", low: 30_000, high: 150_000 },
]);

/** The distances ticked, in the menu's order, once each; anything else left out. */
export function cleanBands(bands) {
  const said = new Set(Array.isArray(bands) ? bands : []);
  return DISTANCE_BANDS.filter((band) => said.has(band.id)).map((band) => band.id);
}

/** The metres a line with these distances ticked may stand at, `[low, high]`, or null for none. */
export function farRange(bands) {
  const ticked = DISTANCE_BANDS.filter((band) => cleanBands(bands).includes(band.id));
  if (!ticked.length) return null;
  return [Math.min(...ticked.map((band) => band.low)), Math.max(...ticked.map((band) => band.high))];
}

/** The distances ticked, in a few words: "1–3 km", "1–10 km", "< 3 km", "> 10 km". */
export function farLabel(bands) {
  const range = farRange(bands);
  if (!range) return "";
  const [low, high] = range;
  const km = (metres) => `${Math.round(metres / 1000)}`;
  if (low === 0) return `< ${km(high)} km`;
  if (high >= 150_000) return `> ${km(low)} km`;
  return `${km(low)}–${km(high)} km`;
}

/** The most cuts and pairs a photo keeps. */
export const CUTS_MAX = 12;
export const PAIRS_MAX = 24;

/** A cut this close to the photo's side cuts nothing off. */
const CUT_EDGE = 0.01;

/** The colours pairs take, in order; a letter names each in the same colour. */
export const PAIR_COLOURS = [
  "#ff9f43",
  "#4dd6ff",
  "#c792ea",
  "#7bd88f",
  "#ff6b9a",
  "#ffd166",
];

const sameIds = (a, b) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** The letter a pair is shown with: A, B… Z, then AA. */
export function pairLabel(index) {
  const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return index < 26
    ? letters[index]
    : letters[Math.floor(index / 26) - 1] + letters[index % 26];
}

/**
 * Marks made whole for `count` strokes: an id for each stroke (in order when
 * the marks had none or a wrong number), inner ids and pairs naming strokes
 * there are, cuts inside the photo, sorted, at most `CUTS_MAX`.
 */
export function cleanMarks(marks, count) {
  const given = Array.isArray(marks?.lines) ? marks.lines : [];
  const lines =
    given.length === count &&
    given.every((id) => Number.isInteger(id) && id >= 0)
      ? [...given]
      : Array.from({ length: count }, (_, i) => i);
  const known = new Set(lines);
  const inner = [
    ...new Set((marks?.inner ?? []).filter((id) => known.has(id))),
  ].sort((a, b) => a - b);
  const pairs = [];
  for (const pair of marks?.pairs ?? []) {
    if (!Array.isArray(pair) || pair.length !== 2) continue;
    const [front, back] = pair;
    if (front === back || !known.has(front) || !known.has(back)) continue;
    if (pairs.some(([f, b]) => f === front && b === back)) continue;
    pairs.push([front, back]);
  }
  const cuts = [
    ...new Set(
      (marks?.cuts ?? []).filter(
        (u) => Number.isFinite(u) && u > CUT_EDGE && u < 1 - CUT_EDGE,
      ),
    ),
  ]
    .map((u) => Math.round(u * 10000) / 10000)
    .sort((a, b) => a - b)
    .slice(0, CUTS_MAX);
  const sea = [...new Set((marks?.sea ?? []).filter((id) => known.has(id) && !inner.includes(id)))].sort((a, b) => a - b);
  const clear = [...new Set((marks?.clear ?? []).filter((id) => known.has(id) && !inner.includes(id)))].sort((a, b) => a - b);
  const key = [...new Set((marks?.key ?? []).filter((id) => known.has(id) && !inner.includes(id)))].slice(-KEYS_MAX);
  const far = [];
  for (const one of marks?.far ?? []) {
    const bands = cleanBands(one?.bands);
    if (!known.has(one?.line) || !bands.length || far.some((f) => f.line === one.line)) continue;
    far.push({ line: one.line, bands });
  }
  return {
    lines, inner, pairs: pairs.slice(0, PAIRS_MAX), cuts, far, sea, clear, key,
    bent: cleanBent(marks?.bent), hazy: cleanBent(marks?.hazy),
  };
}

/** Whether two sets of marks say the same thing. */
export function sameMarks(a, b) {
  const x = a ?? NO_MARKS;
  const y = b ?? NO_MARKS;
  return (
    sameIds(x.lines, y.lines) &&
    sameIds(x.inner, y.inner) &&
    sameIds(x.cuts, y.cuts) &&
    x.pairs.length === y.pairs.length &&
    x.pairs.every((p, i) => p[0] === y.pairs[i][0] && p[1] === y.pairs[i][1]) &&
    JSON.stringify(x.far ?? []) === JSON.stringify(y.far ?? []) &&
    sameIds(x.sea ?? [], y.sea ?? []) &&
    sameIds(x.clear ?? [], y.clear ?? []) &&
    sameIds(x.key ?? [], y.key ?? []) &&
    JSON.stringify(x.bent ?? []) === JSON.stringify(y.bent ?? []) &&
    JSON.stringify(x.hazy ?? []) === JSON.stringify(y.hazy ?? [])
  );
}

/** Whether two lists of cuts (`u` across the photo) cut the collage the same. */
export function sameCuts(a, b) {
  return sameIds(a ?? [], b ?? []);
}

/** Marks with nothing in them but each stroke's id are none worth keeping. */
export function marksSaid(marks) {
  return Boolean(
    marks &&
      (marks.inner.length ||
        marks.pairs.length ||
        marks.cuts.length ||
        marks.far?.length ||
        marks.sea?.length ||
        marks.clear?.length ||
        marks.key?.length ||
        marks.bent?.length ||
        marks.hazy?.length),
  );
}

/** An id no stroke has yet. */
export function nextLine(lines) {
  return lines.length ? Math.max(...lines) + 1 : 0;
}

/**
 * Whether most of a stroke lies under other strokes: at that share of its
 * points or more, another stroke passes over the same column of the photo
 * (read between its points), higher by `above` of its height. `across` is
 * how close a column counts as the same, in widths of the photo.
 */
export function liesUnder(
  stroke,
  others,
  { across = 0.004, above = 0.006, share = 0.6 } = {},
) {
  if (!stroke?.length || !others.length) return false;
  let under = 0;
  for (const p of stroke) {
    if (others.some((other) => passesOver(other, p, across, above))) under += 1;
  }
  return under / stroke.length >= share;
}

/** Whether a stroke passes over a point: somewhere along it, in the point's column, higher by `above`. */
function passesOver(stroke, p, across, above) {
  if (stroke.length === 1)
    return Math.abs(stroke[0].u - p.u) <= across && stroke[0].v < p.v - above;
  for (let i = 1; i < stroke.length; i += 1) {
    const a = stroke[i - 1];
    const b = stroke[i];
    const low = Math.min(a.u, b.u) - across;
    const high = Math.max(a.u, b.u) + across;
    if (p.u < low || p.u > high) continue;
    const t =
      b.u === a.u ? 0.5 : Math.min(1, Math.max(0, (p.u - a.u) / (b.u - a.u)));
    if (a.v + (b.v - a.v) * t < p.v - above) return true;
  }
  return false;
}

/**
 * Inner edges read off the trace's shape: each stroke lying under the others
 * (`liesUnder`). For a trace saved before the marks, and for one drawn with
 * a single pen.
 */
export function innerByShape(strokes, lines) {
  const found = new Set();
  strokes.forEach((stroke, i) => {
    const others = strokes.filter((_, j) => lines[j] !== lines[i]);
    if (liesUnder(stroke, others)) found.add(lines[i]);
  });
  return [...found].sort((a, b) => a - b);
}

function pointToSegment(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length
    ? Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length))
    : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

/**
 * The id of the stroke nearest a point of the photo (`{ u, v }`), within
 * `radius` screen pixels with the photo `scale` (`{ width, height }`) big on
 * screen, or null.
 */
export function lineAt(strokes, lines, point, radius, scale) {
  const at = { x: point.u * scale.width, y: point.v * scale.height };
  let best = null;
  strokes.forEach((stroke, i) => {
    const line = stroke.map((p) => ({
      x: p.u * scale.width,
      y: p.v * scale.height,
    }));
    const segments =
      line.length > 1
        ? line.slice(1).map((b, k) => [line[k], b])
        : [[line[0], line[0]]];
    for (const [a, b] of segments) {
      const d = pointToSegment(at, a, b);
      if (d <= radius && (!best || d < best.distance))
        best = { id: lines[i], distance: d };
    }
  });
  return best?.id ?? null;
}

/** The index of the cut within `radius` screen pixels of `u`, the photo `width` wide on screen, or -1. */
export function cutAt(cuts, u, radius, width) {
  let best = -1;
  let distance = Infinity;
  cuts.forEach((cut, i) => {
    const d = Math.abs(cut - u) * width;
    if (d <= radius && d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

/** Marks with the pair `[front, back]` added, or taken away when it stood already; the opposite order gives way. */
export function togglePair(marks, front, back) {
  if (front === back) return marks;
  const had = marks.pairs.some(([f, b]) => f === front && b === back);
  const rest = marks.pairs.filter(
    ([f, b]) => !(f === front && b === back) && !(f === back && b === front),
  );
  return {
    ...marks,
    pairs: had ? rest : [...rest, [front, back]].slice(-PAIRS_MAX),
  };
}

/** Marks with a stroke's id said to be an inner edge (`true`) or the skyline; an inner edge is no sea line, has land above and is no key line. */
export function setInner(marks, id, inner) {
  const rest = marks.inner.filter((one) => one !== id);
  return {
    ...marks,
    inner: inner ? [...rest, id].sort((a, b) => a - b) : rest,
    sea: inner ? (marks.sea ?? []).filter((one) => one !== id) : (marks.sea ?? []),
    clear: inner ? (marks.clear ?? []).filter((one) => one !== id) : (marks.clear ?? []),
    key: inner ? (marks.key ?? []).filter((one) => one !== id) : (marks.key ?? []),
  };
}

/** Marks with a skyline line said to be key, or no longer when it was; past `KEYS_MAX` the oldest goes. An inner edge stays as it is. */
export function toggleKey(marks, id) {
  if (marks.inner.includes(id)) return marks;
  const had = (marks.key ?? []).includes(id);
  const rest = (marks.key ?? []).filter((one) => one !== id);
  return { ...marks, key: had ? rest : [...rest, id].slice(-KEYS_MAX) };
}

/** Marks with a skyline line said to have only sky above it, or not when it was said already; an inner edge stays as it is. */
export function toggleClear(marks, id) {
  if (marks.inner.includes(id)) return marks;
  const had = (marks.clear ?? []).includes(id);
  const rest = (marks.clear ?? []).filter((one) => one !== id);
  return { ...marks, clear: had ? rest : [...rest, id].sort((a, b) => a - b) };
}

/** Marks with a stroke's id said to run along the sea's horizon (`true`), or not; a sea line is skyline. */
export function setSea(marks, id, sea) {
  const rest = (marks.sea ?? []).filter((one) => one !== id);
  return {
    ...marks,
    inner: sea ? marks.inner.filter((one) => one !== id) : marks.inner,
    sea: sea ? [...rest, id].sort((a, b) => a - b) : rest,
  };
}

/** The distances ticked for a line, `[]` when none is said. */
export function farOf(marks, id) {
  return (marks?.far ?? []).find((one) => one.line === id)?.bands ?? [];
}

/**
 * Marks with a line's distances said: `bands` ticked, or none to say nothing.
 * The same distances said again take them away.
 */
export function setFar(marks, id, bands) {
  const ticked = cleanBands(bands);
  const had = farOf(marks, id);
  const rest = (marks.far ?? []).filter((one) => one.line !== id);
  const same = had.length === ticked.length && had.every((b, i) => b === ticked[i]);
  return {
    ...marks,
    far: !ticked.length || same ? rest : [...rest, { line: id, bands: ticked }],
  };
}

/** Each line's distance as drawn: its words at the middle of its longest stroke (`{ u, v }`). */
export function farBadges(strokes, marks) {
  return (marks?.far ?? [])
    .map((one) => ({
      line: one.line,
      label: farLabel(one.bands),
      at: middleOf(strokes, marks.lines, one.line),
    }))
    .filter((badge) => badge.at && badge.label);
}

/** Where each line said to have only sky above is named: a quarter along its longest stroke (`{ line, at }`), clear of the middle's badges. */
export function clearBadges(strokes, marks) {
  return (marks?.clear ?? [])
    .map((line) => ({ line, at: quarterOf(strokes, marks.lines, line) }))
    .filter((badge) => badge.at);
}

/** The brushings over bent parts worth keeping: a path of points on the photo and a radius, rounded. */
function cleanBent(zones) {
  const kept = [];
  for (const zone of Array.isArray(zones) ? zones : []) {
    const r = Number(zone?.r);
    if (!(r > 0 && r <= 0.5) || !Array.isArray(zone.path)) continue;
    const path = zone.path
      .filter((p) => Number.isFinite(p?.u) && Number.isFinite(p?.v) && p.u >= -1 && p.u <= 2 && p.v >= -1 && p.v <= 2)
      .slice(0, BENT_POINTS_MAX)
      .map((p) => ({ u: Math.round(p.u * 10000) / 10000, v: Math.round(p.v * 10000) / 10000 }));
    if (path.length) kept.push({ path, r: Math.round(r * 10000) / 10000 });
  }
  return kept.slice(-BENT_MAX);
}

/**
 * The brushing a point of the photo (`{ u, v }`) lies in, by index, or -1:
 * within its radius of its path, in the photo's own pixels (`aspect` its
 * width over its height).
 */
export function bentIndex(zones, p, aspect = 1) {
  const list = zones ?? [];
  const y = p.v / aspect;
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const { path, r } = list[i];
    for (let k = 0; k < path.length; k += 1) {
      const a = path[k];
      const b = path[k + 1] ?? a;
      if (nearSegment(p.u, y, a.u, a.v / aspect, b.u, b.v / aspect) <= r) return i;
    }
  }
  return -1;
}

/** Whether a point of the photo lies in one of the brushed parts (`bentIndex`). */
export function inBent(zones, p, aspect = 1) {
  return bentIndex(zones, p, aspect) >= 0;
}

function nearSegment(x, y, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const length = dx * dx + dy * dy;
  const t = length ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / length)) : 0;
  return Math.hypot(x - (ax + t * dx), y - (ay + t * dy));
}

/** Marks with a part brushed added, as bent or, `kind` 'hazy', where far land may be hidden; past `BENT_MAX` the oldest goes. */
export function addBent(marks, zone, kind = "bent") {
  return { ...marks, [kind]: cleanBent([...(marks[kind] ?? []), zone]) };
}

/** Marks with the brushing of that kind at `index` taken away. */
export function removeBent(marks, index, kind = "bent") {
  return { ...marks, [kind]: (marks[kind] ?? []).filter((_, i) => i !== index) };
}

/** Where each key line is named: three quarters along its longest stroke (`{ line, at }`), clear of the other badges. */
export function keyBadges(strokes, marks) {
  return (marks?.key ?? [])
    .map((line) => ({ line, at: alongOf(strokes, marks.lines, line, 0.75) }))
    .filter((badge) => badge.at);
}

/** Marks with a cut added at `u`, or the cut at `index` taken away. */
export function addCut(marks, u) {
  return cleanMarks({ ...marks, cuts: [...marks.cuts, u] }, marks.lines.length);
}
export function removeCut(marks, index) {
  return { ...marks, cuts: marks.cuts.filter((_, i) => i !== index) };
}

/**
 * The marks after the strokes changed: `from` says, for each stroke now, the
 * index of the stroke it came from before (a rubbed stroke's pieces share
 * one). Ids, inner edges and pairs of strokes that went away go with them.
 */
export function marksAfter(marks, from) {
  const lines = from.map((i) => marks.lines[i]);
  return cleanMarks({ ...marks, lines }, lines.length);
}

/** A line's longest stroke, or null. */
function longestOf(strokes, lines, id) {
  let longest = null;
  strokes.forEach((stroke, i) => {
    if (lines[i] === id && (!longest || stroke.length > longest.length))
      longest = stroke;
  });
  return longest;
}

/** Where on the photo a line is named: the middle point of its longest stroke. */
function middleOf(strokes, lines, id) {
  const longest = longestOf(strokes, lines, id);
  return longest ? longest[Math.floor(longest.length / 2)] : null;
}

/** A quarter along a line's longest stroke. */
function quarterOf(strokes, lines, id) {
  return alongOf(strokes, lines, id, 0.25);
}

/** A share of the way along a line's longest stroke. */
function alongOf(strokes, lines, id, share) {
  const longest = longestOf(strokes, lines, id);
  return longest ? longest[Math.floor(longest.length * share)] : null;
}

/**
 * The pairs as drawn: each one's letter and colour at the middle of the
 * stroke in front and of the stroke behind it (`{ u, v }`, on the strokes
 * given, which may be the straightened ones).
 */
export function pairBadges(strokes, marks) {
  return marks.pairs
    .map(([front, back], i) => ({
      label: pairLabel(i),
      colour: PAIR_COLOURS[i % PAIR_COLOURS.length],
      front: middleOf(strokes, marks.lines, front),
      back: middleOf(strokes, marks.lines, back),
    }))
    .filter((badge) => badge.front && badge.back);
}

/** The samples of a trace (`traceSamples`, each saying its stroke) on the skyline's strokes alone. */
export function skySamples(samples, marks) {
  if (!marks?.inner?.length) return samples;
  const inner = new Set(marks.inner);
  return samples.filter((s) => !inner.has(marks.lines[s.stroke] ?? s.stroke));
}

/** Which piece of a collage a point across the photo (`u`, 0 to 1) lies in: how many cuts stand left of it. */
export function pieceOf(cuts, u) {
  let piece = 0;
  for (const cut of cuts) if (u > cut) piece += 1;
  return piece;
}
