// @vitest-environment happy-dom
/**
 * The file a map card plays, mounted: its stage takes the file's own shape once
 * the browser knows it, so a phone video stands tall and whole instead of being
 * cut to its middle, and the card asks the map to show it whole again.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const { default: SavedPopup } = await import('./SavedPopup.svelte');

const live = [];
const clip = (id, extra = {}) => ({
  id,
  key: `${id}@48.1,2.1`,
  kind: 'media',
  media_kind: 'video',
  title: id,
  path: `media/${id}.mp4`,
  lat: 48.1,
  lon: 2.1,
  status: 'confirmed',
  roads: [{ type: 'located-at', status: 'confirmed' }],
  ...extra,
});

function open(items, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push(mount(SavedPopup, {
    target,
    props: { items, caseId: 'case-1', coords: () => '48.1, 2.1', onopen: vi.fn(), ...props },
  }));
  flushSync();
}

const stage = () => document.querySelector('.stage');

/** The browser has read the file's size. */
function loaded(element, width, height) {
  const [w, h] = element.tagName === 'VIDEO' ? ['videoWidth', 'videoHeight'] : ['naturalWidth', 'naturalHeight'];
  Object.defineProperty(element, w, { value: width, configurable: true });
  Object.defineProperty(element, h, { value: height, configurable: true });
  element.dispatchEvent(new Event(element.tagName === 'VIDEO' ? 'loadedmetadata' : 'load'));
  flushSync();
}

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

describe('the stage a card plays a file on', () => {
  it('opens as a landscape frame the width of the card', () => {
    open([clip('quay')]);
    expect(stage().style.height).toBe('166px');
  });

  it('stands tall for a phone video, up to a ceiling, and asks to be shown whole', async () => {
    const onresize = vi.fn();
    open([clip('phone')], { onresize });
    loaded(document.querySelector('video'), 720, 1280);
    expect(stage().style.height).toBe('320px');
    await tick();
    expect(onresize).toHaveBeenCalledTimes(1);
  });

  it('takes a picture’s own shape between the floor and the ceiling', () => {
    open([clip('square', { media_kind: 'image', path: 'media/square.png' })]);
    loaded(document.querySelector('img'), 600, 600);
    expect(stage().style.height).toBe('296px');
  });

  it('keeps a wide one from shrinking to a strip', () => {
    open([clip('pano')]);
    loaded(document.querySelector('video'), 4000, 1000);
    expect(stage().style.height).toBe('120px');
  });

  it('remembers each file of a stack in its own shape', () => {
    open([clip('phone'), clip('quay')]);
    loaded(document.querySelector('video'), 720, 1280);
    document.querySelector('[aria-label="Next file"]').click();
    flushSync();
    expect(stage().style.height).toBe('166px');
    loaded(document.querySelector('video'), 1920, 1080);
    expect(stage().style.height).toBe('167px');
    document.querySelector('[aria-label="Previous file"]').click();
    flushSync();
    expect(stage().style.height).toBe('320px');
  });
});
