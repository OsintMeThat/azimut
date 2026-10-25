/**
 * The plates Azimut ships ready to start from: one for each kind of map an open
 * investigation publishes, each laid out by a designer's rules for the paper it is set
 * on rather than stretched from one size.
 *
 * Each is a template as `templateOf` keeps one (paper, look, every element where it
 * stands, the ground each map is drawn on, no case's data), so `fromTemplate` turns it
 * into a plate over the case's ground and layers like any template the analyst made.
 * Pictures are left empty with the words of what goes in them, which the editor writes
 * inside until a picture is chosen.
 */
import { NEUTRAL_TONE, THEMES, onPaper, pageSize } from './page.js';
import { styled } from './design.js';

/** The papers a ready plate is offered on, `[id, label, page]`, the first its own. */
export const FORMATS = [
  ['report', 'Report, A4', { paper: 'a4', orientation: 'landscape' }],
  ['slide', 'Post or slide, 16:9', { paper: 'screen', orientation: 'landscape' }],
  ['feed', 'Feed post, 4:5', { paper: 'social', orientation: 'portrait' }],
  ['square', 'Square', { paper: 'square', orientation: 'portrait' }],
  ['story', 'Story, 9:16', { paper: 'screen', orientation: 'portrait' }],
  ['print', 'Print, A3', { paper: 'a3', orientation: 'landscape' }],
];

const r = (value) => Math.round(value * 10) / 10;
const box = (x, y, w, h) => [r(x), r(y), r(Math.max(1, w)), r(Math.max(1, h))];

/** The page a recipe draws on: its size, its margin, and whether it is wide. */
function frame(page) {
  const { width: W, height: H } = pageSize(page);
  return { W, H, m: r(Math.max(6, Math.min(W, H) * 0.045)), wide: W >= H * 1.05 };
}

/** The theme of a look, named so the inspector says which. */
const lookOf = (id) => ({ ...THEMES[id].theme, preset: id });

/** The elements every recipe builds from, in the page's theme `t`, a locator drawn on `ground`. */
function kit(t, ground = 'plain') {
  // the style first, then what the recipe sets over it (a title's size, a line in bold)
  const text = (id, role, b, words, more = {}) => ({ ...styled({ id, kind: 'text', box: b, text: words, align: 'left', valign: 'top' }, role, t), ...more });
  return {
    text,
    map: (id, b, basemap, more = {}) => ({ id, kind: 'map', box: b, basemap, overlays: [], grid: 'none', tone: { ...NEUTRAL_TONE }, border: true, ...more }),
    legend: (b, of = 'map', more = {}) => ({ id: 'legend', kind: 'legend', of, box: b, size: 7.5, border: false, fill: t.paper, text: 'Key', ...more }),
    inset: (b, of = 'map', more = {}) => ({ id: 'inset', kind: 'inset', of, box: b, border: true, zoom: null, basemap: ground, ...more }),
    scale: (b, of = 'map') => ({ id: 'scale', kind: 'scale', of, box: b, fill: t.paper }),
    north: (b, of = 'map') => ({ id: 'north', kind: 'north', of, box: b, fill: t.paper }),
    credits: (b, of = 'map', more = {}) => ({ id: 'credits', kind: 'credits', of, box: b, size: 5, align: 'right', ...more }),
    picture: (id, b, hint) => ({ id, kind: 'image', box: b, text: hint, fit: 'cover', border: true }),
    list: (b, title = '') => ({ id: 'key', kind: 'key', box: b, size: 8, border: false, fill: t.paper, text: title }),
    table: (b) => ({ id: 'table', kind: 'table', box: b, size: 7, source: 'events', rows: 12, border: false, fill: t.paper, text: 'Chronology' }),
    rule: (id, b) => ({ id, kind: 'shape', shape: 'line', box: b, width: 0.6, colour: t.ink }),
    panel: (id, b) => ({ id, kind: 'shape', shape: 'rect', box: b, width: 1, border: false, fill: t.paper, opacity: 0.94 }),
    signature: (b) => ({ id: 'signature', kind: 'signature', box: b, text: '{handle}\n{today}', size: 7, align: 'right' }),
    qr: (b) => ({ id: 'qr', kind: 'qr', box: b, text: '' }),
  };
}

