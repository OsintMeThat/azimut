import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { axisTicks, layoutTimelineItems } from './timeline.js';
import { TRACK_COLORS } from './timelineTracks.js';
import { PLATE_COLOURS } from './plate.js';
import {
  PLATE_CATEGORIES,
  PLATE_PLOT,
  PLATE_TRACKS,
  TIMELINE_PLATE,
  fitLabel,
  timelineDrawing,
  timelineLegend,
  timelinePlate,
  trackColour,
} from './timelinePlate.js';

const css = readFileSync(new URL('../app.css', import.meta.url), 'utf8');

const FROM = Date.parse('2026-03-01T00:00:00Z');
const TO = Date.parse('2026-03-31T00:00:00Z');

const ITEMS = [
  {
    id: 't1', label: 'Convoy seen at the roundabout', category: 'statement',
    earliest: '2026-03-04T09:00:00Z', latest: '2026-03-04T09:00:00Z',
    shape: 'point', sortable: true, raw: '2026-03-04T09:00:00Z',
  },
  {
    id: 't2', label: 'Checkpoint standing', category: 'statement',
    earliest: '2026-03-10T00:00:00Z', latest: '2026-03-18T00:00:00Z',
    shape: 'interval', approximate: true, sortable: true, raw: '2026-03-10/2026-03-18',
  },
  {
    id: 't3', label: 'IMG_2291.jpg', category: 'media',
    earliest: '2026-03-22T00:00:00Z', latest: '2026-03-22T23:59:59Z',
    shape: 'point', zone: 'date-only', precision: 'day', sortable: true, raw: '2026-03-22',
  },
];

function track(extra = {}) {
  const items = extra.items ?? ITEMS;
  return {
    id: 'events',
    label: 'Events',
    categories: ['statement'],
    total: items.length,
    items,
    layout: layoutTimelineItems(items, FROM, TO, PLATE_PLOT),
    ...extra,
  };
}

function scene(extra = {}) {
  return {
    tracks: [track()],
    ticks: axisTicks(FROM, TO, PLATE_PLOT),
    minorTicks: [],
    bands: [{ left: 0, width: 100, label: 'March 2026' }],
    nowLeft: null,
    scaleWord: 'Days',
    clock: 'UTC',
    ...extra,
  };
}

