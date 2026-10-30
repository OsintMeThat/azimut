import { describe, expect, it, vi } from 'vitest';
import { cornerHandles, ghostHandles, HANDLE } from './handles.js';

describe('the corners of a finished line', () => {
  it('are draggable marks that report which corner moved and where', () => {
    const onMove = vi.fn();
    const onDrop = vi.fn();
    const shapes = cornerHandles([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], { prefix: 'line', onMove, onDrop });
    expect(shapes.map((shape) => shape.id)).toEqual(['line-0', 'line-1']);
    expect(shapes.every((shape) => shape.kind === 'marker' && shape.draggable)).toBe(true);
    expect(shapes[0].className).toBe(HANDLE.className);
    shapes[1].onDrag({ lat: 5, lon: 6 });
    shapes[1].onDragEnd();
    expect(onMove).toHaveBeenCalledWith(1, { lat: 5, lon: 6 });
    expect(onDrop).toHaveBeenCalledWith(1);
  });

  it('name the ends of a line whose direction matters A and B', () => {
    const shapes = cornerHandles([{ lat: 1, lon: 2 }, { lat: 3, lon: 4 }], { prefix: 'p', onMove() {}, ends: true });
    expect(shapes.map((shape) => shape.html)).toEqual(['<span>A</span>', '<span>B</span>']);
    expect(shapes[0].className).toBe(`${HANDLE.className} named`);
  });
});

describe('the dots halfway along each leg', () => {
  const points = [{ lat: 0, lon: 0 }, { lat: 0, lon: 2 }, { lat: 2, lon: 2 }];

  it('sit halfway along each leg, and along the leg back to the start of an area', () => {
    expect(ghostHandles(points, { prefix: 'g', onInsert() {}, onMove() {} }).map((s) => s.at)).toEqual([
      { lat: 0, lon: 1 },
      { lat: expect.closeTo(1, 3), lon: 2 },
    ]);
    expect(ghostHandles(points, { prefix: 'g', closed: true, onInsert() {}, onMove() {} })).toHaveLength(3);
  });

  it('become a corner on their first move, and only then', () => {
    const onInsert = vi.fn(() => 2);
    const onMove = vi.fn();
    const onDrop = vi.fn();
    const [, second] = ghostHandles(points, { prefix: 'g', onInsert, onMove, onDrop });
    second.onDragStart();
    second.onDragEnd();
    expect(onInsert).not.toHaveBeenCalled();
    expect(onDrop).not.toHaveBeenCalled();
    second.onDragStart();
    second.onDrag({ lat: 1, lon: 3 });
    second.onDrag({ lat: 1.5, lon: 3 });
    second.onDragEnd();
    expect(onInsert).toHaveBeenCalledTimes(1);
    expect(onInsert).toHaveBeenCalledWith(1, { lat: 1, lon: 3 });
    expect(onMove).toHaveBeenLastCalledWith(2, { lat: 1.5, lon: 3 });
    expect(onDrop).toHaveBeenCalledWith(2);
  });
});