/** A kicker, a title and a standfirst stacked from `y`, `w` wide; where the next thing can start. */
function header(k, x, y, w, kicker, { title = '{case}', dek = '', big = 20 } = {}) {
  const titleH = r(big * 0.5);
  const out = [
    k.text('kicker', 'kicker', box(x, y, w, 4.5), kicker),
    k.text('title', 'title', box(x, y + 5, w, titleH), title, { size: big }),
  ];
  let next = y + 5 + titleH + 1;
  if (dek) {
    out.push(k.text('dek', 'dek', box(x, next, w, 9), dek));
    next += 10;
  }
  return { elements: out, next: r(next) };
}

/** The situation map: the front line on a quiet ground, its key and a locator beside it. */
function situation(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('newsroom');
  const k = kit(t, THEMES.newsroom.ground);
  const ground = THEMES.newsroom.ground;
  if (wide) {
    const head = header(k, m, m, W * 0.6, 'Situation', { dek: 'Where the line stands, from geolocated footage.' });
    const top = head.next + 2;
    const mw = W * 0.7 - m;
    const mh = H - top - m - 7;
    const x = m + mw + 5;
    const w = W - m - x;
    return { t, elements: [
      k.map('map', box(m, top, mw, mh), ground),
      ...head.elements,
      k.text('badge', 'badge', box(W - m - 48, m + 1, 48, 7), 'As of {date}'),
      k.rule('rule', box(m, top - 2, W - 2 * m, 1)),
      k.legend(box(x, top, w, mh * 0.5)),
      k.inset(box(x, top + mh * 0.5 + 4, w, Math.min(w * 0.8, mh * 0.5 - 14))),
      k.text('source', 'source', box(x, top + mh - 8, w, 8), 'Sources: geolocated footage and open imagery.'),
      k.scale(box(m + 4, top + mh - 9, 36, 5)),
      k.north(box(m + mw - 12, top + 4, 8, 12)),
      k.credits(box(m, top + mh + 1.5, mw, 4.5)),
    ] };
  }
  const head = header(k, m, m, W - 2 * m, 'Situation', { dek: 'Where the line stands, from geolocated footage.', big: 18 });
  const top = head.next + 9;
  const mh = (H - top - m) * 0.62;
  const below = top + mh + 7;
  const half = (W - 2 * m - 4) / 2;
  return { t, elements: [
    k.map('map', box(m, top, W - 2 * m, mh), ground),
    ...head.elements,
    k.text('badge', 'badge', box(m, head.next, 46, 7), 'As of {date}'),
    k.legend(box(m, below, half, H - below - m - 9)),
    k.inset(box(m + half + 4, below, half, Math.min(half * 0.75, H - below - m - 9))),
    k.text('source', 'source', box(m, H - m - 7, W - 2 * m, 7), 'Sources: geolocated footage and open imagery.'),
    k.scale(box(m + 4, top + mh - 9, 36, 5)),
    k.north(box(W - m - 12, top + 4, 8, 12)),
    k.credits(box(m, top + mh + 1, W - 2 * m, 4.5)),
  ] };
}

