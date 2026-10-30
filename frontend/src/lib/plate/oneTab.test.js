import { afterEach, describe, expect, it, vi } from 'vitest';
import { plateTabs } from './oneTab.js';

/** A channel carrying each message to every other channel of the same name, as browser tabs do, at once. */
function fakeChannels() {
  const open = new Set();
  return class {
    constructor(name) { this.name = name; this.onmessage = null; open.add(this); }
    postMessage(data) { for (const other of open) if (other !== this && other.name === this.name) other.onmessage?.({ data }); }
    close() { open.delete(this); }
  };
}

let tabs = [];
afterEach(() => { for (const tab of tabs) tab.close(); tabs = []; });
function tab(Channel, calls = {}) {
  const made = plateTabs({ Channel, onlost: calls.onlost ?? vi.fn(), onsaved: calls.onsaved ?? vi.fn() });
  tabs.push(made);
  return made;
}

describe('one plate, one tab', () => {
  it('lets a plate go when another tab opens it, and only that plate', () => {
    const Channel = fakeChannels();
    const onlost = vi.fn();
    const first = tab(Channel, { onlost });
    const second = tab(Channel);
    first.hold('c1', 'Front');
    second.hold('c1', 'Rear');
    second.hold('c2', 'Front');
    expect(onlost).not.toHaveBeenCalled();
    second.hold('c1', 'Front');
    expect(onlost).toHaveBeenCalledWith({ caseId: 'c1', name: 'Front' });
  });

  it('tells the tab that took the plate once the other has written it', () => {
    const Channel = fakeChannels();
    const onsaved = vi.fn();
    const first = tab(Channel);
    const second = tab(Channel, { onsaved });
    first.hold('c1', 'Front');
    second.hold('c1', 'Front');
    first.hold(null, null);
    first.saved('c1', 'Front');
    expect(onsaved).toHaveBeenCalledWith({ caseId: 'c1', name: 'Front' });
  });

  it('hears nothing about a plate it no longer holds, nor its own messages', () => {
    const Channel = fakeChannels();
    const onlost = vi.fn();
    const first = tab(Channel, { onlost });
    const second = tab(Channel);
    first.hold('c1', 'Front');
    first.hold(null, null);
    second.hold('c1', 'Front');
    first.saved('c1', 'Front');
    expect(onlost).not.toHaveBeenCalled();
  });

  it('does without a channel where the browser has none', () => {
    const lone = plateTabs({ Channel: null });
    expect(() => { lone.hold('c1', 'Front'); lone.saved('c1', 'Front'); lone.close(); }).not.toThrow();
  });
});
