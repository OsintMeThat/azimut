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
 * Two deliberate differences from the screen:
 *
 * - **The window is the reading.** A Timeline plate is its saved window, never a
 *   viewport: the axis is what the analyst chose to look at.
 * - **An entry carries its name, not its date.** On screen the date is written beside
 *   the label because a pixel cannot be read precisely. A plate has a ruler above every
 *   lane and draws the precision it holds — a point, a bar, a dashed edge for an
 *   approximation, a hairline for the span a reduced date covers — so the words would be
 *   the one thing on the page repeating what the drawing already says.
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
import { TRACK_COLORS } from './timelineTracks.js';

/** The plate's own axis geometry, in SVG user units. */
export const TIMELINE_PLATE = {
  width: 1180,
  names: 150,
  right: 16,
  ruler: 38,
  trackHead: 17,
  lane: 24,
  trackGap: 12,
  marker: 4,
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
  const rows = tracks.map((track) => (track.collapsed ? 0 : Math.max(1, track.layout?.rows ?? 1)));
  const height = tracks.reduce(
    (total, _track, index) =>
      total + geometry.trackHead + rows[index] * geometry.lane + geometry.trackGap,
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
      for (const item of drawn) {
        const laneTop = head + item.lane * geometry.lane;
        const middle = laneTop + geometry.lane / 2;
        const x = atPercent(item.left);
        const interval = item.shape === 'interval';
        // Held inside the axis: a bar carries a minimum width of its own, so one that
        // starts at the very end of the window would otherwise cross the ruler it is
        // being read against.
        const span = Math.max(1.5, Math.min((Number(item.width) || 0) * plotWidth / 100, plotRight - x));
        // The span a reduced date covers, drawn as the hairline it is on screen: the
        // entry is somewhere in here, and the plate must not claim a point instead.
        if (!interval && item.haloWidth > 0) {
          const haloLeft = atPercent(item.haloLeft);
          parts.push(svgRect({
            x: haloLeft,
            y: middle + 7,
            width: Math.max(1, Math.min((Number(item.haloWidth) || 0) * plotWidth / 100, plotRight - haloLeft)),
            height: 3,
            fill: colour,
            opacity: 0.35,
          }));
        }
        if (interval) {
          parts.push(svgRect({
            x, y: middle - 6, width: span, height: 12, radius: 3,
            fill: colour, opacity: 0.22, stroke: colour, strokeWidth: 1,
            dash: item.approximate ? '4 3' : undefined,
          }));
        } else {
          parts.push(svgCircle({
            x, y: middle, r: geometry.marker,
            fill: item.status === 'suggested' ? PLATE_COLOURS.paper : colour,
            stroke: colour,
            strokeWidth: 1.4,
            dash: item.approximate ? '2 2' : undefined,
          }));
        }
        // The lane packing reserved this entry a box, in these same units, and that box
        // is why the lane below it is empty. A label is cut to it rather than to the far
        // edge of the page, since the room out there is where the next entry stands.
        const reserved = interval || !Number.isFinite(item.displayWidth)
          ? Infinity
          : Math.max(0, item.displayWidth - geometry.marker - 6);
        // An entry the packing pushed against the right edge is labelled leftwards, the
        // way the screen labels it, so its name has somewhere to go.
        const anchor = !interval && item.endAligned ? 'end' : undefined;
        const edge = anchor
          ? x - geometry.marker - 5
          : (interval ? x + span + 6 : x + geometry.marker + 5);
        const label = fitLabel(
          item.label,
          Math.min(anchor ? edge - plotLeft : plotRight - edge, reserved),
        );
        if (label) {
          parts.push(svgText(label, {
            x: edge, y: middle + 3.5, size: geometry.labelSize, anchor,
            fill: item.confidence === 'refuted' ? PLATE_COLOURS.hint : PLATE_COLOURS.ink,
          }));
        }
      }
      // What the lane could not hold, counted rather than dropped silently.
      for (const cluster of clusters) {
        const laneTop = head + cluster.lane * geometry.lane;
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

    top += geometry.trackHead + rows[index] * geometry.lane + geometry.trackGap;
  });

  parts.push(svgLine({ x1: plotLeft, y1: round(height), x2: width - geometry.right, y2: round(height), stroke: PLATE_COLOURS.hint }));

  return {
    body: parts.filter(Boolean).join('\n'),
    width,
    height: Math.round(height + 4),
    tracks: tracks.length,
    entries,
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
    { label: 'a period', dash: [], width: 8 },
    { label: 'approximate', dash: [4, 3], width: 1.4 },
    { label: 'the span a reduced date covers', dash: [], width: 2 },
  ];
  return { families, strokes };
}

export function timelinePlate({ meta = {}, ...scene } = {}) {
  const drawing = timelineDrawing(scene);
  const { families, strokes } = timelineLegend(scene.tracks ?? []);
  const tally = [
    `${drawing.tracks} track${drawing.tracks === 1 ? '' : 's'}`,
    `${drawing.entries} entr${drawing.entries === 1 ? 'y' : 'ies'} in this window`,
  ].join(' · ');
  return {
    ...plateDocument({ meta: { ...meta, tally }, families, strokes, drawing }),
    drawing,
  };
}
