/**
 * A routine's runs read as one record of the same ground over time.
 *
 * Each run is a pass: the day it read, the areas it read on that day and what it
 * found there. Read one by one they repeat each other, since a routine with a fixed
 * reference finds the same parked aircraft on every pass. Read together they say
 * what an analyst is after: how many there were each time, which places stay
 * busy, what arrived and what left.
 *
 * A **spot** is one place candidates come back to: candidates of one area within
 * `radius` metres of each other across passes, matched one to one on each pass so
 * two things parked side by side stay two spots. The rule is said wherever spots
 * are shown, and it only groups: no candidate is hidden or judged by it.
 *
 * Pure: the series comes from `GET /followups/{id}/series` (`engine.series`).
 */

/** How near two candidates of two passes must be to count as one spot, in metres. */
export const SPOT_RADIUS = 40;
/** The radii offered, from a parked car to a ship at anchor. */
export const RADII = Object.freeze([20, 40, 80, 150]);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** `27 Sep`, or `27 Sep 2026` with `year`, from an ISO day; '' for anything else. */
export function shortDay(iso, year = false) {
  const found = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso ?? ''));
  if (!found) return '';
  const day = `${Number(found[3])} ${MONTHS[Number(found[2]) - 1] ?? ''}`;
  return year ? `${day} ${found[1]}` : day;
}

/** Whether a list of ISO days spans more than one year, so its labels need the year. */
export const spansYears = (days) => new Set(days.filter(Boolean).map((day) => day.slice(0, 4))).size > 1;

/** Colours told apart on the dark and the light theme, for areas that share one. */
// Amber is left out: it is what waits for review, and the app's own accent.
export const AREA_PALETTE = Object.freeze(['#4e9bd8', '#4fb8b0', '#a98ad8', '#d87fae', '#b9a44c', '#8fa3b8', '#c9925f', '#6fbf73']);

/**
 * A colour per area, for a chart stacked by area: each area's own when they all
 * differ, the palette in their order when two share one (new areas all start
 * sky blue), since a stack of one colour says nothing.
 */
export function areaColours(ids, areas = []) {
  const own = new Map((areas ?? []).map((area) => [area.id, String(area.colour ?? '').toLowerCase()]));
  const picked = ids.map((id) => own.get(id) ?? '');
  const distinct = picked.every((colour) => /^#[0-9a-f]{6}$/.test(colour)) && new Set(picked).size === picked.length;
  return Object.fromEntries(ids.map((id, index) => [id, distinct ? picked[index] : AREA_PALETTE[index % AREA_PALETTE.length]]));
}

/** Metres between two `[lon, lat]` points, flat-earth: spots are a few metres apart. */
export function metres([lon1, lat1], [lon2, lat2]) {
  const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * (Math.PI / 180));
  const dy = (lat2 - lat1) * 110540;
  return Math.hypot(dx, dy);
}

/** Days between two ISO days, or null. */
export function daysBetween(from, to) {
  const one = Date.parse(`${from}T00:00:00Z`);
  const two = Date.parse(`${to}T00:00:00Z`);
  return Number.isFinite(one) && Number.isFinite(two) ? Math.round((two - one) / 86400000) : null;
}

/**
 * The passes of a series, oldest first: one per run, a day read twice by its newest
 * run, since a run made again on the same pass replaces what the first one saw.
 * `read` holds the areas the pass read; an area that failed or had no new pass
 * that day was not looked at, which is not the same as empty.
 */
export function seriesPasses(rows) {
  const byDay = new Map();
  for (const row of rows ?? []) {
    const date = row?.dates?.[1] || row?.areas?.map((area) => area.b).filter(Boolean).sort().at(-1) || '';
    if (!date || !row?.id) continue;
    byDay.set(date, row);
  }
  return [...byDay.entries()].sort(([one], [two]) => one.localeCompare(two)).map(([date, row]) => ({
    id: row.id,
    date,
    title: row.title ?? '',
    reference: row.dates?.[0] ?? '',
    read: new Set((row.areas ?? []).filter((area) => area.status === 'ready').map((area) => area.area_id)),
    areas: row.areas ?? [],
    results: (row.results ?? []).filter((result) => Array.isArray(result?.coordinates)),
  }));
}

/** What a candidate's verdict counts as. A pin is kept in the case; noted is kept here. */
function tally(results) {
  const counts = { total: 0, toReview: 0, noted: 0, pinned: 0 };
  for (const result of results) {
    counts.total++;
    if (result.review === 'kept') counts.pinned++;
    else if (result.review === 'noted') counts.noted++;
    else counts.toReview++;
  }
  return counts;
}

/** The share of passes since a spot was first seen that makes it regular. */
export const REGULAR = 0.8;

/**
 * The categories a spot falls in, in the order they are tested: the first that
 * fits is the spot's. Each says its rule, since that is what the filter means.
 */
