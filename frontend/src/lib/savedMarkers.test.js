import { describe, expect, it } from 'vitest';
import { groupSavedMarkers, keptLabel, markKind, markLook, markName, markerPrecision, NAME_ROOM, pairLabel, stackOrder } from './savedMarkers.js';
import { PLACE_RED } from './mapMarkers.js';

const at = (id, lat, lon, extra = {}) => ({ id, kind: 'capture', lat, lon, ...extra });

describe('groupSavedMarkers', () => {
  it('collapses items saved at the same spot into one mark', () => {
    const marks = groupSavedMarkers([
      at('a', 48.015912, 37.802901),
      at('b', 48.015913, 37.802899), // same metre
    ]);

    expect(marks).toHaveLength(1);
    expect(marks[0].items.map((i) => i.id)).toEqual(['a', 'b']);
  });

  it('keeps distinct spots apart', () => {
    expect(groupSavedMarkers([at('a', 48.0159, 37.8029), at('b', 48.02, 37.81)])).toHaveLength(2);
  });

  it('places a mark on its first item, not on the rounded key', () => {
    const [mark] = groupSavedMarkers([at('a', 48.015912, 37.802901)], 2);

    expect(mark.lat).toBe(48.015912);
    expect(mark.lon).toBe(37.802901);
  });

  it('leaves out rows with no coordinates', () => {
    const marks = groupSavedMarkers([
      at('a', 48.0159, 37.8029),
      at('b', null, null),
      at('c', undefined, undefined),
    ]);

    expect(marks).toHaveLength(1);
    expect(marks[0].items.map((i) => i.id)).toEqual(['a']);
  });

  it('reports every kind stacked on one mark', () => {
    const marks = groupSavedMarkers([
      at('a', 48.0159, 37.8029, { kind: 'place' }),
      at('b', 48.0159, 37.8029, { kind: 'capture' }),
      at('c', 48.0159, 37.8029, { kind: 'capture' }),
    ]);

    expect(marks[0].kinds).toEqual(['place', 'capture']);
    expect(marks[0].items).toHaveLength(3);
  });

  it('merges more coarsely at a lower precision', () => {
    const rows = [at('a', 48.0159, 37.8029), at('b', 48.4, 37.9)];

    expect(groupSavedMarkers(rows, 5)).toHaveLength(2);
    expect(groupSavedMarkers(rows, 0)).toHaveLength(1);
  });

  it('handles an empty or missing list', () => {
    expect(groupSavedMarkers([])).toEqual([]);
    expect(groupSavedMarkers()).toEqual([]);
  });
});

describe('markerPrecision', () => {
  it('merges only the same spot at street zoom, and whole regions at world zoom', () => {
    expect(markerPrecision(18)).toBe(5);
    expect(markerPrecision(16)).toBe(5);
    expect(markerPrecision(12)).toBe(3);
    expect(markerPrecision(6)).toBe(1);
    expect(markerPrecision(3)).toBe(0);
  });

  it('falls back to same-spot grouping when the zoom is unknown', () => {
    expect(markerPrecision(undefined)).toBe(5);
    expect(markerPrecision(NaN)).toBe(5);
  });
});

