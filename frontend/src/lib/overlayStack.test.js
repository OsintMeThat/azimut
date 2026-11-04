// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { anyOverlayOpen, closeTopOverlay, isTopOverlay, joinOverlays, overlayHoldsKeys } from './overlayStack.js';

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

describe('whether any overlay is open', () => {
  it('follows the stack, whatever the page draws', () => {
    expect(anyOverlayOpen()).toBe(false);
    const leave = joinOverlays({});
    expect(anyOverlayOpen()).toBe(true);
    leave();
    expect(anyOverlayOpen()).toBe(false);
  });
});

describe('whether an overlay holds the keys', () => {
  const add = (attrs) => {
    const node = document.createElement('div');
    for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, value);
    document.body.append(node);
    return node;
  };

  it('is not a window beside the work, nor a dialog left in a hidden tool', () => {
    const reference = add({ role: 'dialog', 'aria-label': 'panel.svg' });
    const hidden = add({ role: 'dialog', style: 'display: none' });
    expect(overlayHoldsKeys()).toBe(false);
    reference.remove(); hidden.remove();
  });

  it('is an overlay on the stack, a modal, or a confirmation', () => {
    const leave = joinOverlays({});
    expect(overlayHoldsKeys()).toBe(true);
    leave();
    for (const attrs of [{ role: 'dialog', 'aria-modal': 'true' }, { role: 'alertdialog' }]) {
      const node = add(attrs);
      expect(overlayHoldsKeys()).toBe(true);
      node.remove();
    }
    expect(overlayHoldsKeys()).toBe(false);
  });
});
