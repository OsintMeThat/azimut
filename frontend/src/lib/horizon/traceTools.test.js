/** The tools a trace is edited with: one out at a time, the same keys and words wherever the photo is. */
import { describe, expect, it, vi } from 'vitest';
import {
  detailsShown,
  detailsTitle,
  editing,
  marksSummary,
  pressTool,
  putAway,
  TRACE_TOOLS,
  toolBlocked,
  toolForKey,
  toolHint,
  toolOn,
  traceLegend,
} from './traceTools.js';

function fakeOverlay(over = {}) {
  return {
    tracing: false,
    erasing: false,
    linking: false,
    cutting: false,
    distancing: false,
    clearing: false,
    pen: 'sky',
    magnet: true,
    front: null,
    strokes: [[], []],
    setTracing: vi.fn(),
    setErasing: vi.fn(),
    setLinking: vi.fn(),
    setCutting: vi.fn(),
    setDistancing: vi.fn(),
    setClearing: vi.fn(),
    setPen: vi.fn(),
    ...over,
  };
}

describe('the trace tools', () => {
  it('have a key each, none taken twice', () => {
    const keys = TRACE_TOOLS.map((tool) => tool.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(toolForKey('r')).toBe('ridge');
    expect(toolForKey('X')).toBe('cut');
    expect(toolForKey('o')).toBe('clear');
    expect(toolForKey('q')).toBeNull();
  });

  it('say which one is out, a pen by its kind', () => {
    const overlay = fakeOverlay({ tracing: true, pen: 'ridge' });
    expect(toolOn(overlay, 'ridge')).toBe(true);
    expect(toolOn(overlay, 'sky')).toBe(false);
    expect(editing(overlay)).toBe(true);
    expect(editing(fakeOverlay())).toBe(false);
  });

  it('come out on a press and go away on the next', () => {
    const idle = fakeOverlay();
    pressTool(idle, 'ridge');
    expect(idle.setPen).toHaveBeenCalledWith('ridge');
    const drawing = fakeOverlay({ tracing: true, pen: 'ridge' });
    pressTool(drawing, 'ridge');
    expect(drawing.setTracing).toHaveBeenCalledWith(false);
    pressTool(idle, 'behind');
    expect(idle.setLinking).toHaveBeenCalledWith(true);
    pressTool(idle, 'cut');
    expect(idle.setCutting).toHaveBeenCalledWith(true);
    pressTool(idle, 'far');
    expect(idle.setDistancing).toHaveBeenCalledWith(true);
    pressTool(fakeOverlay({ distancing: true, setDistancing: idle.setDistancing }), 'far');
    expect(idle.setDistancing).toHaveBeenLastCalledWith(false);
    pressTool(idle, 'clear');
    expect(idle.setClearing).toHaveBeenCalledWith(true);
    expect(toolOn(fakeOverlay({ clearing: true }), 'clear')).toBe(true);
    expect(editing(fakeOverlay({ clearing: true }))).toBe(true);
    putAway(drawing);
    expect(drawing.setLinking).toHaveBeenCalledWith(false);
    expect(drawing.setCutting).toHaveBeenCalledWith(false);
    expect(drawing.setDistancing).toHaveBeenCalledWith(false);
    expect(drawing.setClearing).toHaveBeenCalledWith(false);
  });

  it('say why one cannot come out yet', () => {
    expect(toolBlocked(fakeOverlay({ strokes: [[]] }), 'behind')).toBe('Draw two lines first');
    expect(toolBlocked(fakeOverlay({ strokes: [] }), 'erase')).toBe('Nothing to rub out yet');
    expect(toolBlocked(fakeOverlay(), 'cut')).toBe('');
    expect(toolBlocked(fakeOverlay({ strokes: [] }), 'far')).toBe('Draw a line first');
    expect(toolBlocked(fakeOverlay({ strokes: [] }), 'clear')).toBe('Draw a line first');
  });

  it('say what the one out asks for, and what the trace holds', () => {
    expect(toolHint(fakeOverlay({ linking: true }))).toMatch(/^Click the line in front/);
    expect(toolHint(fakeOverlay({ linking: true, front: 3 }))).toMatch(/^Now click the line behind it/);
    expect(toolHint(fakeOverlay({ cutting: true }))).toMatch(/where two frames of the collage meet/);
    expect(toolHint(fakeOverlay({ distancing: true }))).toBe('Pick how far, then click a line · the same again takes it away');
    expect(toolHint(fakeOverlay({ clearing: true }))).toMatch(/^Click a skyline line with only sky above it/);
    expect(toolHint(fakeOverlay({ tracing: true, pen: 'ridge', magnet: false }))).toMatch(/ridge seen against farther land · drawn as is/);
    expect(toolHint(fakeOverlay())).toBe('');
    expect(marksSummary({ lines: [0, 1, 2], inner: [1, 2], pairs: [[1, 0]], cuts: [0.5] })).toBe('2 ridges · 1 pair · 2 pieces');
    expect(marksSummary({ lines: [0], inner: [], pairs: [], cuts: [] })).toBe('');
    expect(marksSummary({ lines: [0, 1], inner: [], pairs: [], cuts: [], far: [{ line: 0, bands: ['b1'] }] })).toBe('1 distance');
    expect(marksSummary({ lines: [0, 1], inner: [], pairs: [], cuts: [], clear: [0, 1] })).toBe('2 lines with only sky above');
  });
});

describe('the trace as it reads over the photo', () => {
  const marks = { lines: [0, 1, 2], inner: [1], pairs: [[1, 0]], cuts: [0.4] };

  it('keeps its details for when they are asked for or a tool is out', () => {
    expect(detailsShown(fakeOverlay())).toBe(false);
    expect(detailsShown(fakeOverlay({ details: true }))).toBe(true);
    expect(detailsShown(fakeOverlay({ cutting: true }))).toBe(true);
    expect(detailsTitle(false)).toMatch(/^Show .*\(D\)$/);
    expect(detailsTitle(true)).toMatch(/^Hide /);
  });

  it('names its colours and the terrain’s line, then the details while they show', () => {
    const plain = traceLegend(fakeOverlay({ marks: { lines: [0], inner: [], pairs: [], cuts: [] } }));
    expect(plain.map((item) => item.id)).toEqual(['trace']);
    const read = traceLegend(fakeOverlay({ marks }), { coloured: true, terrain: true });
    expect(read.map((item) => item.id)).toEqual(['on', 'near', 'off', 'ridge', 'terrain']);
    const detailed = traceLegend(fakeOverlay({ marks, details: true }), { coloured: true, terrain: true });
    expect(detailed.map((item) => item.id)).toEqual(['on', 'near', 'off', 'ridge', 'terrain', 'margin', 'cut', 'pair']);
    const sure = traceLegend(fakeOverlay({ marks: { ...marks, clear: [0] }, details: true }));
    expect(sure.at(-1)).toEqual({ id: 'clear', label: 'Only sky above' });
    const lined = traceLegend(fakeOverlay({ marks }), { coloured: true, ridgeLines: true, level: true });
    expect(lined.slice(-2)).toEqual([
      { id: 'ridge-lines', label: 'Terrain ridges' },
      { id: 'level', label: 'Eye level' },
    ]);
    // no terrain drawn, no margin named
    expect(traceLegend(fakeOverlay({ marks, details: true })).map((item) => item.id)).toEqual(['trace', 'ridge', 'cut', 'pair']);
  });
});
