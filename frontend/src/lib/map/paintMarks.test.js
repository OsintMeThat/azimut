// @vitest-environment happy-dom
/**
 * The case's marks painted onto a capture taken with its layers (`paintMarks.js`).
 *
 * What is asserted is where each mark lands on the picture and in which look: the
 * page draws them as its own elements, so the map's canvas holds none of them, and a
 * capture missing them, or holding them a few pixels off, would be a different map.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

const painted = [];
vi.mock('../mapMarkers.js', async (original) => {
  const real = await original();
  const note = (kind) => (ctx, x, y, look) => painted.push({ kind, x, y, ...look });
  return {
    ...real,
    paintPlaceDrop: note('place'),
    paintLeadDrop: note('lead'),
    paintTeardrop: note('teardrop'),
    paintName: (ctx, x, y, text, look) => painted.push({ kind: 'name', x, y, text, ...look }),
  };
});

const { paintCaseMarks, resolvePaint } = await import('./paintMarks.js');

beforeAll(() => {
  document.documentElement.style.setProperty('--anno-3', '#4a93cc');
});

/** One degree is one CSS pixel, so the tests state pixels. */
const project = ({ lat, lon }) => ({ x: lon, y: lat });
const RECT = { x: 100, y: 100, w: 200, h: 100 };

function paint(options) {
  painted.length = 0;
  paintCaseMarks({}, { project, rect: RECT, scale: 2, zoom: 18, ...options });
  return painted;
}

const place = (id, lat, lon, extra = {}) => ({ id, key: id, kind: 'place', title: id, lat, lon, ...extra });

describe('the case’s marks on a capture', () => {
  it('paints each place on its point, in the frame’s pixels at the picture’s scale, in its colour', () => {
    const [mark] = paint({ saved: [place('Depot', 150, 120, { color: '#00aa00' })] });
    expect(mark).toMatchObject({ kind: 'place', x: 40, y: 100, colour: '#00aa00', count: 1, scale: 2 });
  });

  it('leaves out a mark whose point is far outside the frame, and keeps one whose drop reaches in', () => {
    const marks = paint({ saved: [place('far', 150, 900), place('edge', 220, 150)] });
    expect(marks.map((mark) => mark.kind === 'place' && mark.x)).toEqual([100]);
  });

  it('groups the marks as the map does at this zoom, counting a stack', () => {
    const [mark] = paint({ saved: [place('a', 150, 120), place('b', 150, 120)] });
    expect(mark).toMatchObject({ kind: 'place', count: 2 });
  });

  it('paints a placed file as its teardrop, ringed in white', () => {
    const [mark] = paint({ saved: [{ id: 'm', key: 'm', kind: 'media', media_kind: 'video', lat: 150, lon: 150 }] });
    expect(mark).toMatchObject({ kind: 'teardrop', ring: '#fff', count: 1 });
    expect(mark.glyph).toBeTruthy();
  });

  it('writes each place’s name only when the Names switch is on', () => {
    expect(paint({ saved: [place('Depot', 150, 120)] }).some((mark) => mark.kind === 'name')).toBe(false);
    const named = paint({ saved: [place('Depot', 150, 120)], names: true }).find((mark) => mark.kind === 'name');
    expect(named).toMatchObject({ text: 'Depot', x: 40, y: 100 });
  });

  it('paints the scene’s leads over the rest, numbered, in its colour read off the page', () => {
    const marks = paint({ saved: [place('Depot', 150, 120)], leads: [{ id: 'l', n: 2, lat: 160, lon: 130 }], leadColour: 'var(--anno-3)' });
    expect(marks.at(-1)).toMatchObject({ kind: 'lead', n: 2, x: 60, y: 120, colour: '#4a93cc' });
  });

  it('skips a point the screen shows nowhere, as one behind the relief', () => {
    expect(paint({ saved: [place('Hidden', 150, 120)], project: () => null })).toEqual([]);
  });
});

describe('a colour as the canvas paints it', () => {
  it('reads a theme variable off the page, and leaves a code as it is', () => {
    expect(resolvePaint('var(--anno-3)')).toBe('#4a93cc');
    expect(resolvePaint('#123456')).toBe('#123456');
    expect(resolvePaint('var(--nothing-here)')).toBe('#e5484d');
  });
});
