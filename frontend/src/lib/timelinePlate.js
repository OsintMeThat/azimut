/**
 * The Timeline, serialised as SVG.
 *
 * The axis is HTML on screen — lanes of absolutely placed entries, every position a
 * percentage of the window — so there is nothing to rasterise and nothing to copy. What
 * there is, is the layout: `layoutTimelineItems` answers where every entry sits, in
 * percentages, and a percentage lands on a plate as easily as in a stylesheet. This
 * module multiplies out and draws, and decides nothing about time.
 *
 * It is handed a layout computed at `PLATE_PLOT`, not the one on screen. Lanes are packed
 * by the pixels a label takes, so a layout made for the browser's width and replayed here
 * would reserve the wrong gaps — the plate has to be the same page whatever window it was
 * exported from.
 *
 * It draws what the screen draws: a point for an instant, a bracket across the period
 * a reduced date covers, a bar for a period, and a caption only where the layout found
 * it room. Two deliberate differences from the screen:
 *
 * - **The window is the reading.** A Timeline plate is its saved window, never a
 *   viewport: the axis is what the analyst chose to look at.
 * - **Nobody can hover a page.** Where the layout left captions out, the plate lists the
 *   window's entries under the drawing, date as written beside each, and says so in its
 *   header, so a reader holds every name the screen would have shown on demand.
 */

import {
  PLATE_COLOURS,
  fitText,
  plateDocument,
  round,
  svgCircle,
  svgLine,
  svgRect,
  svgText,
} from './plate.js';
import { MARKS, cardTop, formatTemporalValue } from './timeline.js';
import { TRACK_COLORS } from './timelineTracks.js';

/** The plate's own axis geometry, in SVG user units. */
export const TIMELINE_PLATE = {
  width: 1180,
  names: 150,
  right: 16,
  ruler: 38,
  trackHead: 17,
  /** One row of marks, the same 18 units as the screen's pixels. */
  lane: MARKS.row,
  trackGap: 12,
  marker: 4,
  /** The chronology under the drawing, when captions were left out. */
  listHead: 30,
  listRow: 15,
  listDate: 190,
  /** Roughly what one character of the 10px label face costs. Fixed rather than
   *  measured: a plate has to come out the same under a test. */
  charWidth: 5.4,
  labelSize: 10,
};

/**
 * How wide the plate's axis is, in pixels.
 *
 * The number a caller has to lay its entries out against. `layoutTimelineItems` packs
 * lanes by the room a label takes **in pixels**, so a layout computed for the screen and
 * replayed here would reserve the wrong gaps: two entries the browser kept apart at
 * 1900px land on top of each other at 1014, and a narrow window clusters entries this
 * page had the room to draw. The Timeline hands over a layout made at this width.
 */
export const PLATE_PLOT = TIMELINE_PLATE.width - TIMELINE_PLATE.names - TIMELINE_PLATE.right;

/**
 * A track's colour on paper.
 *
 * The screen's own palette is `--anno-*`, which is tuned to sit on satellite imagery
 * and is the same in both themes: its yellow disappears on white. So the six keep their
 * order and their meaning, stepped down for paper — the way the graph families are.
 * A track with no colour of its own inherits its category's, as on screen.
 */
export const PLATE_TRACKS = {
  red: '#c0392b',
  blue: '#2c6fb5',
  amber: '#a8791a',
  green: '#2f8f5b',
  magenta: '#a03a9e',
  orange: '#b4661c',
};

/** Mirrors `--timeline-*` in `app.css`'s light theme; `timelinePlate.test.js` fails on
 *  a drift. */
export const PLATE_CATEGORIES = {
  statement: '#1f7669',
  media: '#4264b5',
  case_activity: '#76539d',
};

export function trackColour(track = {}) {
  if (TRACK_COLORS.includes(track.color)) return PLATE_TRACKS[track.color];
  return PLATE_CATEGORIES[track.categories?.[0]] ?? PLATE_CATEGORIES.statement;
}

/** Cut a label to what the space beside it can hold, at the lane face's own metric. */
export function fitLabel(text, room) {
  return fitText(text, room, TIMELINE_PLATE.charWidth);
}