/** The geolocation card: the footage beside the place it was filmed, its matches numbered. */
function geolocation(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('brief');
  const k = kit(t, THEMES.brief.ground);
  const head = header(k, m, m, W - 2 * m - (wide ? 60 : 0), 'Geolocation', { big: wide ? 18 : 16 });
  const top = head.next + 3;
  const foot = 16;
  if (wide) {
    const pw = (W - 2 * m - 5) * 0.48;
    const mh = H - top - m - foot;
    const mx = m + pw + 5;
    const mw = W - m - mx;
    return { t, elements: [
      k.map('map', box(mx, top, mw, mh), 'esri-world-imagery'),
      ...head.elements,
      k.picture('footage', box(m, top, pw, mh), 'The footage, a still'),
      k.text('coords', 'body', box(m, top + mh + 3, pw, 6), '{coords}', { weight: 700 }),
      k.text('source', 'source', box(m, top + mh + 9, pw, 6), 'Filmed by … · posted … · geolocated by {handle}'),
      k.list(box(mx, top + mh + 3, mw - 26, foot - 4), 'Matches'),
      k.qr(box(W - m - 14, top + mh + 2, 14, 14)),
      k.north(box(mx + mw - 12, top + 4, 8, 12)),
      k.scale(box(mx + 4, top + mh - 9, 34, 5)),
      k.credits(box(mx, top + mh - 5, mw, 4.5), 'map', { align: 'right' }),
    ] };
  }
  const ph = (H - top - m - foot - 4) / 2;
  return { t, elements: [
    k.map('map', box(m, top + ph + 4, W - 2 * m, ph), 'esri-world-imagery'),
    ...head.elements,
    k.picture('footage', box(m, top, W - 2 * m, ph), 'The footage, a still'),
    k.text('coords', 'body', box(m, H - m - foot + 2, W - 2 * m - 18, 6), '{coords}', { weight: 700 }),
    k.text('source', 'source', box(m, H - m - foot + 8, W - 2 * m - 18, 6), 'Filmed by … · posted … · geolocated by {handle}'),
    k.qr(box(W - m - 14, H - m - 14, 14, 14)),
    k.north(box(W - m - 12, top + ph + 8, 8, 12)),
    k.credits(box(m, top + 2 * ph + 4 - 5, W - 2 * m, 4.5)),
  ] };
}

/** Before and after: the same ground on two dates, side by side, what changed counted. */
function beforeAfter(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('brief');
  const k = kit(t, THEMES.brief.ground);
  const head = header(k, m, m, W - 2 * m, 'Before and after', { big: wide ? 18 : 16 });
  const top = head.next + 3;
  const foot = 26;
  const gap = 3;
  const [mw, mh] = wide ? [(W - 2 * m - gap) / 2, H - top - m - foot] : [W - 2 * m, (H - top - m - foot - gap) / 2];
  const [bx, by] = wide ? [m + mw + gap, top] : [m, top + mh + gap];
  return { t, elements: [
    k.map('before', box(m, top, mw, mh), 'esri-wayback'),
    k.map('after', box(bx, by, mw, mh), 'esri-world-imagery'),
    ...head.elements,
    k.text('before-badge', 'badge', box(m + 3, top + 3, 30, 6.5), 'Before'),
    k.text('after-badge', 'badge', box(bx + 3, by + 3, 30, 6.5), 'After'),
    k.text('figure', 'figure', box(m, H - m - foot + 2, 34, 13), '0'),
    k.text('figure-said', 'caption', box(m + 35, H - m - foot + 4, W * 0.35, 10), 'buildings destroyed or damaged between the two dates'),
    k.legend(box(W - m - Math.min(80, W * 0.38), H - m - foot + 3, Math.min(80, W * 0.38), foot - 9), 'after'),
    k.north(box(bx + mw - 11, by + 3, 7, 11), 'after'),
    k.credits(box(m, H - m - 4, W - 2 * m, 4), 'before'),
  ] };
}

/** The incident map: every reported event on the ground, its chronology beside it. */
function incidents(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('situation');
  const k = kit(t, THEMES.situation.ground);
  const ground = THEMES.situation.ground;
  const head = header(k, m, m, W * (wide ? 0.6 : 1) - m, 'Incidents', { dek: 'Every reported event, placed and dated.', big: wide ? 20 : 17 });
  const top = head.next + 2;
  if (wide) {
    const mw = W * 0.64 - m;
    const mh = H - top - m - 6;
    const x = m + mw + 5;
    const w = W - m - x;
    return { t, elements: [
      k.map('map', box(m, top, mw, mh), ground),
      ...head.elements,
      k.text('badge', 'badge', box(W - m - 48, m + 1, 48, 7), '{date}'),
      k.table(box(x, top, w, mh * 0.66)),
      k.legend(box(x, top + mh * 0.66 + 4, w, mh * 0.34 - 4)),
      k.scale(box(m + 4, top + mh - 9, 36, 5)),
      k.credits(box(m, top + mh + 1.2, mw, 4.5)),
    ] };
  }
  const mh = (H - top - m) * 0.55;
  const below = top + mh + 7;
  return { t, elements: [
    k.map('map', box(m, top, W - 2 * m, mh), ground),
    ...head.elements,
    k.table(box(m, below, W - 2 * m, (H - below - m) * 0.7)),
    k.legend(box(m, below + (H - below - m) * 0.7 + 3, W - 2 * m, (H - below - m) * 0.3 - 3), 'map', { columns: 2 }),
    k.credits(box(m, top + mh + 1, W - 2 * m, 4.5)),
  ] };
}

