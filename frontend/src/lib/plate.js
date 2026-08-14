/**
 * The plate an analysis reading is exported as: a header, the drawing, a legend.
 *
 * Neither surface can hand over its own pixels usefully — the Graph draws on a Konva
 * canvas, which serialises no SVG, and the Timeline is HTML — so both are serialised
 * from the same scene their screen rendering already computes. What this module owns
 * is the frame around that drawing: an export is not a screenshot, it is a plate that
 * states which case, which lens, which question, which window and which clock the
 * reading was made under. A picture nobody can source is not evidence of anything.
 *
 * Pure on purpose: no DOM, no case, no fetch. The drawing arrives as a serialised body
 * plus its intrinsic size, and leaves inside a document.
 */

import { exactStamp } from './analysisViews.js';

/**
 * The plate's own geometry, in SVG user units (a unit is a pixel at 1:1).
 *
 * Fixed rather than measured: text metrics are a browser's answer and this module has
 * to give the same one under a test. Every column is wide enough for the wording the
 * legend actually holds, and a label too long for its column is truncated by the
 * caller, not wrapped here.
 */
export const PLATE = {
  pad: 28,
  titleSize: 17,
  metaSize: 11,
  legendSize: 11,
  legendRow: 20,
  legendColumn: 168,
  swatch: 26,
  minWidth: 760,
  maxWidth: 4800,
  /** Roughly what one character costs at each size, for the two places that have to
   *  know before drawing: the title, which shares its line with the stamp, and a label
   *  cut to the room beside it. Measured text is a browser's answer; a plate needs the
   *  same one under a test. */
  titleChar: 9.4,
  metaChar: 5.7,
};

/**
 * The plate is always drawn on the daylight palette, whatever the analyst reads in.
 *
 * Two reasons, and neither is taste: a plate is meant to be filed, printed or pasted
 * into a document that is white, and an export whose colours follow a local preference
 * is an export two analysts cannot compare. The values mirror `:root[data-theme='light']`
 * in `app.css` — `plate.test.js` fails when they drift — and they are literal, because
 * a `var(--…)` means nothing in a file opened outside the app.
 */
export const PLATE_COLOURS = {
  paper: '#ffffff',
  ink: '#1e1e1e',
  label: '#5c5c5c',
  hint: '#8a8a8a',
  rule: '#e3e3e3',
  accent: '#e8a33d',
  family: {
    actor: '#3f6ea8',
    asset: '#2f7f72',
    class: '#85661a',
    identifier: '#6f57a0',
    collected: '#a35f34',
    document: '#5b6674',
    place: '#4a7f36',
    claim: '#a35470',
  },
};

/** A stack every renderer has, since the app's own face may not be installed where the
 *  plate is opened. Oxanium is deliberately absent: a missing face shifts every label. */
export const PLATE_FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";

export function escapeXml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

/**
 * Cut a string to the room it has, by code point.
 *
 * By code point because half a surrogate pair is not a character, and a plate carrying
 * one cannot be written out as UTF-8. `charWidth` is the caller's own metric: a title
 * and a lane label are not the same face.
 */
export function fitText(text, room, charWidth = PLATE.metaChar) {
  const clean = String(text ?? '').trim();
  const chars = Math.floor(Math.max(0, room) / charWidth);
  if (chars <= 1) return '';
  const glyphs = [...clean];
  return glyphs.length <= chars ? clean : `${glyphs.slice(0, chars - 1).join('')}…`;
}

/** Coordinates at two decimals: a plate is not a place to ship 14 of them. */
export function round(value) {
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : 0;
}