export const CATEGORIES = Object.freeze([
  { id: 'new', label: 'New', rule: 'First seen on the newest pass' },
  { id: 'gone', label: 'Gone', rule: 'Seen on the pass before, not on the newest' },
  { id: 'steady', label: 'Regular', rule: 'On 4 passes in 5 or more since it was first seen' },
  { id: 'once', label: 'Seen once', rule: 'On one pass only' },
  { id: 'mixed', label: 'Comes and goes', rule: 'Seen on some passes since it was first seen, not all' },
]);

function categoryOf(presence, readAt) {
  const seen = readAt.filter((at) => presence[at] === 'present');
  if (!seen.length || !readAt.length) return 'mixed';
  const last = readAt.at(-1);
  const before = readAt.at(-2);
  if (readAt.length > 1 && seen.length === 1 && seen[0] === last) return 'new';
  if (before !== undefined && presence[before] === 'present' && presence[last] !== 'present') return 'gone';
  const since = readAt.filter((at) => at >= seen[0]);
  // a mask over one cloud or a car parked across it can hide a spot on one pass
  if (seen.length > 1 && seen.length >= since.length * REGULAR) return 'steady';
  if (seen.length === 1) return 'once';
  return 'mixed';
}

/**
 * The series read together: its passes with their counts, and its spots.
 *
 * `only` narrows everything to one area. Each pass answers `counts` (all areas)
 * and `byArea` (area id → counts), and the spots that `arrived` and `left` since
 * the pass before that read the same area. Each spot answers its members (the
 * candidate and its run on each pass it was seen), `presence` per pass
 * (`present`, `absent`, or `unread` when its area was not read that day), its
 * first and last day, how many passes saw it of how many read its area, its
 * category and the verdicts its candidates hold.
 */
export function buildSeries(rows, { radius = SPOT_RADIUS, only = null } = {}) {
  const passes = seriesPasses(rows);
  const keep = (areaId) => !only || areaId === only;
  const spots = [];
  // Spots sit in a grid of cells one radius wide, per area, so a candidate is only
  // measured against the spots of the nine cells around it: a busy base over a
  // hundred passes stays a fraction of a second rather than a minute.
  const grid = new Map();
  const xScale = new Map(); // area id → metres per degree of longitude there
  const cellOf = (areaId, [lon, lat]) => {
    if (!xScale.has(areaId)) xScale.set(areaId, 111320 * Math.cos((lat * Math.PI) / 180));
    return [Math.floor((lon * xScale.get(areaId)) / radius), Math.floor((lat * 110540) / radius)];
  };
  // a cell as one number: whole cells of a few metres stay far inside a double's exact range
  const KEY = 1_000_003;
  const cellsOf = (areaId) => {
    if (!grid.has(areaId)) grid.set(areaId, new Map());
    return grid.get(areaId);
  };
  const place = (spot) => {
    const [cx, cy] = cellOf(spot.areaId, spot.centre);
    const key = cx * KEY + cy;
    if (spot.cell === key) return;
    const cells = cellsOf(spot.areaId);
    if (spot.cell !== null) cells.get(spot.cell)?.delete(spot);
    if (!cells.has(key)) cells.set(key, new Set());
    cells.get(key).add(spot);
    spot.cell = key;
  };
  const near = (areaId, point) => {
    const [cx, cy] = cellOf(areaId, point);
    const cells = cellsOf(areaId);
    const found = [];
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cell = cells.get((cx + dx) * KEY + cy + dy);
        if (cell) for (const spot of cell) found.push(spot);
      }
    }
    return found;
  };

  passes.forEach((pass, at) => {
    const byArea = new Map();
    for (const result of pass.results) {
      if (!keep(result.area_id)) continue;
      if (!byArea.has(result.area_id)) byArea.set(result.area_id, []);
      byArea.get(result.area_id).push(result);
    }
    for (const [areaId, results] of byArea) {
      // every pairing near enough, nearest first, each candidate and spot taken once
      const pairs = [];
      results.forEach((result, index) => {
        for (const spot of near(areaId, result.coordinates)) {
          const distance = metres(spot.centre, result.coordinates);
          if (distance <= radius) pairs.push({ index, spot, distance });
        }
      });
      pairs.sort((one, two) => one.distance - two.distance);
      const taken = new Set();
      const filled = new Set();
      for (const { index, spot, distance } of pairs) {
        if (taken.has(index) || filled.has(spot)) continue;
        taken.add(index); filled.add(spot);
        spot.members.push({ at, runId: pass.id, date: pass.date, result: results[index], distance });
        const [lon, lat] = results[index].coordinates;
        spot.sum[0] += lon; spot.sum[1] += lat;
      }
      for (const spot of filled) {
        spot.centre = [spot.sum[0] / spot.members.length, spot.sum[1] / spot.members.length];
        place(spot);
      }
      results.forEach((result, index) => {
        if (taken.has(index)) return;
        const spot = { areaId, centre: result.coordinates, sum: [...result.coordinates], cell: null,
          members: [{ at, runId: pass.id, date: pass.date, result, distance: 0 }] };
        place(spot);
        spots.push(spot);
      });
    }
  });

  const readAtOf = new Map();
  const readAt = (areaId) => {
    if (!readAtOf.has(areaId)) readAtOf.set(areaId, passes.flatMap((pass, at) => (pass.read.has(areaId) ? [at] : [])));
    return readAtOf.get(areaId);
  };
  // each pass that read an area → the pass that read it before
  const previousOf = new Map();
  const previousRead = (areaId) => {
    if (!previousOf.has(areaId)) {
      const reading = readAt(areaId);
      previousOf.set(areaId, new Map(reading.slice(1).map((at, index) => [at, reading[index]])));
    }
    return previousOf.get(areaId);
  };

  // first seen first, then north to south, so the numbers read down the list
  spots.sort((one, two) => one.members[0].at - two.members[0].at || two.centre[1] - one.centre[1] || one.centre[0] - two.centre[0]);
  const finished = spots.map((spot, index) => {
    const seenAt = new Map(spot.members.map((member) => [member.at, member]));
    const presence = passes.map((pass, at) => (seenAt.has(at) ? 'present' : pass.read.has(spot.areaId) ? 'absent' : 'unread'));
    const reading = readAt(spot.areaId);
    const first = spot.members[0];
    const last = spot.members.at(-1);
    return {
      id: `S${index + 1}`,
      areaId: spot.areaId,
      centre: spot.centre,
      members: spot.members,
      presence,
      first: first.date,
      last: last.date,
      seen: spot.members.length,
      read: reading.filter((at) => at >= first.at).length,
      category: categoryOf(presence, reading),
      verdicts: tally(spot.members.map((member) => member.result)),
    };
  });

  const counted = passes.map((pass, at) => {
    const results = pass.results.filter((result) => keep(result.area_id));
    const byArea = {};
    for (const result of results) (byArea[result.area_id] ??= []).push(result);
    const arrived = [];
    const left = [];
    for (const spot of finished) {
      if (!pass.read.has(spot.areaId)) continue;
      const before = previousRead(spot.areaId).get(at);
      if (before === undefined) continue;
      const now = spot.presence[at] === 'present';
      const then = spot.presence[before] === 'present';
      if (now && !then) arrived.push(spot.id);
      if (then && !now) left.push(spot.id);
    }
    return {
      ...pass,
      counts: tally(results),
      byArea: Object.fromEntries(Object.entries(byArea).map(([areaId, list]) => [areaId, tally(list)])),
      arrived,
      left,
      // the first pass of an area has nothing before it to have arrived since
      compared: [...pass.read].some((areaId) => keep(areaId) && readAt(areaId)[0] !== at),
    };
  });

  return { passes: counted, spots: finished, radius, only };
}