/** A route or a track: a convoy's, a vessel's, a flight's, its stops numbered and listed. */
function track(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('tactical');
  const k = kit(t, THEMES.tactical.ground);
  const ground = THEMES.tactical.ground;
  const head = header(k, m, m, W - 2 * m, 'Track', { dek: 'Where it went, stop by stop.', big: wide ? 20 : 17 });
  const top = head.next + 2;
  const side = wide ? W * 0.26 : 0;
  const mw = W - 2 * m - (wide ? side + 5 : 0);
  const mh = wide ? H - top - m - 6 : (H - top - m) * 0.62;
  return { t, elements: [
    k.map('map', box(m, top, mw, mh), ground),
    ...head.elements,
    k.list(wide ? box(m + mw + 5, top, side, mh * 0.62) : box(m, top + mh + 7, W - 2 * m, (H - top - mh - m) * 0.55), 'Stops'),
    k.legend(wide ? box(m + mw + 5, top + mh * 0.62 + 4, side, mh * 0.38 - 4) : box(m, H - m - (H - top - mh - m) * 0.35, W - 2 * m, (H - top - mh - m) * 0.35)),
    k.scale(box(m + 4, top + mh - 9, 36, 5)),
    k.north(box(m + mw - 12, top + 4, 8, 12)),
    k.credits(box(m, top + mh + 1.2, mw, 4.5)),
  ] };
}

/** The line of sight: where the camera stood, what it saw, on the relief that hid the rest. */
function sightline(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('atlas');
  const k = kit(t, THEMES.atlas.ground);
  const ground = THEMES.atlas.ground;
  const head = header(k, m, m, W - 2 * m, 'Line of sight', { dek: 'Where the camera stood and what it could see.', big: wide ? 20 : 17 });
  const top = head.next + 2;
  if (wide) {
    const mw = (W - 2 * m) * 0.62;
    const mh = H - top - m - 6;
    const x = m + mw + 5;
    const w = W - m - x;
    return { t, elements: [
      k.map('map', box(m, top, mw, mh), ground),
      ...head.elements,
      k.picture('view', box(x, top, w, w * 0.62), 'The view from the ground'),
      k.text('caption', 'caption', box(x, top + w * 0.62 + 2, w, 18), 'What the picture shows, and how far away it is.'),
      k.legend(box(x, top + w * 0.62 + 22, w, mh - w * 0.62 - 22)),
      k.scale(box(m + 4, top + mh - 9, 36, 5)),
      k.north(box(m + mw - 12, top + 4, 8, 12)),
      k.credits(box(m, top + mh + 1.2, mw, 4.5)),
    ] };
  }
  const ph = (H - top - m) * 0.3;
  const mh = (H - top - m) * 0.55;
  return { t, elements: [
    k.map('map', box(m, top + ph + 4, W - 2 * m, mh), ground),
    ...head.elements,
    k.picture('view', box(m, top, W - 2 * m, ph), 'The view from the ground'),
    k.text('caption', 'caption', box(m, top + ph + mh + 10, W - 2 * m, H - (top + ph + mh + 10) - m), 'What the picture shows, and how far away it is.'),
    k.north(box(W - m - 12, top + ph + 8, 8, 12)),
    k.credits(box(m, top + ph + mh + 5, W - 2 * m, 4.5)),
  ] };
}

