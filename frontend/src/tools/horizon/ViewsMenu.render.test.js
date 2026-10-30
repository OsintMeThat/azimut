// @vitest-environment happy-dom
/**
 * Open, in the Horizon header: there as soon as a case is open, and what its
 * list offers.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ViewsMenu from './ViewsMenu.svelte';

const LIST = [
  { name: 'North ridge', title: 'North ridge', lat: 46.5586, lon: 7.8353, photo: 'Ridge at dusk.jpg', thumb: '.horizon/North ridge.webp', updated_at: '2026-10-09T10:00:00Z' },
  { name: 'Valley', title: 'Valley', lat: 46.6, lon: 7.9, photo: null, thumb: null, updated_at: '2026-10-08T10:00:00Z' },
];

let app;
let host;

function show(props = {}, views = {}) {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(ViewsMenu, {
    target: host,
    props: {
      views: { list: LIST, current: null, busy: false, ...views },
      caseId: 'c1',
      onopen: vi.fn(),
      onnew: vi.fn(),
      onrevert: vi.fn(),
      unsaved: true,
      ...props,
    },
  });
  flushSync();
  return app;
}

const more = () => host.querySelector('.vm-open');
function openList() {
  more().click();
  flushSync();
}

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = null;
});

describe('the list of views', () => {
  it('lists the case\'s views with their preview, the photo or the place, and opens one', () => {
    const onopen = vi.fn();
    show({ onopen });
    openList();
    const rows = host.querySelectorAll('.vm-row');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Ridge at dusk.jpg');
    expect(rows[0].querySelector('img').getAttribute('src')).toBe(
      '/files/c1/.horizon/North%20ridge.webp?v=2026-10-09T10%3A00%3A00Z'
    );
    expect(rows[1].textContent).toContain('46.6000, 7.9000');
    rows[1].click();
    flushSync();
    expect(onopen).toHaveBeenCalledWith('Valley');
    expect(host.querySelector('.vm-menu')).toBeNull();
  });

  it('offers Revert only for changes to the open view, and a new view only from an open one', () => {
    show({}, { current: null });
    openList();
    expect(host.querySelector('.vm-acts')).toBeNull();
    unmount(app);
    host.remove();
    const onrevert = vi.fn();
    show({ onrevert }, { current: { name: 'North ridge', title: 'North ridge' } });
    openList();
    const acts = [...host.querySelectorAll('.vm-act')].map((b) => b.textContent.trim());
    expect(acts).toEqual(['Revert to saved', 'New view from here']);
    expect(host.querySelector('.vm-row.current').textContent).toContain('North ridge');
    host.querySelector('.vm-act').click();
    expect(onrevert).toHaveBeenCalled();
  });

  it('is a labelled Open button, and says when the case has none', () => {
    show({ onnew: null, onrevert: null }, { list: [] });
    expect(more().textContent).toContain('Open');
    openList();
    expect(host.querySelector('.vm-empty').textContent).toBe('No saved view yet');
    expect(host.querySelector('.vm-acts')).toBeNull();
  });

  it('waits for a case', () => {
    show({ caseId: null });
    expect(more().disabled).toBe(true);
    expect(more().title).toBe('Open a case to keep views');
  });

  it('closes on Escape', () => {
    show();
    openList();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    flushSync();
    expect(host.querySelector('.vm-menu')).toBeNull();
  });
});