const attrs = (pairs) =>
  Object.entries(pairs)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}="${escapeXml(value)}"`)
    .join(' ');

/**
 * `halo` paints the label's own outline in the paper colour first, which is what makes
 * a name readable where it crosses a line. The canvas does the same thing with
 * `fillAfterStrokeEnabled`; without it the graph's names are read through the edges
 * they sit on.
 */
export function svgText(text, {
  x, y, size = PLATE.metaSize, fill = PLATE_COLOURS.ink, weight, anchor, opacity, halo,
} = {}) {
  const clean = String(text ?? '');
  if (!clean.trim()) return '';
  return `<text ${attrs({
    x: round(x),
    y: round(y),
    'font-size': size,
    'font-weight': weight,
    'text-anchor': anchor,
    fill,
    'fill-opacity': opacity,
    stroke: halo ? PLATE_COLOURS.paper : undefined,
    'stroke-width': halo ? halo : undefined,
    'stroke-linejoin': halo ? 'round' : undefined,
    'paint-order': halo ? 'stroke' : undefined,
  })}>${escapeXml(clean)}</text>`;
}

export function svgLine({ x1, y1, x2, y2, stroke = PLATE_COLOURS.rule, width = 1, dash }) {
  return `<line ${attrs({
    x1: round(x1), y1: round(y1), x2: round(x2), y2: round(y2),
    stroke, 'stroke-width': width, 'stroke-dasharray': dash,
  })} />`;
}

export function svgRect({ x, y, width, height, fill, stroke, radius, opacity, strokeWidth, dash }) {
  return `<rect ${attrs({
    x: round(x), y: round(y), width: round(width), height: round(height),
    rx: radius, fill, 'fill-opacity': opacity, stroke,
    'stroke-width': strokeWidth, 'stroke-dasharray': dash,
  })} />`;
}

export function svgCircle({ x, y, r, fill, stroke, strokeWidth, opacity, dash }) {
  return `<circle ${attrs({
    cx: round(x), cy: round(y), r: round(r), fill, 'fill-opacity': opacity,
    stroke, 'stroke-width': strokeWidth, 'stroke-dasharray': dash,
  })} />`;
}

export function svgPath(d, { stroke, fill = 'none', width, dash, cap = 'round', marker, opacity } = {}) {
  return `<path ${attrs({
    d, fill, stroke, 'stroke-width': width, 'stroke-dasharray': dash,
    'stroke-linecap': cap, 'stroke-opacity': opacity, 'marker-end': marker,
  })} />`;
}

/**
 * The header block: what this reading is, and of what.
 *
 * Everything here is a statement the drawing cannot make about itself. The title is
 * the saved view's name when one is open, because that is what the analyst will look
 * for; without one it is the surface and its lens, which is what they were looking at.
 */
export function plateHeader(meta = {}, width = PLATE.minWidth) {
  const pad = PLATE.pad;
  const wanted = String(meta.view || meta.title || '').trim() || 'Untitled reading';
  const facts = [meta.caseName, meta.surface, meta.lens].map((part) => String(part ?? '').trim());
  const line = facts.filter(Boolean).join(' · ');
  const question = String(meta.question ?? '').trim();
  const reading = [
    meta.window ? `Fact time ${meta.window}` : '',
    meta.clock ? `Clock ${meta.clock}` : '',
  ].filter(Boolean).join(' · ');

  const stamp = exactStamp(meta.at);
  const stamped = stamp ? `Exported ${stamp}` : '';
  // The stamp sits at the right edge on the title's own baseline, so the title is cut to
  // what is left of the line rather than run underneath it. A view can be named with 80
  // characters, which is wider than a small plate.
  const room = width - pad * 2 - (stamped ? stamped.length * PLATE.metaChar + 20 : 0);
  const title = fitText(wanted, Math.max(room, PLATE.titleSize * 6), PLATE.titleChar) || wanted;
  const parts = [];
  let y = pad + PLATE.titleSize;
  parts.push(svgText(title, { x: pad, y, size: PLATE.titleSize, weight: '600' }));
  if (stamped) {
    parts.push(svgText(stamped, {
      x: width - pad, y, anchor: 'end', fill: PLATE_COLOURS.hint,
    }));
  }
  if (line) {
    y += 17;
    parts.push(svgText(line, { x: pad, y, fill: PLATE_COLOURS.label }));
  }
  if (question) {
    y += 15;
    parts.push(svgText(`Question: ${question}`, { x: pad, y, fill: PLATE_COLOURS.label }));
  }
  if (reading) {
    y += 15;
    parts.push(svgText(reading, { x: pad, y, fill: PLATE_COLOURS.label }));
  }
  // What the drawing leaves out, when the surface knows of something: entries with no
  // date, nodes hidden by a focus. A reading that quietly omits is a reading nobody can
  // check.
  if (String(meta.aside ?? '').trim()) {
    y += 15;
    parts.push(svgText(meta.aside, { x: pad, y, fill: PLATE_COLOURS.hint }));
  }
  // What the drawing does hold, counted: how much is on the page, and any convention it
  // dropped to stay readable. The surface writes it, since only it knows what it drew.
  if (String(meta.tally ?? '').trim()) {
    y += 15;
    parts.push(svgText(meta.tally, { x: pad, y, fill: PLATE_COLOURS.hint }));
  }
  y += 14;
  parts.push(svgLine({ x1: pad, y1: y, x2: width - pad, y2: y }));
  return { svg: parts.filter(Boolean).join('\n'), height: y };
}

/**
 * The legend: the hues, then the strokes.
 *
 * Both come from the registry the drawing itself reads — families in their own order,
 * edge kinds with the wording the tool uses on screen — so a plate never invents a
 * vocabulary. An unexplained dash pattern is decoration, which is the whole reason
 * this block exists.
 */
export function plateLegend({ families = [], strokes = [] } = {}, width = PLATE.minWidth, top = 0) {
  const pad = PLATE.pad;
  const usable = Math.max(PLATE.legendColumn, width - pad * 2);
  const columns = Math.max(1, Math.floor(usable / PLATE.legendColumn));
  const parts = [svgLine({ x1: pad, y1: top, x2: width - pad, y2: top })];
  let y = top + 18;

  const place = (entries, draw) => {
    entries.forEach((entry, index) => {
      const column = index % columns;
      if (column === 0 && index) y += PLATE.legendRow;
      parts.push(draw(entry, pad + column * PLATE.legendColumn, y));
    });
    if (entries.length) y += PLATE.legendRow;
  };

  // A family names its own hue; a timeline track carries one the analyst chose, so an
  // entry may state it outright rather than be looked up.
  place(families, (entry, x, at) => [
    svgCircle({ x: x + 5, y: at - 4, r: 5, fill: entry.colour ?? familyColour(entry.family) }),
    svgText(
      entry.count === undefined ? entry.family : `${entry.family} · ${entry.count}`,
      { x: x + 16, y: at, size: PLATE.legendSize, fill: PLATE_COLOURS.label },
    ),
  ].join(''));

  // A convention drawn as a line where it is one, and as the mark itself where it is
  // not: a legend claiming a point is a stroke explains the wrong thing.
  place(strokes, (entry, x, at) => [
    entry.shape === 'dot'
      ? svgCircle({ x: x + PLATE.swatch / 2, y: at - 4, r: 4, fill: PLATE_COLOURS.label })
      : svgLine({
        x1: x, y1: at - 4, x2: x + PLATE.swatch, y2: at - 4,
        stroke: PLATE_COLOURS.label,
        width: entry.width ?? 1.4,
        dash: (entry.dash ?? []).join(' ') || undefined,
      }),
    svgText(entry.label, {
      x: x + PLATE.swatch + 7, y: at, size: PLATE.legendSize, fill: PLATE_COLOURS.label,
    }),
  ].join(''));

  return { svg: parts.join('\n'), height: Math.max(0, y - top) };
}

export function familyColour(family) {
  return PLATE_COLOURS.family[family] ?? PLATE_COLOURS.family.document;
}

/**
 * Frame one drawing into a complete document.
 *
 * The drawing arrives already serialised in its own coordinate space, with the size it
 * needs; the plate widens to hold it, up to a cap no reader benefits from crossing. It
 * is placed under the header rather than scaled to fit: the whole point of a vector
 * file is that the zoom belongs to whoever opens it.
 */
export function plateDocument({ meta = {}, families = [], strokes = [], drawing } = {}) {
  const pad = PLATE.pad;
  const body = drawing?.body ?? '';
  const width = Math.min(
    PLATE.maxWidth,
    Math.max(PLATE.minWidth, Math.round((drawing?.width ?? 0) + pad * 2)),
  );
  const header = plateHeader(meta, width);
  const drawTop = header.height + 18;
  const drawHeight = Math.max(120, Math.round(drawing?.height ?? 0));
  const legend = plateLegend({ families, strokes }, width, drawTop + drawHeight + 18);
  const height = Math.round(drawTop + drawHeight + 18 + legend.height + pad);
  const offset = Math.max(pad, Math.round((width - (drawing?.width ?? 0)) / 2));

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"`
      + ` viewBox="0 0 ${width} ${height}" font-family="${escapeXml(PLATE_FONT)}">`,
    svgRect({ x: 0, y: 0, width, height, fill: PLATE_COLOURS.paper }),
    drawing?.defs ? `<defs>${drawing.defs}</defs>` : '',
    header.svg,
    `<g transform="translate(${round(offset)} ${round(drawTop)})">`,
    body,
    '</g>',
    legend.svg,
    '</svg>',
  ].filter(Boolean).join('\n');

  return { svg, width, height };
}

/**
 * The name to suggest for the file.
 *
 * Stem from the reading rather than the tool, because a folder holding a month of
 * exports is read by what they are about. The stamp is the export's own minute, in
 * UTC, so two plates of the same reading do not collide.
 */
export function plateFilename({ surface = 'graph', view = '', lens = '', at } = {}) {
  const slug = (value) => String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  const stem = slug(view) || slug(lens) || 'reading';
  const stamp = exactStamp(at).replace(/[^0-9]/g, '').slice(0, 12) || 'undated';
  return `${slug(surface) || 'plate'}-${stem}-${stamp}`;
}