/** A site's profile: a facility from above, what stands there numbered and named. */
function site(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('brief');
  const k = kit(t, THEMES.brief.ground);
  const head = header(k, m, m, W - 2 * m, 'Site profile', { big: wide ? 20 : 17 });
  const top = head.next + 2;
  const side = wide ? W * 0.27 : 0;
  const mw = W - 2 * m - (wide ? side + 5 : 0);
  const mh = wide ? H - top - m - 6 : (H - top - m) * 0.64;
  const x = m + mw + 5;
  return { t, elements: [
    k.map('map', box(m, top, mw, mh), 'esri-world-imagery'),
    ...head.elements,
    k.list(wide ? box(x, top, side, mh - side * 0.8 - 4) : box(m, top + mh + 7, (W - 2 * m) * 0.6, H - top - mh - m - 7), 'What stands there'),
    k.inset(wide ? box(x, top + mh - side * 0.8, side, side * 0.8) : box(m + (W - 2 * m) * 0.6 + 4, top + mh + 7, (W - 2 * m) * 0.4 - 4, (W - 2 * m) * 0.3)),
    k.scale(box(m + 4, top + mh - 9, 36, 5)),
    k.north(box(m + mw - 12, top + 4, 8, 12)),
    k.credits(box(m, top + mh + 1.2, mw, 4.5)),
  ] };
}

/** The locator: the place, a closer look at it, and where it lies in the world. */
function locator(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('humanitarian');
  const k = kit(t, THEMES.humanitarian.ground);
  const ground = THEMES.humanitarian.ground;
  const head = header(k, m, m, W - 2 * m, 'Where', { dek: 'The place, closer, and where it lies.', big: wide ? 20 : 17 });
  const top = head.next + 2;
  const mw = W - 2 * m;
  const mh = H - top - m - 6;
  const dw = Math.min(mw * 0.36, 90);
  const iw = Math.min(mw * 0.22, 52);
  return { t, elements: [
    k.map('map', box(m, top, mw, mh), ground),
    k.map('detail', box(m + mw - dw - 4, top + 4, dw, dw * 0.75), 'esri-world-imagery', { of: 'map', name: 'Detail' }),
    ...head.elements,
    k.inset(box(m + 4, top + mh - iw - 4, iw, iw), 'map', { globe: true }),
    k.scale(box(m + iw + 10, top + mh - 9, 36, 5)),
    k.credits(box(m, top + mh + 1.2, mw, 4.5)),
  ] };
}

/** A post: the map to the edges, its title on a card over it, signed. */
function post(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('situation');
  const k = kit(t, THEMES.situation.ground);
  const ground = THEMES.situation.ground;
  const cw = wide ? W * 0.42 : W - 2 * m;
  const ch = wide ? 34 : 38;
  const cy = H - m - ch - 6;
  return { t, elements: [
    k.map('map', box(0, 0, W, H), ground, { border: false }),
    k.panel('card', box(m, cy, cw, ch)),
    k.text('kicker', 'kicker', box(m + 4, cy + 4, cw - 8, 4.5), 'Situation'),
    k.text('title', 'title', box(m + 4, cy + 9, cw - 8, 12), '{case}', { size: 18 }),
    k.text('dek', 'caption', box(m + 4, cy + 22, cw - 8, ch - 24), 'As of {date}. Sources: geolocated footage.'),
    k.text('badge', 'badge', box(m, m, 46, 7), 'As of {date}'),
    k.legend(box(W - m - Math.min(62, W * 0.3), m, Math.min(62, W * 0.3), wide ? H * 0.38 : H * 0.22), 'map', { border: false, opacity: 0.94 }),
    k.signature(box(W - m - 56, H - m - 15, 56, 9)),
    k.credits(box(0, H - 4.5, W, 4.5), 'map', { align: 'center' }),
  ] };
}

/** The briefing page: a numbered situation, its key points written beside the map. */
function briefing(page) {
  const { W, H, m, wide } = frame(page);
  const t = lookOf('humanitarian');
  const k = kit(t, THEMES.humanitarian.ground);
  const ground = THEMES.humanitarian.ground;
  const head = header(k, m, m, W - 2 * m, 'Briefing', { dek: 'What happened, where, and what is known.', big: wide ? 20 : 17 });
  const top = head.next + 2;
  const side = wide ? W * 0.3 : 0;
  const mw = W - 2 * m - (wide ? side + 6 : 0);
  const mh = wide ? H - top - m - 6 : (H - top - m) * 0.6;
  const x = m + mw + 6;
  const words = '1. What happened.\n2. Where it happened, and how it was placed.\n3. What is not known yet.';
  return { t, elements: [
    k.map('map', box(m, top, mw, mh), ground),
    ...head.elements,
    k.text('points', 'body', wide ? box(x, top, side, mh * 0.45) : box(m, top + mh + 7, (W - 2 * m) * 0.6, 22), words),
    k.text('figure', 'figure', wide ? box(x, top + mh * 0.47, side, 13) : box(m + (W - 2 * m) * 0.64, top + mh + 7, (W - 2 * m) * 0.36, 13), '0'),
    k.text('figure-said', 'caption', wide ? box(x, top + mh * 0.47 + 14, side, 10) : box(m + (W - 2 * m) * 0.64, top + mh + 21, (W - 2 * m) * 0.36, 10), 'what the figure counts'),
    k.legend(wide ? box(x, top + mh * 0.66, side, mh * 0.34) : box(m, top + mh + 33, W - 2 * m, H - (top + mh + 33) - m), 'map', wide ? {} : { columns: 2 }),
    k.north(box(m + mw - 12, top + 4, 8, 12)),
    k.credits(box(m, top + mh + 1.2, mw, 4.5)),
  ] };
}

