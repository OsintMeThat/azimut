// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(async () => []) } }));

const { default: GuidePage } = await import('./GuidePage.svelte');
const { landingFor } = await import('../lib/guide.js');
const { guideHash } = await import('../lib/guideWindow.js');

let live;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  delete document.documentElement.dataset.theme;
  localStorage.clear();
});

function mountAt(hash) {
  location.hash = hash;
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(GuidePage, { target });
  flushSync();
}

const tabShown = () => document.querySelector('.tabs .tab[aria-current]')?.textContent.trim();

describe('the guide tab', () => {
  it('opens on the place in its address, named as the guide', () => {
    mountAt(guideHash({ ...landingFor('inspect') }));
    expect(document.title).toBe('Azimut guide');
    expect(tabShown()).toBe('Inspect');
  });

  it('goes where a second press of the app’s button sends it', () => {
    mountAt(guideHash({ ...landingFor('inspect') }));
    location.hash = guideHash({ ...landingFor('media') });
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    flushSync();
    expect(tabShown()).toBe('Media');
  });

  it('follows the theme switched in the app’s tab', () => {
    mountAt(guideHash({ item: 'start' }));
    localStorage.setItem('azimut:theme', 'light');
    window.dispatchEvent(new StorageEvent('storage', { key: 'azimut:theme' }));
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