/**
 * The axis and its lanes, sized to the tracks it holds.
 *
 * `tracks` are the grouped tracks the tool draws — each with its `layout` from
 * `layoutTimelineItems` — and `ticks`, `bands` and `nowLeft` are the axis readings it
 * already computed for the same window.
 */
export function timelineDrawing({
  tracks = [],
  ticks = [],
  minorTicks = [],
  bands = [],
  nowLeft = null,
  scaleWord = '',
  clock = '',
} = {}) {
  const geometry = TIMELINE_PLATE;
  const width = geometry.width;
  const plotLeft = geometry.names;
  const plotWidth = PLATE_PLOT;
  const plotRight = plotLeft + plotWidth;
  const atPercent = (percent) => plotLeft + (Number(percent) || 0) * plotWidth / 100;

  // Every track's height first, so the gridlines can run the whole way down.
  const heights = tracks.map((track) => {
    if (track.collapsed) return 0;
    const layout = track.layout ?? {};
    const rows = Math.max(1, layout.rows ?? 1);
    const cards = layout.cardRows ?? 0;
    return rows * geometry.lane + (cards ? 6 + cards * (MARKS.cardHeight + 6) : 0);
  });
  const height = tracks.reduce(
    (total, _track, index) => total + geometry.trackHead + heights[index] + geometry.trackGap,
    geometry.ruler,
  );

  const parts = [];

  // -- the ruler ------------------------------------------------------------
  parts.push(svgLine({
    x1: plotLeft, y1: geometry.ruler, x2: width - geometry.right, y2: geometry.ruler,
    stroke: PLATE_COLOURS.hint,
  }));
  for (const band of bands) {
    parts.push(svgText(band.label, {
      x: atPercent(band.left) + 3, y: 12, size: 10, fill: PLATE_COLOURS.hint,
    }));
  }
  for (const tick of ticks) {
    const x = atPercent(tick.left);
    parts.push(svgLine({ x1: x, y1: geometry.ruler - 6, x2: x, y2: geometry.ruler }));
    parts.push(svgText(tick.label, {
      x, y: geometry.ruler - 9, size: 10, anchor: 'middle', fill: PLATE_COLOURS.label,
    }));
  }
  const scale = [scaleWord, clock].filter(Boolean).join(' · ');
  if (scale) {
    parts.push(svgText(scale, {
      x: plotLeft - 8, y: geometry.ruler - 9, size: 10, anchor: 'end', fill: PLATE_COLOURS.hint,
    }));
  }

  // -- the gridlines, down every lane ---------------------------------------
  for (const tick of minorTicks) {
    const x = atPercent(tick.left);
    parts.push(svgLine({ x1: x, y1: geometry.ruler, x2: x, y2: height, stroke: PLATE_COLOURS.rule, dash: '2 4' }));
  }
  for (const tick of ticks) {
    const x = atPercent(tick.left);
    parts.push(svgLine({ x1: x, y1: geometry.ruler, x2: x, y2: height, stroke: PLATE_COLOURS.rule }));
  }
  if (nowLeft !== null && nowLeft !== undefined) {
    const x = atPercent(nowLeft);
    parts.push(svgLine({ x1: x, y1: geometry.ruler, x2: x, y2: height, stroke: PLATE_COLOURS.accent, dash: '5 4' }));
    parts.push(svgText('Now', { x: x + 3, y: geometry.ruler + 11, size: 9, fill: PLATE_COLOURS.accent }));
  }

  // -- the tracks -----------------------------------------------------------
  let top = geometry.ruler;
  let entries = 0;
  let labelled = 0;
  const listed = new Map();
  tracks.forEach((track, index) => {
    const colour = trackColour(track);
    const head = top + geometry.trackHead;
    const drawn = track.layout?.items ?? [];
    const clusters = track.layout?.clusters ?? [];
    const held = drawn.length + clusters.reduce((sum, cluster) => sum + (cluster.count ?? 0), 0);
    entries += held;
    parts.push(svgCircle({ x: 8, y: head - 8, r: 4, fill: colour }));
    parts.push(svgText(fitLabel(track.label, geometry.names - 46), {
      x: 18, y: head - 4, size: 11, weight: '600', fill: PLATE_COLOURS.ink,
    }));
    parts.push(svgText(track.collapsed ? 'folded' : String(held), {
      x: geometry.names - 10, y: head - 4, size: 10, anchor: 'end', fill: PLATE_COLOURS.hint,
    }));
    if (track.groupLabel) {
      parts.push(svgText(fitLabel(track.groupLabel, geometry.names - 28), {
        x: 18, y: head + 8, size: 9, fill: PLATE_COLOURS.hint,
      }));
    }

    if (!track.collapsed) {
      for (const item of [...drawn, ...clusters.flatMap((cluster) => cluster.items ?? [])]) {
        if (!listed.has(item.id)) listed.set(item.id, { item, track: track.label });
      }
      for (const item of drawn) {
        const middle = head + item.row * geometry.lane + geometry.lane / 2;
        const x = atPercent(item.left);
        const span = Math.max(MARKS.bar, Math.min((Number(item.width) || 0) * plotWidth / 100, plotRight - x));
        const hollow = item.status === 'suggested';
        if (item.mark === 'bar') {
          parts.push(svgRect({
            x, y: middle - 4, width: span, height: 8, radius: 2,
            fill: colour, opacity: hollow ? 0.08 : 0.3, stroke: colour, strokeWidth: 1,
            dash: item.approximate ? '4 3' : (hollow ? '1.5 2' : undefined),
          }));
        } else if (item.mark === 'bracket') {
          // The whole period a reduced date covers, as the thin line it is on screen:
          // the entry is somewhere in here, and the plate must not claim a point.
          parts.push(svgRect({
            x, y: middle - 1, width: span, height: 2, fill: colour, opacity: hollow ? 0.5 : 0.9,
          }));
          const stop = item.approximate ? '2 2' : undefined;
          if (!item.openStart) parts.push(svgLine({ x1: x, y1: middle - 4, x2: x, y2: middle + 4, stroke: colour, width: 2, dash: stop }));
          if (!item.openEnd) parts.push(svgLine({ x1: x + span, y1: middle - 4, x2: x + span, y2: middle + 4, stroke: colour, width: 2, dash: stop }));
        } else {
          parts.push(svgCircle({
            x, y: middle, r: geometry.marker,
            fill: hollow ? PLATE_COLOURS.paper : colour,
            stroke: colour,
            strokeWidth: 1.4,
            dash: item.approximate ? '2 2' : undefined,
          }));
        }
        const ink = item.confidence === 'refuted' ? PLATE_COLOURS.hint : PLATE_COLOURS.ink;
        if (item.caption) {
          labelled += 1;
          const from = plotLeft + item.caption.left;
          const text = fitLabel(item.label, item.caption.width);
          if (text) {
            const right = item.caption.side === 'left';
            parts.push(svgText(text, {
              x: right ? from + item.caption.width : from,
              y: middle + 3.5, size: geometry.labelSize, anchor: right ? 'end' : undefined, fill: ink,
            }));
          }
        } else if (item.card) {
          labelled += 1;
          const cardY = head + cardTop(track.layout, item.card.row) - MARKS.top;
          const anchor = plotLeft + item.card.anchor;
          parts.push(svgLine({ x1: anchor, y1: middle + 4, x2: anchor, y2: cardY, stroke: colour }));
          parts.push(svgRect({
            x: plotLeft + item.card.left, y: cardY, width: item.card.width, height: MARKS.cardHeight,
            radius: 5, fill: PLATE_COLOURS.paper, stroke: colour, strokeWidth: 1,
          }));
          parts.push(svgText(fitLabel(item.label, item.card.width - 16), {
            x: plotLeft + item.card.left + 8, y: cardY + 16, size: geometry.labelSize, weight: '600', fill: ink,
          }));
          parts.push(svgText(fitLabel(formatTemporalValue(item.raw, item.tz).label, item.card.width - 16), {
            x: plotLeft + item.card.left + 8, y: cardY + 30, size: 9, fill: PLATE_COLOURS.hint,
          }));
        }
      }
      // What the lane could not hold, counted rather than dropped silently.
      for (const cluster of clusters) {
        const laneTop = head + cluster.row * geometry.lane;
        parts.push(svgText(`+${cluster.count}`, {
          x: atPercent(cluster.left), y: laneTop + geometry.lane / 2 + 3.5,
          size: 10, anchor: 'middle', fill: PLATE_COLOURS.hint,
        }));
      }
      if (!drawn.length && !clusters.length) {
        parts.push(svgText('No entries in this window', {
          x: plotLeft + 6, y: head + geometry.lane / 2 + 3.5, size: 10, fill: PLATE_COLOURS.hint,
        }));
      }
    }

    top += geometry.trackHead + heights[index] + geometry.trackGap;
  });

  parts.push(svgLine({ x1: plotLeft, y1: round(height), x2: width - geometry.right, y2: round(height), stroke: PLATE_COLOURS.hint }));

  // -- the chronology, when the drawing could not name everything ------------
  let bottom = height;
  const named = labelled >= listed.size;
  if (!named) {
    const rows = [...listed.values()].sort((a, b) =>
      String(a.item.earliest).localeCompare(String(b.item.earliest))
      || String(a.item.id).localeCompare(String(b.item.id)));
    bottom += geometry.listHead;
    parts.push(svgText('Every entry in this window', {
      x: 8, y: bottom - 10, size: 11, weight: '600', fill: PLATE_COLOURS.ink,
    }));
    const statement = width - geometry.right - (8 + geometry.listDate) - geometry.names;
    for (const { item, track } of rows) {
      bottom += geometry.listRow;
      parts.push(svgText(fitLabel(formatTemporalValue(item.raw, item.tz).label, geometry.listDate - 10), {
        x: 8, y: bottom, size: 9, fill: PLATE_COLOURS.label,
      }));
      parts.push(svgText(fitLabel(item.label, statement), {
        x: 8 + geometry.listDate, y: bottom, size: 10,
        fill: item.confidence === 'refuted' ? PLATE_COLOURS.hint : PLATE_COLOURS.ink,
      }));
      parts.push(svgText(fitLabel(track, geometry.names - 10), {
        x: width - geometry.right, y: bottom, size: 9, anchor: 'end', fill: PLATE_COLOURS.hint,
      }));
    }
    bottom += 8;
  }

  return {
    body: parts.filter(Boolean).join('\n'),
    width,
    height: Math.round(bottom + 4),
    tracks: tracks.length,
    entries,
    labelled: Math.min(labelled, listed.size),
    listed: named ? 0 : listed.size,
  };
}