/**
 * The ready plates, in the order the gallery shows them: the id, the name, what it is
 * for in one line, the paper it opens on unless another is picked, and its recipe.
 */
export const GALLERY = [
  { id: 'situation', name: 'Situation map', note: 'The front line or the areas held, on a quiet ground, its key beside it.', format: 'report', make: situation },
  { id: 'geolocation', name: 'Geolocation card', note: 'The footage beside the place it was filmed, the matches numbered.', format: 'slide', make: geolocation },
  { id: 'before-after', name: 'Before and after', note: 'The same ground on two dates, side by side, what changed counted.', format: 'slide', make: beforeAfter },
  { id: 'incidents', name: 'Incidents', note: 'Every reported event placed and dated, its chronology beside the map.', format: 'report', make: incidents },
  { id: 'track', name: 'Route or track', note: 'A convoy, a vessel or a flight, its stops numbered and listed.', format: 'report', make: track },
  { id: 'sightline', name: 'Line of sight', note: 'Where the camera stood and what it could see, on the relief.', format: 'report', make: sightline },
  { id: 'site', name: 'Site profile', note: 'A facility from above, what stands there numbered and named.', format: 'report', make: site },
  { id: 'locator', name: 'Locator', note: 'The place, a closer look at it, and where it lies.', format: 'report', make: locator },
  { id: 'briefing', name: 'Briefing', note: 'A map with its key points and a figure written beside it.', format: 'report', make: briefing },
  { id: 'post', name: 'Post', note: 'The map to the edges, its title on a card over it, signed.', format: 'slide', make: post },
];

/** The page of a format by its id. */
export const formatPage = (id) => (FORMATS.find(([key]) => key === id) ?? FORMATS[0])[2];

/**
 * A ready plate as a template on `page`: its paper, its look and its elements, maps
 * under the rest, as `fromTemplate` takes one.
 */
export function readyTemplate(id, page = null) {
  const entry = GALLERY.find((item) => item.id === id);
  if (!entry) return null;
  const on = page ?? formatPage(entry.format);
  const { t, elements } = entry.make(on);
  const maps = elements.filter((element) => element.kind === 'map' && !element.of);
  const details = elements.filter((element) => element.kind === 'map' && element.of);
  const rest = elements.filter((element) => element.kind !== 'map');
  return { ready: id, page: { ...on }, theme: { ...t }, time: {}, elements: [...maps, ...details, ...rest] };
}

/**
 * A plate on another paper. One made from a ready plate is laid out again by its
 * recipe: each element it made takes the place the recipe gives it on that paper, with
 * everything else it holds kept (its words, its ground, its layers), and what was added
 * since keeps its share of the page. Any other plate keeps its share of the page
 * (`onPaper`).
 */
export function relaid(spec, page) {
  const fresh = spec.ready ? readyTemplate(spec.ready, page) : null;
  if (!fresh) return onPaper(spec, page);
  const boxes = new Map(fresh.elements.map((element) => [element.id, element.box]));
  const added = onPaper({ ...spec, elements: spec.elements.filter((element) => !boxes.has(element.id)) }, page).elements;
  const moved = new Map(added.map((element) => [element.id, element.box]));
  return { ...spec, page: { ...fresh.page }, elements: spec.elements.map((element) => ({ ...element, box: boxes.get(element.id) ?? moved.get(element.id) ?? element.box })) };
}
