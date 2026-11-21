import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SUPPORT_BEAT_MINUTES, startSupportBeat } from './supportBeat.js';

const MINUTE = 60_000;

/** A document whose visibility the test turns, as a tab put behind another would. */
function fakeDoc() {
  const listeners = new Set();
  return {
    visibilityState: 'visible',
    addEventListener: (type, fn) => type === 'visibilitychange' && listeners.add(fn),
    removeEventListener: (type, fn) => listeners.delete(fn),
    turn(state) {
      this.visibilityState = state;
      for (const fn of listeners) fn();
    },
    get listening() {
      return listeners.size;
    },
  };
}

let stop = null;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

describe('the Support heartbeat', () => {
  it('waits ten minutes, not a beat at start', () => {
    expect(SUPPORT_BEAT_MINUTES).toBe(10);
    const beat = vi.fn();
    stop = startSupportBeat({ beat, doc: fakeDoc() });
    vi.advanceTimersByTime(10 * MINUTE - 1);
    expect(beat).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(beat).toHaveBeenCalledOnce();
  });

  it('beats again every ten minutes', () => {
    const beat = vi.fn();
    stop = startSupportBeat({ beat, doc: fakeDoc() });
    vi.advanceTimersByTime(30 * MINUTE);
    expect(beat).toHaveBeenCalledTimes(3);
  });

  it('does not count the time spent in another tab', () => {
    const beat = vi.fn();
    const doc = fakeDoc();
    stop = startSupportBeat({ beat, doc });
    vi.advanceTimersByTime(6 * MINUTE);
    doc.turn('hidden');
    vi.advanceTimersByTime(60 * MINUTE);
    expect(beat).not.toHaveBeenCalled();
    doc.turn('visible');
    vi.advanceTimersByTime(4 * MINUTE - 1);
    expect(beat).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(beat).toHaveBeenCalledOnce();
  });

  it('starts counting only once a hidden page is shown', () => {
    const beat = vi.fn();
    const doc = fakeDoc();
    doc.visibilityState = 'hidden';
    stop = startSupportBeat({ beat, doc });
    vi.advanceTimersByTime(30 * MINUTE);
    expect(beat).not.toHaveBeenCalled();
    doc.turn('visible');
    vi.advanceTimersByTime(10 * MINUTE);
    expect(beat).toHaveBeenCalledOnce();
  });

  it('stops for good, and lets go of the page', () => {
    const beat = vi.fn();
    const doc = fakeDoc();
    stop = startSupportBeat({ beat, doc });
    expect(doc.listening).toBe(1);
    stop();
    stop = null;
    expect(doc.listening).toBe(0);
    vi.advanceTimersByTime(60 * MINUTE);
    doc.turn('hidden');
    doc.turn('visible');
    vi.advanceTimersByTime(60 * MINUTE);
    expect(beat).not.toHaveBeenCalled();
  });
});
