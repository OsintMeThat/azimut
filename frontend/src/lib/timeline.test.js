import { describe, expect, it } from 'vitest';
import {
  DAY,
  HOUR,
  WINDOW_SPANS,
  axisBands,
  axisMinorTicks,
  axisScale,
  axisTicks,
  bucketScale,
  bucketSpan,
  bucketWindow,
  densityScale,
  densityTicks,
  densityUnit,
  compareTimelineItems,
  dateAtRatio,
  describePair,
  draftWhen,
  formatSpan,
  formatSpanRange,
  formatTemporalValue,
  initialWindow,
  UTC,
  inputWindowValue,
  instantOf,
  itemExtent,
  offsetLabel,
  layoutDensityBuckets,
  layoutTimelineItems,
  moveTemporalRaw,
  nudgeTemporalRaw,
  resizeTemporalRaw,
  resizeWindow,
  shiftWindow,
  timeAtRatio,
  validateTemporalValue,
  windowInputValue,
  windowWords,
  worldZones,
  zoneMatches,
  zoneOffset,
  zoneWords,
  zonedFields,
  zoomWindow,
} from './timeline.js';

describe('timeline window', () => {
  it('keeps exact UTC boundaries while moving and zooming', () => {
    expect(initialWindow({
      from: '2026-08-10T00:00:00Z',
      to: '2026-08-13T00:00:00Z',
    })).toEqual({ from: '2026-08-09T00:00:00Z', to: '2026-08-14T00:00:00Z' });
    expect(shiftWindow('2026-08-01', '2026-08-10', 1)).toEqual({
      from: '2026-08-11T00:00:00Z', to: '2026-08-21T00:00:00Z',
    });
    expect(zoomWindow('2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z', .5)).toEqual({
      from: '2026-08-03T12:00:00Z', to: '2026-08-08T12:00:00Z',
    });
  });

  it('round-trips second-level range controls as UTC', () => {
    expect(windowInputValue('2026-08-11T18:40:12Z')).toBe('2026-08-11T18:40:12');
    expect(inputWindowValue('2026-08-11T18:40')).toBe('2026-08-11T18:40:00Z');
    expect(inputWindowValue('2026-08-11T18:40:12')).toBe('2026-08-11T18:40:12Z');
  });

  it('preserves date precision and qualifiers during direct edits', () => {
    expect(moveTemporalRaw({ category: 'statement', raw: '2026-08~' }, 31 * DAY)).toBe('2026-09~');
    expect(moveTemporalRaw({ category: 'statement', raw: '2026-08-11/2026-08-13', shape: 'interval' }, 2 * DAY)).toBe('2026-08-13/2026-08-15');
    expect(resizeTemporalRaw({ category: 'statement', raw: '2026-08-11~/2026-08-13?', shape: 'interval' }, 'end', '2026-08-16')).toBe('2026-08-11~/2026-08-16?');
    expect(nudgeTemporalRaw({ category: 'statement', raw: '2026-08-11', shape: 'instant' }, 'move', 1)).toBe('2026-08-12');
    expect(moveTemporalRaw({
      category: 'statement', shape: 'interval',
      raw: '2026-08-11T10:15:00Z/2026-08-11T11:40:00Z',
    }, 60_000)).toBe('2026-08-11T10:16:00Z/2026-08-11T11:41:00Z');
    expect(resizeTemporalRaw({
      category: 'statement', shape: 'interval',
      raw: '2026-08-11T10:15:00+02:00/2026-08-11T11:40:00+02:00',
    }, 'end', '2026-08-11T10:00:00Z')).toBe(
      '2026-08-11T10:15:00+02:00/2026-08-11T12:00:00+02:00'
    );
  });

  it('refuses direct changes the case would reject', () => {
    expect(moveTemporalRaw(
      { category: 'statement', raw: '2026-09/2026-09-05', shape: 'interval' }, 16 * DAY
    )).toBeNull();
    expect(resizeTemporalRaw(
      { category: 'statement', raw: '2026-08-11/2026-08-13', shape: 'interval' },
      'start', '2026-08-20'
    )).toBeNull();
    expect(moveTemporalRaw({ category: 'statement', raw: '9998' }, 3 * 365 * DAY)).toBeNull();
  });

  it('creates exact timestamps when the visible window is close enough', () => {
    expect(dateAtRatio('2026-08-01', '2026-08-10', 0)).toBe('2026-08-01');
    expect(timeAtRatio('2026-06-23T00:00:00Z', '2026-06-24T00:00:00Z', .39999997))
      .toBe('2026-06-23T09:36:00Z');
    expect(draftWhen('2026-08-11T18:00:00Z', '2026-08-11T19:00:00Z', .5, .5))
      .toBe('2026-08-11T18:30:00Z');
    expect(draftWhen('2026-08-11T18:00:00Z', '2026-08-11T19:00:00Z', .25, .75))
      .toBe('2026-08-11T18:15:00Z/2026-08-11T18:45:00Z');
    expect(draftWhen('2026-08-01', '2026-08-10', .1, .8)).toBe('2026-08-02/2026-08-09');
  });
});

