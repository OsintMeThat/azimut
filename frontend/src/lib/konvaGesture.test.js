import { describe, expect, it, vi } from 'vitest';
import { closeStrandedGesture } from './konvaGesture.js';

/** Konva's transformer, reduced to the two calls the gesture close makes. */
function fakeTransformer(transforming) {
  return {
    isTransforming: () => transforming,
    stopTransform: vi.fn(function () {
      transforming = false;
    }),
  };
}

/** A stage whose `find` answers a predicate, the way Konva's does. */
function fakeStage(nodes) {
  return { find: (match) => nodes.filter(match) };
}

function fakeNode(dragging) {
  return {
    isDragging: () => dragging,
    stopDrag: vi.fn(function () {
      dragging = false;
    }),
  };
}

describe('closeStrandedGesture', () => {
  it('leaves a settled gesture alone', () => {
    const transformer = fakeTransformer(false);
    const node = fakeNode(false);
    const closed = closeStrandedGesture({
      transformer,
      stage: fakeStage([node]),
      isDragging: () => false,
    });
    expect(closed).toBe(false);
    expect(transformer.stopTransform).not.toHaveBeenCalled();
    expect(node.stopDrag).not.toHaveBeenCalled();
  });

  it('ends a resize the release never closed', () => {
    // Konva ends a corner-resize on a window mouseup and on nothing else. Left
    // running, it resizes the panel under a pointer with no button held and
    // never commits the scale.
    const transformer = fakeTransformer(true);
    const closed = closeStrandedGesture({
      transformer,
      stage: fakeStage([]),
      isDragging: () => false,
    });
    expect(closed).toBe(true);
    expect(transformer.stopTransform).toHaveBeenCalledTimes(1);
  });

  it('ends a stranded drag, and only the nodes still dragging', () => {
    const dragged = fakeNode(true);
    const settled = fakeNode(false);
    const closed = closeStrandedGesture({
      transformer: fakeTransformer(false),
      stage: fakeStage([settled, dragged]),
      isDragging: () => true,
    });
    expect(closed).toBe(true);
    expect(dragged.stopDrag).toHaveBeenCalledTimes(1);
    expect(settled.stopDrag).not.toHaveBeenCalled();
  });

  it('does not walk the document when nothing is being dragged', () => {
    // The close runs on every release, and a proof holds a node per annotation.
    const find = vi.fn(() => []);
    closeStrandedGesture({
      transformer: fakeTransformer(false),
      stage: { find },
      isDragging: () => false,
    });
    expect(find).not.toHaveBeenCalled();
  });

  it('survives a canvas that has no transformer yet', () => {
    expect(() =>
      closeStrandedGesture({ transformer: null, stage: fakeStage([]), isDragging: () => false })
    ).not.toThrow();
  });
});
