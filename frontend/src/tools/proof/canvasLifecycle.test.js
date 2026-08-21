import { describe, expect, it } from 'vitest';
import { createCanvasRenderGate } from './canvasLifecycle.js';

describe('createCanvasRenderGate', () => {
  /** Runs the scheduled callback by hand, standing in for the frame. */
  function gateHarness() {
    const calls = { rebuild: 0, refreshUi: 0 };
    let pending = null;
    const gate = createCanvasRenderGate(
      (fn) => {
        pending = fn;
        return 1;
      },
      () => {
        pending = null;
      },
      {
        rebuild: () => { calls.rebuild += 1; },
        refreshUi: () => { calls.refreshUi += 1; },
      },
    );
    return { gate, calls, frame: () => { const fn = pending; pending = null; fn?.(); } };
  }

  it('holds a rebuild until the gesture settles', () => {
    const { gate, calls, frame } = gateHarness();
    gate.beginPointer();
    gate.requestRebuild();
    frame();
    expect(calls.rebuild).toBe(0);

    gate.endPointer();
    frame();
    expect(calls.rebuild).toBe(1);
  });

  it('folds a pending ui refresh into the rebuild that supersedes it', () => {
    const { gate, calls, frame } = gateHarness();
    gate.requestUi();
    gate.requestRebuild();
    frame();
    expect(calls).toEqual({ rebuild: 1, refreshUi: 0 });
  });

  it('refreshes the ui on its own when no rebuild is due', () => {
    const { gate, calls, frame } = gateHarness();
    gate.requestUi();
    frame();
    expect(calls).toEqual({ rebuild: 0, refreshUi: 1 });
  });

  it('keeps a request made during a gesture that its frame arrived inside of', () => {
    const { gate, calls, frame } = gateHarness();
    gate.requestRebuild();
    gate.beginPointer(); // the press lands before the frame does
    frame();
    expect(calls.rebuild).toBe(0);

    gate.endPointer();
    frame();
    expect(calls.rebuild).toBe(1);
  });
});
