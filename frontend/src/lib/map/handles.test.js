import { describe, expect, it, vi } from 'vitest';
import { cornerHandles, HANDLE } from './handles.js';

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

  it('take the colour of the line they belong to', () => {
    const [shape] = cornerHandles([{ lat: 1, lon: 2 }], { prefix: 'p', onMove() {}, tone: 'ground' });
    expect(shape.className).toBe(`${HANDLE.className} ground`);
  });
});
