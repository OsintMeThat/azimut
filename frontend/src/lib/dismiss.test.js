// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { closeOnOutsidePointer } from './dismiss.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('closeOnOutsidePointer', () => {
  it('leaves the popover open when the press lands inside it', () => {
    const popover = document.createElement('div');
    const child = document.createElement('button');
    popover.append(child);
    document.body.append(popover);
    const close = vi.fn();
    const teardown = closeOnOutsidePointer(popover, close);

    child.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(close).not.toHaveBeenCalled();
    teardown();
  });

  it('closes when the press lands outside it', () => {
    const popover = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(popover, outside);
    const close = vi.fn();
    const teardown = closeOnOutsidePointer(popover, close);

    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(close).toHaveBeenCalledOnce();
    teardown();
  });

  it('stops listening after teardown', () => {
    const popover = document.createElement('div');
    const outside = document.createElement('button');
    document.body.append(popover, outside);
    const close = vi.fn();
    const teardown = closeOnOutsidePointer(popover, close);

    teardown();
    outside.dispatchEvent(new Event('pointerdown', { bubbles: true }));

    expect(close).not.toHaveBeenCalled();
  });

  it('does nothing when rendered without a document', () => {
    vi.stubGlobal('document', undefined);

    expect(closeOnOutsidePointer(null, vi.fn())).toBeUndefined();
  });
});
