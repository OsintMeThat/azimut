import { describe, expect, it, vi } from 'vitest';
import { repeatPress, stepped } from './repeatPress.js';

describe('a press that repeats while held', () => {
  it('acts at once, then again and again after a pause, until let go', () => {
    vi.useFakeTimers();
    try {
      const act = vi.fn();
      const press = repeatPress(act, { delay: 400, every: 70 });
      press.start({ button: 0, shiftKey: true, preventDefault() {} });
      expect(act).toHaveBeenCalledTimes(1);
      expect(act).toHaveBeenLastCalledWith(true);
      vi.advanceTimersByTime(399);
      expect(act).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(1 + 70 * 2);
      expect(act).toHaveBeenCalledTimes(4);
      press.stop();
      vi.advanceTimersByTime(1000);
      expect(act).toHaveBeenCalledTimes(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ignores a press of any button but the main one', () => {
    const act = vi.fn();
    repeatPress(act).start({ button: 2 });
    expect(act).not.toHaveBeenCalled();
  });
});

describe('a number stepped', () => {
  it('moves by its step, ten steps with Shift, to the step\'s decimals', () => {
    expect(stepped(1.7, 1, 0.1)).toBe(1.8);
    expect(stepped(1.7, -1, 0.1, { shift: true })).toBe(0.7);
    expect(stepped(58, 1, 0.1)).toBe(58.1);
    expect(stepped(31, -1, 1)).toBe(30);
  });

  it('stays within bounds', () => {
    expect(stepped(0.05, -1, 0.1, { min: 0 })).toBe(0);
    expect(stepped(89.95, 1, 0.1, { max: 89 })).toBe(89);
  });
});