/**
 * The legend a timeline plate needs: what each track's colour stands for, and the
 * conventions the drawing uses to stay honest about precision.
 */
export function timelineLegend(tracks = []) {
  const families = tracks.map((track) => ({
    family: track.groupLabel ? `${track.groupLabel} · ${track.label}` : track.label,
    colour: trackColour(track),
  }));
  const strokes = [
    { label: 'an instant', shape: 'dot' },
    { label: 'the span a reduced date covers', dash: [], width: 2 },
    { label: 'a period', dash: [], width: 8 },
    { label: 'approximate', dash: [4, 3], width: 1.4 },
  ];
  return { families, strokes };
}

export function timelinePlate({ meta = {}, ...scene } = {}) {
  const drawing = timelineDrawing(scene);
  const { families, strokes } = timelineLegend(scene.tracks ?? []);
  const tally = [
    `${drawing.tracks} track${drawing.tracks === 1 ? '' : 's'}`,
    `${drawing.entries} entr${drawing.entries === 1 ? 'y' : 'ies'} in this window`,
    drawing.listed ? `labels shown for ${drawing.labelled} of ${drawing.listed}; the full list follows` : '',
  ].filter(Boolean).join(' · ');
  return {
    ...plateDocument({ meta: { ...meta, tally }, families, strokes, drawing }),
    drawing,
  };
}
