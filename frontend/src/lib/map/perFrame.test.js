import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { perFrame } from './perFrame.js';

let frames;
beforeEach(() => {
  frames = [];
  vi.stubGlobal('requestAnimationFrame', (run) => frames.push(run));
  vi.stubGlobal('cancelAnimationFrame', (id) => { frames[id - 1] = null; });
});
afterEach(() => vi.unstubAllGlobals());
const nextFrame = () => { const due = frames; frames = []; due.forEach((run) => run?.()); };

describe('once a frame at most', () => {
  it('runs the first at once and only the newest of the rest, at the next frame', () => {
    const run = vi.fn();
    const call = perFrame(run);
    call(1); call(2); call(3);
    expect(run.mock.calls).toEqual([[1]]);
    nextFrame();
    expect(run.mock.calls).toEqual([[1], [3]]);
    nextFrame();
    expect(run).toHaveBeenCalledTimes(2);
    // a quiet frame later, the next is at once again
    call(4);
    expect(run).toHaveBeenLastCalledWith(4);
  });

  it('runs what waits when let go, and drops it when cancelled', () => {
    const run = vi.fn();
    const call = perFrame(run);
    call(1); call(2);
    call.flush();
    expect(run.mock.calls).toEqual([[1], [2]]);
    call.flush();
    expect(run).toHaveBeenCalledTimes(2);
    call(3);
    call.cancel();
    nextFrame();
    expect(run).toHaveBeenCalledTimes(2);
  });
});