/** How many spots fall in each category, with an `all` total. */
export function categoryCounts(spots) {
  const counts = { all: spots.length };
  for (const { id } of CATEGORIES) counts[id] = 0;
  for (const spot of spots) counts[spot.category]++;
  return counts;
}

/** The headline figures of a series, for the tiles and the note. */
export function seriesFigures(series) {
  const { passes, spots } = series;
  const candidates = passes.reduce((sum, pass) => sum + pass.counts.total, 0);
  const toReview = passes.reduce((sum, pass) => sum + pass.counts.toReview, 0);
  const newest = passes.at(-1) ?? null;
  return {
    passes: passes.length,
    first: passes[0]?.date ?? '',
    last: newest?.date ?? '',
    candidates,
    toReview,
    spots: spots.length,
    newest: newest?.counts.total ?? 0,
    arrived: newest?.arrived.length ?? 0,
    left: newest?.left.length ?? 0,
    steady: spots.filter((spot) => spot.category === 'steady').length,
    peak: passes.reduce((best, pass) => (pass.counts.total > (best?.counts.total ?? -1) ? pass : best), null),
  };
}

/** `●` present, `○` looked at and empty, `·` not read: a spot's passes as one line of text. */
export function presenceLine(presence) {
  return presence.map((state) => (state === 'present' ? '●' : state === 'absent' ? '○' : '·')).join('');
}

/** The candidate a spot is seen with on its newest pass, which is the one worth opening. */
export const newestMember = (spot) => spot?.members?.at(-1) ?? null;

/** The most candidates one verdict request carries, as the server holds it (`ReviewMany`). */
export const REVIEW_BATCH = 2000;

/** A list cut into runs of `size`, for requests that each carry a bounded part. */
export function inBatches(list, size = REVIEW_BATCH) {
  const parts = [];
  for (let at = 0; at < list.length; at += size) parts.push(list.slice(at, at + size));
  return parts;
}

/** The candidates a verdict on a spot reaches: every one of its members not pinned in the case. */
export function spotPicks(spot) {
  return (spot?.members ?? [])
    .filter((member) => member.result.review !== 'kept')
    .map((member) => ({ run_id: member.runId, result_id: member.result.id }));
}