describe('the timeline palette on paper', () => {
  it('keeps the category hues the light theme states', () => {
    const plain = css.replace(/\/\*[\s\S]*?\*\//g, '');
    const light = plain.slice(plain.indexOf(":root[data-theme='light']"));
    for (const [category, hue] of Object.entries(PLATE_CATEGORIES)) {
      const token = category === 'case_activity' ? 'activity' : category;
      expect(light).toContain(`--timeline-${token}: ${hue}`);
    }
  });

  it('steps the six track colours down for white paper', () => {
    expect(Object.keys(PLATE_TRACKS)).toEqual(TRACK_COLORS);
    for (const hue of Object.values(PLATE_TRACKS)) {
      expect(hue).toMatch(/^#[0-9a-f]{6}$/);
      // Readable as a mark on white: the screen's own annotation yellow is not.
      const [r, g, b] = [1, 3, 5].map((at) => parseInt(hue.slice(at, at + 2), 16) / 255);
      expect(0.2126 * r + 0.7152 * g + 0.0722 * b).toBeLessThan(0.55);
    }
  });

  it('gives a coloured track its colour and an unset one its category', () => {
    expect(trackColour({ color: 'blue', categories: ['statement'] })).toBe(PLATE_TRACKS.blue);
    expect(trackColour({ categories: ['media'] })).toBe(PLATE_CATEGORIES.media);
    expect(trackColour({})).toBe(PLATE_CATEGORIES.statement);
  });
});

describe('serialising the timeline', () => {
  it('draws the ruler, its scale and one lane block per track', () => {
    const drawing = timelineDrawing(scene());

    expect(drawing.tracks).toBe(1);
    expect(drawing.body).toContain('March 2026');
    expect(drawing.body).toContain('Days · UTC');
    expect(drawing.body).toContain('>Events<');
    expect(drawing.width).toBe(TIMELINE_PLATE.width);
    expect(drawing.height).toBeGreaterThan(TIMELINE_PLATE.ruler);
  });

  it('turns a percentage into a place on the axis, never a viewport', () => {
    const { body } = timelineDrawing(scene());
    const plot = TIMELINE_PLATE.width - TIMELINE_PLATE.names - TIMELINE_PLATE.right;
    const item = track().layout.items.find((entry) => entry.id === 't1');
    const expected = Math.round((TIMELINE_PLATE.names + item.left * plot / 100) * 100) / 100;

    expect(body).toContain(`cx="${expected}"`);
  });

  it('draws an instant, a period and the span a reduced date covers apart', () => {
    const { body } = timelineDrawing(scene());

    expect(body).toContain('Convoy seen at the roundabout'); // a point, with its name
    expect(body).toContain('Checkpoint standing');
    // the approximate period is a dashed bar, the day-only media its own hairline
    expect(body).toMatch(/<rect[^>]*stroke-dasharray="4 3"/);
    expect(body).toMatch(/<rect[^>]*fill-opacity="0.35"/);
  });

  it('marks a proposal hollow, the way every surface draws one', () => {
    const suggested = [{ ...ITEMS[0], status: 'suggested' }];
    const { body } = timelineDrawing(scene({ tracks: [track({ items: suggested })] }));

    expect(body).toContain(`fill="${PLATE_COLOURS.paper}"`);
  });

  it('says a track is folded instead of drawing lanes it is hiding', () => {
    const { body, height } = timelineDrawing(scene({ tracks: [track({ collapsed: true })] }));
    const open = timelineDrawing(scene());

    expect(body).toContain('>folded<');
    expect(body).not.toContain('Checkpoint standing');
    expect(height).toBeLessThan(open.height);
  });

  it('counts what a lane could not hold rather than dropping it quietly', () => {
    // Seven entries at one instant: the layout keeps six lanes and clusters the rest.
    const crowded = Array.from({ length: 7 }, (_, index) => ({
      ...ITEMS[0], id: `c${index}`, label: `Entry ${index}`,
    }));
    const laid = layoutTimelineItems(crowded, FROM, TO, PLATE_PLOT);
    const { body } = timelineDrawing(scene({ tracks: [track({ items: crowded, layout: laid })] }));

    expect(laid.clusters.length).toBeGreaterThan(0);
    expect(body).toContain(`+${laid.clusters[0].count}`);
  });

  it('says so when the window holds nothing', () => {
    const { body } = timelineDrawing(scene({ tracks: [track({ items: [], layout: layoutTimelineItems([], FROM, TO, PLATE_PLOT) })] }));
    expect(body).toContain('No entries in this window');
  });

  it('draws the present as a line only when it falls inside the window', () => {
    expect(timelineDrawing(scene({ nowLeft: 40 })).body).toContain('>Now<');
    expect(timelineDrawing(scene()).body).not.toContain('>Now<');
  });

  it('is laid out at its own width, which is the axis it draws', () => {
    expect(PLATE_PLOT).toBe(TIMELINE_PLATE.width - TIMELINE_PLATE.names - TIMELINE_PLATE.right);
  });

  it('holds a label inside the room its lane reserved, not the room to the page edge', () => {
    // The lane packing gives every entry a box, in pixels, and that box is why the next
    // entry sits where it sits. A label written past it runs under its neighbour.
    const long = [{ ...ITEMS[0], label: 'A convoy of eleven trucks leaving the depot at dawn' }];
    const laid = layoutTimelineItems(long, FROM, TO, PLATE_PLOT);
    const { body } = timelineDrawing(scene({ tracks: [track({ items: long, layout: laid })] }));
    const written = body.match(/>(A convoy[^<]*)</)[1];

    expect(written).not.toBe(long[0].label);
    expect([...written].length * TIMELINE_PLATE.charWidth)
      .toBeLessThanOrEqual(laid.items[0].displayWidth);
  });

  it('labels an entry at the far right leftwards, the way the screen does', () => {
    const late = [{
      ...ITEMS[0], id: 'late', label: 'Last convoy',
      earliest: '2026-03-29T00:00:00Z', latest: '2026-03-29T00:00:00Z',
      raw: '2026-03-29T00:00:00Z',
    }];
    const laid = layoutTimelineItems(late, FROM, TO, PLATE_PLOT);
    const { body } = timelineDrawing(scene({ tracks: [track({ items: late, layout: laid })] }));

    expect(laid.items[0].endAligned).toBe(true);
    expect(body).toMatch(/<text[^>]*text-anchor="end"[^>]*>Last convoy</);
  });

  it('keeps a bar that ends with the window inside the axis', () => {
    // A short period carries a minimum width of its own, so one closing on the last hour
    // of the window would cross the ruler it is being read against.
    const tail = [{
      id: 'tail', label: 'Standing watch', category: 'statement',
      earliest: '2026-03-30T20:00:00Z', latest: '2026-03-31T00:00:00Z',
      shape: 'interval', sortable: true, raw: '2026-03-30T20:00:00Z/2026-03-31T00:00:00Z',
    }];
    const laid = layoutTimelineItems(tail, FROM, TO, PLATE_PLOT);
    const { body } = timelineDrawing(scene({ tracks: [track({ items: tail, layout: laid })] }));
    const bar = body.match(/<rect[^>]*fill-opacity="0.22"[^>]*>/)[0];
    const at = Number(bar.match(/ x="([\d.]+)"/)[1]);
    const wide = Number(bar.match(/ width="([\d.]+)"/)[1]);

    expect(wide).toBeGreaterThan(0);
    expect(at + wide).toBeLessThanOrEqual(TIMELINE_PLATE.width - TIMELINE_PLATE.right);
  });
});

describe('the timeline legend', () => {
  it('names every track and the conventions the drawing uses', () => {
    const { families, strokes } = timelineLegend([
      track({ color: 'blue' }),
      track({ id: 'media', label: 'Photos', groupLabel: 'Media', categories: ['media'] }),
    ]);

    expect(families[0]).toEqual({ family: 'Events', colour: PLATE_TRACKS.blue });
    expect(families[1].family).toBe('Media · Photos');
    expect(strokes.map((entry) => entry.label)).toContain('approximate');
    // A point is drawn as a mark, not as a stroke: the legend says what it shows.
    expect(strokes[0]).toEqual({ label: 'an instant', shape: 'dot' });
  });
});

describe('the timeline plate', () => {
  it('states the window and the clock it was read on', () => {
    const { svg } = timelinePlate({
      meta: {
        caseName: 'Bakhmut convoy', surface: 'Timeline', view: 'March window',
        window: '1 – 31 Mar 2026', clock: 'Asia/Tokyo', at: '2026-08-13T20:10:00Z',
      },
      ...scene(),
    });

    expect(svg).toContain('March window');
    expect(svg).toContain('Fact time 1 – 31 Mar 2026 · Clock Asia/Tokyo');
    expect(svg).toContain('an instant');
    expect(svg).not.toMatch(/var\(--/);
  });

  it('counts what the window holds, since the page is one reading of it', () => {
    const { svg } = timelinePlate({ meta: { view: 'March window' }, ...scene() });
    expect(svg).toContain('1 track · 3 entries in this window');
  });
});

describe('fitting a label', () => {
  it('cuts to the room beside the marker, and gives up when there is none', () => {
    expect(fitLabel('Checkpoint standing', 1000)).toBe('Checkpoint standing');
    expect(fitLabel('Checkpoint standing', 30)).toBe('Chec…');
    expect(fitLabel('Checkpoint standing', 3)).toBe('');
    // Never through a surrogate pair: a plate holding half of one cannot be written.
    expect(fitLabel('🏴🏴🏴🏴', 18)).toBe('🏴🏴…');
    expect(fitLabel(null, 100)).toBe('');
  });
});