describe('stackOrder', () => {
  it('reads as a timeline of the ground, newest imagery first', () => {
    const ordered = stackOrder([
      { id: 'a', imagery_date: '2021-06' },
      { id: 'b', imagery_date: '2024-03' },
      { id: 'c', imagery_date: '2023-01' },
    ]);

    expect(ordered.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });

  it('dates a comparison by its later picture, an estimate included', () => {
    const ordered = stackOrder([
      { id: 'a', imagery_date: '2024-03' },
      { id: 'cmp', kind: 'comparison', imagery_a: '2020-01-01~', imagery_b: '2025-06-01~' },
    ]);

    expect(ordered.map((i) => i.id)).toEqual(['cmp', 'a']);
  });

  it('sends undated items to the end, newest save first', () => {
    const ordered = stackOrder([
      { id: 'a', fetched_at: '2026-01-01T00:00:00Z' },
      { id: 'b', imagery_date: '2024-03' },
      { id: 'c', fetched_at: '2026-05-01T00:00:00Z' },
    ]);

    expect(ordered.map((i) => i.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('a comparison row', () => {
  it('writes its two pictures, an undated one said as such', () => {
    expect(pairLabel({ imagery_a: '2024-05-03~', imagery_b: '2026-09-02' })).toBe('2024-05-03~ → 2026-09-02');
    expect(pairLabel({ imagery_b: '2026-09-02' })).toBe('undated → 2026-09-02');
    expect(pairLabel({ kind: 'capture' })).toBe('');
  });

  it('counts the images kept from it', () => {
    expect(keptLabel({ kept: [{}, {}] })).toBe('2 images kept');
    expect(keptLabel({ kept: [{}] })).toBe('1 image kept');
    expect(keptLabel({ kept: [] })).toBe('');
  });
});

describe('markKind', () => {
  it('draws one kind as itself', () => {
    expect(markKind(['comparison'])).toBe('comparison');
    expect(markKind(['place'])).toBe('place');
  });

  it('draws a stack of imagery as a capture, however it was made', () => {
    // zoomed out, three captures and a comparison nearby merge into one mark
    expect(markKind(['capture', 'comparison'])).toBe('capture');
    expect(markKind(['capture', 'screenshot', 'comparison'])).toBe('capture');
  });

  it('draws a stack holding a place as the place', () => {
    expect(markKind(['capture', 'place'])).toBe('place');
  });
});

describe('how a mark is drawn', () => {
  const mark = (items) => groupSavedMarkers(items)[0];
  const place = (id, extra = {}) => ({ id, kind: 'place', title: id, lat: 1, lon: 2, ...extra });

  it('draws a place in its own colour, the pin red without one', () => {
    expect(markLook(mark([place('a', { color: '#1f77b4' })]))).toMatchObject({ kind: 'place', glyph: 'pin', colour: '#1f77b4', count: 1 });
    expect(markLook(mark([place('a')])).colour).toBe(PLACE_RED);
  });

  it('draws a stack of places in its first place’s colour, the newest saved', () => {
    const look = markLook(mark([place('new', { color: '#00aa00' }), place('old', { color: '#0000aa' })]));
    expect(look).toMatchObject({ kind: 'place', colour: '#00aa00', count: 2 });
  });

  it('draws files as footage only when all of it is footage, and gives them no colour', () => {
    const video = { id: 'v', kind: 'media', media_kind: 'video', lat: 1, lon: 2 };
    const photo = { id: 'p', kind: 'media', media_kind: 'image', lat: 1, lon: 2 };
    expect(markLook(mark([video]))).toMatchObject({ kind: 'media', glyph: 'video', colour: null });
    expect(markLook(mark([video, photo])).glyph).toBe('image');
  });

  it('draws a stack of imagery as a capture, and marks a point a proof stands on', () => {
    const look = markLook(mark([at('c', 1, 2), at('d', 1, 2, { kind: 'comparison', proofs: 1 })]));
    expect(look).toMatchObject({ kind: 'capture', glyph: 'satellite', worked: true });
  });
});

describe('the name written under a mark', () => {
  const mark = (items) => groupSavedMarkers(items)[0];
  const place = (title) => ({ id: title, kind: 'place', title, lat: 1, lon: 2 });

  it('is its place’s title, cut with an ellipsis past the room it has', () => {
    expect(markName(mark([place('North depot')]))).toBe('North depot');
    const long = markName(mark([place('The old grain silo by the northern railway yard')])).normalize();
    expect([...long]).toHaveLength(NAME_ROOM);
    expect(long.endsWith('…')).toBe(true);
  });

  it('counts a stack of places, and names nothing that is not a place', () => {
    expect(markName(mark([place('A'), place('B'), place('C')]))).toBe('3 places');
    expect(markName(mark([{ id: 'm', kind: 'media', lat: 1, lon: 2 }]))).toBe('');
    expect(markName(mark([place('Gate'), { id: 'm', kind: 'media', lat: 1, lon: 2 }]))).toBe('Gate');
  });
});
