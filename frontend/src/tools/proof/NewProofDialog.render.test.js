// @vitest-environment happy-dom
/**
 * New proof, mounted: the sources on the left, the pictures pressed in panel order, the
 * foot that creates, and the scenes still to prove when the case has some. A case with
 * no scene shows no scene at all, and the old way is three presses: New proof, a
 * picture, Create proof.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const { default: NewProofDialog } = await import('./NewProofDialog.svelte');

const item = (src, label, extra = {}) => ({
  src, label, kind: 'media', sourceType: 'upload', origin: null, collage: false, folder: '', thumb: `${src}.thumb.jpg`, meta: {}, ...extra,
});
const ITEMS = [
  item('captures/sat.png', '48.85, 2.35 · z17', { kind: 'satellite', sourceType: 'satellite' }),
  item('media/frame-a.png', 'Frame A', { sourceType: 'inspect', origin: { video: 'media/clip.mp4', time: 4.25 } }),
  item('media/frame-b.png', 'Frame B', { sourceType: 'inspect', origin: { video: 'media/clip.mp4', time: 1 } }),
  item('media/photo.jpg', 'Photo', { folder: 'site' }),
];
const SCENE = {
  key: 'media/clip.mp4#s1', video: 'media/clip.mp4', id: 's1', title: 'clip.mp4', name: 'Water tower?', time: '0:03–0:08',
  color: '#ff5252', state: 'To geolocate', captures: 1, picture: false,
  row: { kind: 'draft', id: 's1', video: 'media/clip.mp4', start: 3, end: 8, label: 'Water tower?', captures: ['captures/sat.png'] },
};
const MATERIAL = {
  frames: [{ id: 'f1', time: 4.25, path: 'media/frame-a.png', url: '/a.jpg' }, { id: 'f2', time: 5, path: null, url: '' }],
  collages: [],
  captures: [{ path: 'captures/sat.png', url: '/sat.jpg', title: 'Satellite' }],
  capture: null,
};

const live = [];
function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const handlers = { oncreate: vi.fn(), onempty: vi.fn(), onimport: vi.fn(), onclose: vi.fn(), readScene: vi.fn(async () => MATERIAL) };
  const app = mount(NewProofDialog, { target, props: { templates: [], items: ITEMS, caseId: 'case-1', ...handlers, ...props } });
  live.push(app);
  flushSync();
  return handlers;
}

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

const dialog = () => document.querySelector('[role="dialog"]');
const buttons = (selector) => [...dialog().querySelectorAll(selector)];
const byText = (selector, text) => buttons(selector).find((b) => b.textContent.trim().startsWith(text));
const tiles = () => buttons('.np-tile');
const sourceRows = () => buttons('.np-from .np-row')
  .map((b) => `${b.querySelector('.np-grow').textContent} ${b.querySelector('.np-count')?.textContent ?? ''}`.trim());

describe('New proof, the old way', () => {
  it('is named New proof and opens on All, the sources the case holds counted', () => {
    open();
    expect(dialog().getAttribute('aria-label')).toBe('New proof');
    expect(sourceRows()).toEqual(['All 4', 'Satellite 1', 'Videos 2', 'Photos 1', 'site']);
    expect(dialog().querySelector('.np-row.on').textContent).toContain('All');
    expect(tiles()).toHaveLength(4);
  });

  it('shows no scene at all in a case with none', () => {
    open({ scenes: [] });
    expect(dialog().textContent).not.toContain('Scenes to prove');
    expect(dialog().querySelector('.np-scene')).toBeNull();
    expect(dialog().querySelector('.np-takes')).toBeNull();
  });

  it('numbers the pictures in the order pressed and creates the proof of them', async () => {
    const { oncreate } = open();
    tiles()[3].click();
    tiles()[0].click();
    flushSync();
    expect(tiles()[3].querySelector('.np-mark').textContent).toBe('1');
    expect(tiles()[0].querySelector('.np-mark').textContent).toBe('2');
    expect(buttons('.np-chip').map((b) => b.querySelector('.np-chip-n').textContent)).toEqual(['1', '2']);

    byText('button', 'Create proof').click();
    expect(oncreate).toHaveBeenCalledWith({ keys: ['media/photo.jpg', 'captures/sat.png'], scene: null });
  });

  it('creates on Enter in the search, and starts empty from its quiet button', () => {
    const { oncreate, onempty } = open();
    const search = dialog().querySelector('input[aria-label="Search pictures"]');
    expect(document.activeElement).toBe(search);
    search.form.requestSubmit();
    expect(oncreate).toHaveBeenCalledWith({ keys: [], scene: null });
    byText('button', 'Start empty').click();
    expect(onempty).toHaveBeenCalledOnce();
  });

  it('narrows to a source, a folder or a search', () => {
    open();
    byText('.np-row', 'Satellite').click();
    flushSync();
    expect(tiles().map((t) => t.textContent.trim())).toEqual(['48.85, 2.35 · z17']);
    byText('.np-row', 'site').click();
    flushSync();
    expect(tiles().map((t) => t.textContent.trim())).toEqual(['Photo']);
    byText('.np-row', 'All').click();
    const search = dialog().querySelector('input[aria-label="Search pictures"]');
    search.value = 'frame';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(tiles()).toHaveLength(2);
  });

  it('shows each video as a block of its frames in clip order', () => {
    open({ titleOf: (path) => (path === 'media/clip.mp4' ? 'Clip' : '') });
    byText('.np-row', 'Videos').click();
    flushSync();
    expect(dialog().querySelector('.np-video h5').textContent).toBe('Clip');
    expect(dialog().querySelector('.np-video .np-count').textContent).toBe('2 frames');
    expect(tiles().map((t) => t.querySelector('.np-name').textContent)).toEqual(['Frame B', 'Frame A']);
    expect(tiles()[1].querySelector('.np-time').textContent).toBe('0:04.2');
  });

  it('reorders the panels with Alt+arrows and takes one out with Delete', async () => {
    const { oncreate } = open();
    tiles()[0].click();
    tiles()[1].click();
    tiles()[2].click();
    flushSync();
    const chips = () => buttons('.np-chip');
    chips()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true }));
    flushSync();
    chips()[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }));
    flushSync();
    await tick();
    byText('button', 'Create proof').click();
    expect(oncreate).toHaveBeenCalledWith({ keys: ['media/frame-a.png', 'captures/sat.png'], scene: null });
  });
});

describe('New proof from a scene', () => {
  it('lists the scenes to prove with their dot, name, time and video', () => {
    open({ scenes: [SCENE, { ...SCENE, key: 'k2', id: 's2', name: '1:30', time: '1:30' }] });
    const [row, timed] = dialog().querySelectorAll('.np-scene');
    expect(dialog().textContent).toContain('Scenes to prove');
    expect(row.querySelector('.np-scene-name').textContent).toBe('Water tower?');
    expect(row.querySelector('.np-scene-said').textContent).toBe('0:03–0:08 · clip.mp4');
    expect(row.getAttribute('style')).toContain('--scene: #ff5252');
    // a scene named by its time says it once
    expect(timed.querySelector('.np-scene-said').textContent).toBe('clip.mp4');
  });

  it('shows only the scene\'s material, all of it ticked, and the proof takes the scene up', async () => {
    const { readScene, oncreate } = open({ scenes: [SCENE] });
    dialog().querySelector('.np-scene').click();
    await vi.waitFor(() => expect(tiles()).toHaveLength(3));
    expect(readScene).toHaveBeenCalledWith(SCENE);
    expect(tiles().every((t) => t.classList.contains('selected'))).toBe(true);
    expect([...dialog().querySelectorAll('.np-body h5')].map((h) => h.firstChild.textContent.trim())).toEqual(['Frames', 'Captures gathered for it']);
    expect(dialog().querySelector('.np-takes').textContent).toContain('Water tower?');
    // what the proof takes, and the frame it files on the way, said once with their spaces
    expect(dialog().querySelector('.np-note').textContent)
      .toBe('All ticked. The proof made of them takes this scene. Saves 1 frame to the case on the way.');
    expect(tiles()[1].querySelector('.np-name').textContent).toBe('Not in the case yet');

    byText('button', 'Create proof').click();
    expect(oncreate).toHaveBeenCalledWith({ keys: ['media/frame-a.png', 'frame:f2', 'captures/sat.png'], scene: SCENE });
  });

  it('lets the scene go, keeping the pictures the case holds', async () => {
    const { oncreate } = open({ scenes: [SCENE] });
    dialog().querySelector('.np-scene').click();
    await vi.waitFor(() => expect(tiles()).toHaveLength(3));
    dialog().querySelector('.np-takes button').click();
    flushSync();
    expect(dialog().querySelector('.np-takes')).toBeNull();
    byText('button', 'Create proof').click();
    expect(oncreate).toHaveBeenCalledWith({ keys: ['media/frame-a.png', 'captures/sat.png'], scene: null });
  });

  it('says so when the scene cannot be read', async () => {
    open({ scenes: [SCENE], readScene: vi.fn(async () => null) });
    dialog().querySelector('.np-scene').click();
    await vi.waitFor(() => expect(dialog().textContent).toContain('could not be read'));
  });
});
