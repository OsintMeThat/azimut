import { describe, expect, it, vi } from 'vitest';
import { closeTopOverlay, isTopOverlay, joinOverlays } from './overlayStack.js';

describe('the overlay on top', () => {
  it('is the last one opened, and the only one a key press reaches', () => {
    const below = {};
    const above = {};
    const leaveBelow = joinOverlays(below);
    const leaveAbove = joinOverlays(above);
    expect(isTopOverlay(above)).toBe(true);
    expect(isTopOverlay(below)).toBe(false);
    leaveAbove();
    expect(isTopOverlay(below)).toBe(true);
    leaveBelow();
  });

  it('is closed the way Escape closes it, and only that one', () => {
    const closeBelow = vi.fn();
    const closeAbove = vi.fn();
    const leaveBelow = joinOverlays({}, closeBelow);
    const leaveAbove = joinOverlays({}, closeAbove);
    expect(closeTopOverlay()).toBe(true);
    expect(closeAbove).toHaveBeenCalledTimes(1);
    expect(closeBelow).not.toHaveBeenCalled();
    leaveAbove();
    leaveBelow();
  });

  it('says nothing was open when nothing is', () => {
    expect(closeTopOverlay()).toBe(false);
  });

  it('still holds the screen when it has no way to be closed', () => {
    const leave = joinOverlays({});
    expect(closeTopOverlay()).toBe(true);
    leave();
  });
});