describe('temporal reading', () => {
  it('renders the stored syntax in plain language without losing it', () => {
    expect(formatTemporalValue('2026-08~')).toMatchObject({
      valid: true, label: 'Aug 2026', qualifiers: ['Approximate'],
    });
    expect(formatTemporalValue('2026-08-11T18:40:00+02:00').label)
      .toBe('11 Aug 2026, 18:40:00 UTC+02:00');
    expect(formatTemporalValue('2026-08-11/2026-08-14').label)
      .toBe('11 Aug 2026 to 14 Aug 2026');
  });

  it('validates the same supported families before save', () => {
    for (const raw of ['2026', '2026-08~', '2026-08-11?', '2026-08-11T18:40:00Z', '2026-08/2026-10', '2026-08-11T10:00:00Z/2026-08-11T11:00:00Z']) {
      expect(validateTemporalValue(raw).valid, raw).toBe(true);
    }
    for (const raw of ['2026-8', '2026-02-29', '2026-08-11T18:40', '2026-08-11T18:40:00+15:00', '2026-10/2026-08', '2026-08-11T10:00:00/2026-08-11T11:00:00']) {
      expect(validateTemporalValue(raw).valid, raw).toBe(false);
    }
  });
});

describe('timeline layout', () => {
  const point = (id, earliest, latest, shape = 'instant', label = id) => ({
    id, earliest, latest, shape, label, raw: earliest.slice(0, 10),
  });

  it('packs the rendered label width instead of a fixed axis fraction', () => {
    const layout = layoutTimelineItems([
      point('a', '2026-08-02T00:00:00Z', '2026-08-03T00:00:00Z', 'instant', 'A long checkpoint observation'),
      point('b', '2026-08-02T12:00:00Z', '2026-08-03T00:00:00Z', 'instant', 'Another long checkpoint observation'),
      point('c', '2026-08-05T00:00:00Z', '2026-08-08T00:00:00Z', 'interval', 'Road closure'),
    ], '2026-08-01', '2026-08-10', 1000);
    expect(layout.items.map((item) => item.lane)).toEqual([0, 1, 0]);
    expect(layout.items[0].displayWidth).toBeGreaterThan(150);
    expect(layout.items[0].haloWidth).toBeCloseTo(10, 3);
    expect(layout.items[2].displayWidth).toBeGreaterThan(250);
  });

  it('collapses overflow into a clear count', () => {
    const entries = Array.from({ length: 10 }, (_, index) =>
      point(`same-${index}`, '2026-08-02T00:00:00Z', '2026-08-03T00:00:00Z')
    );
    const layout = layoutTimelineItems(entries, '2026-08-01', '2026-08-10', 800, 3);
    expect(layout.items).toHaveLength(3);
    expect(layout.clusters).toHaveLength(1);
    expect(layout.clusters[0].count).toBe(7);
    expect(layout.rows).toBe(4);
  });

  it('keeps pinned entries visible when a dense track is packed', () => {
    const entries = Array.from({ length: 9 }, (_, index) => ({
      ...point(`same-${index}`, '2026-08-02T00:00:00Z', '2026-08-03T00:00:00Z'),
      pinned: index === 8,
    }));
    const layout = layoutTimelineItems(entries, '2026-08-01', '2026-08-10', 800, 3);
    expect(layout.items.some((item) => item.id === 'same-8')).toBe(true);
    expect(layout.clusters.flatMap((cluster) => cluster.items).some((item) => item.id === 'same-8'))
      .toBe(false);
  });

  it('targets a useful number of major ticks and adds context', () => {
    const short = axisTicks('2026-08-01T00:00:00Z', '2026-08-04T00:00:00Z', 1000);
    const medium = axisTicks('2026-06-10T00:00:00Z', '2026-08-03T00:00:00Z', 1000);
    const year = axisTicks('2026-01-01T00:00:00Z', '2027-01-01T00:00:00Z', 1000);
    for (const ticks of [short, medium, year]) {
      expect(ticks.length).toBeGreaterThanOrEqual(7);
      expect(ticks.length).toBeLessThanOrEqual(13);
    }
    expect(axisMinorTicks('2026-08-01T00:00:00Z', '2026-08-04T00:00:00Z', 1000).length)
      .toBeGreaterThan(0);
    expect(axisBands('2026-06-10T00:00:00Z', '2026-08-03T00:00:00Z', 1000).map((band) => band.label))
      .toContain('Jul 2026');
    expect(axisScale('2026-06-10T00:00:00Z', '2026-08-03T00:00:00Z', 1000)).toBe('Days');
  });

  it('keeps category breakdowns and scales the heights by count', () => {
    // The square root of the share: a quarter of the entries stands half as tall, so a
    // case whose one big batch dwarfs everything else still shows the rest.
    expect(bucketScale([{ start: '2025', count: 1 }, { start: '2026', count: 4 }]))
      .toEqual([{ start: '2025', count: 1, height: 50 }, { start: '2026', count: 4, height: 100 }]);
    expect(bucketScale([{ start: '2025', count: 1 }, { start: '2026', count: 200 }])[0].height)
      .toBe(12);
    const buckets = layoutDensityBuckets([
      { start: '2026-06-12', count: 2, categories: { statement: 1, media: 1 } },
    ], { from: '2026-06-12T00:00:00Z', to: '2026-06-13T00:00:00Z' });
    expect(buckets[0].categories).toEqual({ statement: 1, media: 1 });
  });

  it('opens a bucket onto what it holds, not onto the period it is named after', () => {
    // Six entries in the first week of August open a window on that week. Landing on
    // the month instead left the brush resting somewhere other than the bar clicked.
    expect(bucketWindow({
      start: '2026-08', first: '2026-08-02T00:00:00Z', last: '2026-08-10T00:00:00Z',
    })).toEqual({ from: '2026-08-01T12:28:48Z', to: '2026-08-10T11:31:12Z' });

    // One entry has no span of its own, so the window is half a day either side.
    expect(bucketWindow({
      start: '2026-08', first: '2026-08-02T00:00:00Z', last: '2026-08-02T00:00:00Z',
    })).toEqual({ from: '2026-08-01T12:00:00Z', to: '2026-08-02T12:00:00Z' });

    // A reading that predates the inner span — a saved snapshot — still opens the period.
    expect(bucketWindow('2026-06-12')).toEqual({ from: '2026-06-09T00:00:00Z', to: '2026-06-16T00:00:00Z' });
    expect(bucketWindow('2026-02')).toEqual({ from: '2026-02-01T00:00:00Z', to: '2026-03-01T00:00:00Z' });
    expect(bucketWindow('2026')).toEqual({ from: '2026-01-01T00:00:00Z', to: '2027-01-01T00:00:00Z' });
  });

  it('cuts the overview as fine as it can be drawn', () => {
    // Cut by the period the case happens to span, a scraped batch of two hundred in one
    // week and a single entry that could be anywhere in May drew the same one-month
    // mark. The bins are chosen for the width they will have on screen instead.
    const eightMonths = { from: '2026-01-03T00:00:00Z', to: '2026-08-09T00:00:00Z' };
    expect(densityUnit(eightMonths, 800)).toBe('day');
    // Zoomed onto a single day, the same rule cuts by the hour.
    expect(densityUnit({ from: '2026-08-02T00:00:00Z', to: '2026-08-02T20:00:00Z' }, 800)).toBe('hour');
    // A case spanning decades cannot be drawn by the day, and says so.
    expect(densityUnit({ from: '1998-01-01T00:00:00Z', to: '2026-08-09T00:00:00Z' }, 800)).toBe('month');
    expect(densityUnit({ from: '1500-01-01T00:00:00Z', to: '2026-08-09T00:00:00Z' }, 800)).toBe('year');
    // A narrow minimap holds fewer bins, so it is cut more coarsely.
    expect(densityUnit(eightMonths, 120)).toBe('month');
    expect(densityUnit(null, 800)).toBe('day');
  });

  it('draws one column per bin, across the bin, inside the brush that holds it', () => {
    // The overview's one promise: what the visible-range brush covers is what the axis
    // is showing. A bar drawn at the opening of the period it was counted under broke
    // it — a January bucket holding the 14th and the 27th marked the 1st, so the bar
    // for two entries on screen sat outside the brush that was showing them.
    const buckets = [
      { start: '2026-01-14', count: 1 },
      { start: '2026-01-27', count: 1 },
      { start: '2026-08-02', count: 6 },
    ];
    const extent = { from: '2026-01-14T00:00:00Z', to: '2026-08-03T00:00:00Z' };
    const scale = densityScale(buckets, extent);
    const at = (raw) => ((new Date(raw).getTime() - scale.first) / scale.span) * 100;

    // A column is as wide as its own bin — the day it counts — which is what makes the
    // heights beside it comparable.
    const drawn = layoutDensityBuckets(buckets, extent);
    expect(drawn.map((bar) => bar.left)).toEqual([
      at('2026-01-14T00:00:00Z'), at('2026-01-27T00:00:00Z'), at('2026-08-02T00:00:00Z'),
    ]);
    expect(drawn.map((bar) => bar.left + bar.width)).toEqual([
      at('2026-01-15T00:00:00Z'), at('2026-01-28T00:00:00Z'), at('2026-08-03T00:00:00Z'),
    ]);

    // Every column sits inside a window that holds the whole case, and only August's
    // sits inside a window opened on August.
    const holdsAll = { left: 0, right: 100 };
    const holdsAugust = { left: at('2026-08-01T00:00:00Z'), right: 100 };
    const inside = (bar, window) =>
      bar.left >= window.left - 1e-9 && bar.left + bar.width <= window.right + 1e-9;
    expect(drawn.map((bar) => inside(bar, holdsAll))).toEqual([true, true, true]);
    expect(drawn.map((bar) => inside(bar, holdsAugust))).toEqual([false, false, true]);

    // An hour bin is read back the same way.
    const hourly = layoutDensityBuckets(
      [{ start: '2026-08-02T14', count: 2 }],
      { from: '2026-08-02T00:00:00Z', to: '2026-08-03T00:00:00Z' },
    );
    expect(hourly[0].left).toBeCloseTo((14 / 24) * 100, 6);
    expect(hourly[0].width).toBeCloseTo((1 / 24) * 100, 6);
  });

  it('names each period under its own bar, and only as often as the labels fit', () => {
    const buckets = [
      { start: '2026-01', count: 2, first: '2026-01-14T00:00:00Z', last: '2026-01-28T00:00:00Z' },
      { start: '2026-08', count: 6, first: '2026-08-02T00:00:00Z', last: '2026-08-10T00:00:00Z' },
    ];
    const extent = { from: '2026-01-14T00:00:00Z', to: '2026-08-10T00:00:00Z' };
    const slots = densityTicks(buckets, extent, 800);

    // One slot per month the case runs through, holes included: the eight months of a
    // case with two buckets, not two labels sitting wherever the entries happen to be.
    expect(slots.map((slot) => slot.label))
      .toEqual(['Jan 2026', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug']);
    expect(slots[0].left).toBe(0);
    expect(slots.at(-1).left + slots.at(-1).width).toBeCloseTo(100, 6);

    // The outermost months are clipped to what the case holds of them, and each label
    // covers the slot it names, so it is centred over its own bar.
    const scale = densityScale(buckets, extent);
    const at = (raw) => ((new Date(raw).getTime() - scale.first) / scale.span) * 100;
    expect(slots[1].left).toBeCloseTo(at('2026-02-01T00:00:00Z'), 6);
    expect(slots.at(-1).left).toBeCloseTo(at('2026-08-01T00:00:00Z'), 6);
    expect(slots[0].anchor).toBe('start');
    expect(slots[1].anchor).toBe('middle');
    expect(slots.at(-1).anchor).toBe('end');

    // Narrow, the same scale names fewer of them rather than piling them up.
    const narrow = densityTicks(buckets, extent, 200).filter((slot) => slot.label);
    expect(narrow.length).toBeLessThan(4);
    expect(narrow[0].label).toBe('Jan 2026');
  });

  it('reads a bucket with no inner span back as the period it names', () => {
    // What a saved snapshot taken before the server reported the span answers with.
    expect(bucketSpan({ start: '2026-02' })).toEqual({
      first: Date.UTC(2026, 1, 1), last: Date.UTC(2026, 2, 1),
    });
    expect(bucketSpan({ start: 'nonsense' })).toBe(null);
  });
});

describe('reading the axis in a zone', () => {
  it('leaves UTC exactly as it was', () => {
    // the default path answers without asking Intl anything, so the stored case and
    // every existing reading of it are untouched by the switch
    expect(zoneOffset(Date.UTC(2026, 7, 11), 'UTC')).toBe(0);
    expect(zonedFields(Date.UTC(2026, 7, 11, 18, 40, 12))).toEqual({
      year: 2026, month: 8, day: 11, hour: 18, minute: 40, second: 12,
    });
    expect(windowInputValue('2026-08-11T18:40:12Z')).toBe('2026-08-11T18:40:12');
    expect(inputWindowValue('2026-08-11T18:40')).toBe('2026-08-11T18:40:00Z');
  });

  it('reads an instant as the wall clock of the chosen zone, and back', () => {
    expect(zoneOffset(Date.parse('2026-08-11T18:40:12Z'), 'Europe/Kyiv')).toBe(3 * HOUR);
    expect(windowInputValue('2026-08-11T18:40:12Z', 'Europe/Kyiv')).toBe('2026-08-11T21:40:12');
    // the boundary control holds a wall clock, so the same string means a different
    // instant in each zone
    expect(inputWindowValue('2026-08-11T21:40:12', 'Europe/Kyiv')).toBe('2026-08-11T18:40:12Z');
    expect(instantOf({ year: 2026, month: 8, day: 11, hour: 21, minute: 40, second: 12 }, 'Europe/Kyiv'))
      .toBe(Date.parse('2026-08-11T18:40:12Z'));
  });

  it('survives the two days a year the offset moves', () => {
    // 26 Oct 2026, 03:00 local goes back to 02:00 in Kyiv: an hour lived twice
    expect(zoneOffset(Date.parse('2026-10-25T00:00:00Z'), 'Europe/Kyiv')).toBe(3 * HOUR);
    expect(zoneOffset(Date.parse('2026-10-26T00:00:00Z'), 'Europe/Kyiv')).toBe(2 * HOUR);
    // 29 March, 03:00 local jumps to 04:00: the half hour asked for here never
    // happened, and it lands an hour later in the offset now in force (04:30 local)
    // rather than resolving to nothing
    const skipped = instantOf(
      { year: 2026, month: 3, day: 29, hour: 3, minute: 30, second: 0 }, 'Europe/Kyiv'
    );
    expect(new Date(skipped).toISOString()).toBe('2026-03-29T01:30:00.000Z');
    expect(zonedFields(skipped, 'Europe/Kyiv')).toMatchObject({ hour: 4, minute: 30 });
  });

  it('offers every zone the platform knows, with the offset in force', () => {
    // an investigation is rarely in the analyst's own zone, and often in no point the
    // case has saved yet, so the reading has to be choosable outright
    const zones = worldZones();
    expect(zones.length).toBeGreaterThan(100);
    // which of the two spellings this platform lists is not ours to decide
    expect(zones.some((zone) => /^Europe\/(Kyiv|Kiev)$/.test(zone))).toBe(true);
    expect(zones).toEqual([...zones].sort((one, other) => one.localeCompare(other)));
    const august = Date.parse('2026-08-11T00:00:00Z');
    expect(offsetLabel('Europe/Kyiv', august)).toBe('UTC+03:00');
    expect(offsetLabel('Asia/Kolkata', august)).toBe('UTC+05:30');
    expect(offsetLabel('America/Chicago', august)).toBe('UTC-05:00');
    expect(offsetLabel(UTC, august)).toBe('UTC');
    // and the offset follows the season rather than being the zone's standard one
    expect(offsetLabel('Europe/Kyiv', Date.parse('2026-01-11T00:00:00Z'))).toBe('UTC+02:00');
  });

  it('finds a zone by city, by region or by offset', () => {
    const august = Date.parse('2026-08-11T00:00:00Z');
    expect(zoneMatches('Europe/Kyiv', 'kyiv', august)).toBe(true);
    // and the rename must not hide the zone: this machine lists Europe/Kiev, a current
    // browser lists Europe/Kyiv, and someone working Ukraine types one of the two
    expect(zoneMatches('Europe/Kiev', 'kyiv', august)).toBe(true);
    expect(zoneMatches('Europe/Kyiv', 'kiev', august)).toBe(true);
    expect(zoneMatches('Asia/Calcutta', 'kolkata', august)).toBe(true);
    expect(zoneMatches('Asia/Ho_Chi_Minh', 'saigon', august)).toBe(true);
    expect(zoneMatches('Europe/Kyiv', 'europe', august)).toBe(true);
    expect(zoneMatches('Europe/Kyiv', '+03', august)).toBe(true);
    expect(zoneMatches('Europe/Kyiv', 'paris', august)).toBe(false);
    // nobody types an underscore
    expect(zoneMatches('America/New_York', 'new york', august)).toBe(true);
    expect(zoneWords('America/New_York')).toEqual({ place: 'New York', region: 'America' });
    expect(zoneWords('UTC')).toEqual({ place: 'UTC', region: '' });
  });

  it('puts a day tick on the zone-s own midnight, not on the UTC one', () => {
    const ticks = axisTicks('2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z', 1000, 'Europe/Kyiv');
    expect(ticks.length).toBeGreaterThanOrEqual(7);
    // Kyiv is UTC+3 in August, so local midnight is 21:00 the day before
    expect(ticks[0].at.endsWith('T21:00:00.000Z')).toBe(true);
    expect(ticks[0].label).toBe(`${Number(ticks[0].at.slice(8, 10)) + 1} Aug`);
    expect(axisBands('2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z', 1000, 'Europe/Kyiv')[0].label)
      .toMatch(/Aug 2026/);
  });

  it('keeps the ticks in the same places while the window is panned', () => {
    // a tick phase read off the window start slides under a pan, which reads as the
    // axis rewriting itself
    const first = axisTicks('2026-08-01T00:00:00Z', '2026-08-11T00:00:00Z', 1000, 'Europe/Kyiv');
    const panned = axisTicks('2026-08-02T07:00:00Z', '2026-08-12T07:00:00Z', 1000, 'Europe/Kyiv');
    const shared = first.map((tick) => tick.at).filter((at) => panned.some((tick) => tick.at === at));
    expect(shared.length).toBeGreaterThan(5);
  });
});

describe('how far apart two entries are', () => {
  const entry = (id, earliest, latest, extra = {}) => ({
    id, label: id, earliest, latest, shape: 'instant', ...extra,
  });

  it('gives one number for two exact timestamps', () => {
    const read = describePair(
      entry('a', '2026-08-11T14:28:00Z', '2026-08-11T14:28:01Z'),
      entry('b', '2026-08-11T18:40:00Z', '2026-08-11T18:40:01Z'),
    );
    expect(read.headline).toBe('4 hours 12 minutes apart');
    expect(read.detail).toBe('a first');
    expect(read.notes).toEqual([]);
  });

  it('brackets the gap when either side is only dated to the day', () => {
    // 12 May and 15 May are not three days apart: they are between two and four,
    // and printing the difference of two midnights as a fact invents precision
    const read = describePair(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z', { precision: 'day' }),
      entry('b', '2026-05-15T00:00:00Z', '2026-05-16T00:00:00Z', { precision: 'day' }),
    );
    expect(read.headline).toBe('Between 2 and 4 days apart');
    expect(read.notes[0]).toBe('As written, 3 days apart.');
    expect(read.notes).toContain('a is dated to the day.');
    const pair = compareTimelineItems(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z'),
      entry('b', '2026-05-15T00:00:00Z', '2026-05-16T00:00:00Z'),
    );
    expect(pair.gap).toMatchObject({ min: 2 * DAY, max: 4 * DAY, stated: 3 * DAY, exact: false });
  });

  it('measures two exact periods end to start, with no invented uncertainty', () => {
    // an interval's bounds are its stated extent, not a window of ignorance: these
    // two are two hours apart, and answering "between 2 h and 12 h" would be the
    // manufactured vagueness the bracketing exists to avoid
    const read = describePair(
      entry('a', '2026-05-12T08:00:00Z', '2026-05-12T14:00:00Z', { shape: 'interval' }),
      entry('b', '2026-05-12T16:00:00Z', '2026-05-12T20:00:00Z', { shape: 'interval' }),
    );
    expect(read.headline).toBe('2 hours apart');
    expect(read.detail).toBe('a first');
    expect(read.notes).toEqual(['a runs for 6 hours.', 'b runs for 4 hours.']);
  });

  it('carries a coarse point-s slack into the gap beside an exact period', () => {
    const read = describePair(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z', { precision: 'day' }),
      entry('b', '2026-05-15T08:00:00Z', '2026-05-15T14:00:00Z', { shape: 'interval' }),
    );
    // the day could be any moment of 12 May, so the gap runs from 2 d 8 h to 3 d 8 h
    expect(read.headline).toBe('Between 2 days 8 hours and 3 days 8 hours apart');
  });

  it('reads two consecutive days as a gap that may be nothing at all', () => {
    const read = describePair(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z', { precision: 'day' }),
      entry('b', '2026-05-13T00:00:00Z', '2026-05-14T00:00:00Z', { precision: 'day' }),
    );
    expect(read.headline).toBe('Up to 2 days apart');
  });

  it('refuses to order a pair whose windows overlap, and says how much', () => {
    const read = describePair(
      entry('a', '2026-05-12T08:00:00Z', '2026-05-12T14:00:00Z', { shape: 'interval' }),
      entry('b', '2026-05-12T12:00:00Z', '2026-05-12T20:00:00Z', { shape: 'interval' }),
    );
    expect(read.headline).toBe('Overlapping by 2 hours');
    expect(read.detail).toContain('Either could come first');
    expect(read.notes).toContain('a runs for 6 hours.');
  });

  it('tells a period that lasts from a point that is merely vague', () => {
    expect(itemExtent(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-15T00:00:00Z', { shape: 'interval' })
    )).toMatchObject({ kind: 'duration', ms: 3 * DAY });
    expect(itemExtent(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z', { precision: 'day' })
    )).toMatchObject({ kind: 'precision', ms: DAY });
    // an exact timestamp carries a one-second window, which is a point
    expect(itemExtent(entry('a', '2026-05-12T10:00:00Z', '2026-05-12T10:00:01Z'))).toBeNull();
  });

  it('measures nothing against an entry the axis cannot place', () => {
    const read = describePair(
      entry('a', '2026-05-12T00:00:00Z', '2026-05-13T00:00:00Z'),
      { id: 'b', label: 'b', earliest: null, latest: null, raw: '2026-05-14T10:00:00' },
    );
    expect(read.ok).toBe(false);
    expect(read.detail).toContain('no place on the UTC axis');
  });

  it('phrases a range like a sentence, and a floor of nothing as a ceiling', () => {
    // "between 0 and 4 days" invites the reader to average it; two consecutive dates
    // license "up to 4 days" and nothing more
    expect(formatSpanRange(2 * DAY, 4 * DAY)).toBe('between 2 and 4 days');
    expect(formatSpanRange(DAY, 4 * DAY)).toBe('between 1 and 4 days');
    expect(formatSpanRange(0, 2 * DAY)).toBe('up to 2 days');
    expect(formatSpanRange(2 * DAY + 8 * HOUR, 3 * DAY + 8 * HOUR))
      .toBe('between 2 days 8 hours and 3 days 8 hours');
  });

  it('names a length to two units', () => {
    expect(formatSpan(0)).toBe('under a second');
    expect(formatSpan(90 * 1000)).toBe('1 minute 30 seconds');
    expect(formatSpan(2 * DAY + 6 * HOUR)).toBe('2 days 6 hours');
    expect(formatSpan(400 * DAY)).toBe('1 year 34 days');
  });
});

describe('the window, as one reading', () => {
  it('states the hours only when the window is short enough to be about them', () => {
    expect(windowWords('2026-08-23T20:49:00Z', '2026-10-01T10:12:00Z')).toBe('23 Aug – 1 Oct 2026');
    expect(windowWords('2026-12-30T00:00:00Z', '2027-01-02T00:00:00Z')).toBe('30 Dec 2026 – 2 Jan 2027');
    expect(windowWords('2026-08-23T20:49:00Z', '2026-08-24T06:00:00Z'))
      .toBe('23 Aug 20:49 – 24 Aug 06:00');
    expect(windowWords('2026-08-23T20:49:00Z', '2026-08-23T23:10:00Z'))
      .toBe('23 Aug 2026, 20:49 – 23:10');
    expect(windowWords('', '')).toBe('All dates');
  });

  it('reads the boundaries on the clock the axis is drawn in', () => {
    expect(windowWords('2026-08-23T20:49:00Z', '2026-08-23T23:10:00Z', 'Asia/Tokyo'))
      .toBe('24 Aug 2026, 05:49 – 08:10');
  });

  it('resizes to a named span around the middle of the window', () => {
    const window = resizeWindow('2026-08-23T00:00:00Z', '2026-08-24T00:00:00Z', 2 * 60 * 60 * 1000);
    expect(window).toEqual({ from: '2026-08-23T11:00:00Z', to: '2026-08-23T13:00:00Z' });
    expect(WINDOW_SPANS.map((span) => span.label))
      .toEqual(['Hour', 'Day', 'Week', 'Month', 'Year']);
    // nothing to resize without a window, and nothing invented either
    expect(resizeWindow('', '', 1000)).toEqual({ from: '', to: '' });
  });
});
