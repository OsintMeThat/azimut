// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const goto = vi.hoisted(() => vi.fn());
vi.mock('../lib/navigate.js', () => ({ gotoPoint: goto }));
const { default: TimelineLayerCard } = await import('./TimelineLayerCard.svelte');

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

describe('a layer marker read in the Timeline', () => {
  it('says what it is, where it is kept, and opens on the map', () => {
    const item = { label: 'Depot', raw: '2026-09-13', layer: { title: 'Front', group: 'Strikes', status: 'damaged',
      external: true, links: ['https://x.com/a/1'], at: { lat: 48.85, lon: 2.29 } } };
    held = mount(TimelineLayerCard, { target: document.body, props: { item, onclose: vi.fn() } }); flushSync();
    expect(document.body.textContent).toContain('Front · Strikes');
    expect(document.body.textContent).toContain('Damaged · Geolocated by someone else');
    expect(document.querySelector('a').href).toBe('https://x.com/a/1');
    [...document.querySelectorAll('button')].find((node) => node.textContent === 'Show on the map').click();
    expect(goto).toHaveBeenCalledWith(48.85, 2.29);
  });
});
