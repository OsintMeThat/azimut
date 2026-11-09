// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ProofSlides from './ProofSlides.svelte';
import { slideTiles } from '../../lib/proofSlides.js';

/** The strip of a video's slides under Geo Proof's canvas, pressed, walked and folded. */

const proof = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name, moments: [], at: [], png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp`, ...extra,
});
const draft = (id, extra = {}) => ({ kind: 'draft', id, start: null, end: null, label: '', captures: [], abandoned: null, ...extra });

const ANSWER = {
  video: 'media/clip.mp4',
  scenes: [
    proof('Road bridge', { moments: [{ start: 30, end: 45 }] }),
    draft('s1', { start: 50, end: 60, label: 'Water tower?' }),
    draft('s2', { start: 70, abandoned: { reason: 'too blurry' } }),
    proof('Market', { at: [80] }),
    draft('s3', { start: 90, end: 95, captures: ['captures/a.png'] }),
    proof('Square', { png: null, thumb: null, at: [100] }),
  ],
  geolocating: 's3',
};

let held = null;
let target = null;

afterEach(() => {
  if (held) unmount(held);
  target?.remove();
  held = null;
  target = null;
  vi.restoreAllMocks();
});

/** The strip mounted `width` pixels wide, its video's name and its buttons as wide as they are on screen. */
function show({ tiles = slideTiles(ANSWER, { started: true, name: 'Market', title: 'Market' }), width = 1400, ...props } = {}) {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function measured() {
    if (this.classList.contains('slides')) return width;
    if (this.classList.contains('lead')) return 110;
    if (this.classList.contains('tail')) return 120;
    return 0;
  });
  const calls = { onpick: vi.fn(), onnew: vi.fn(), onstep: vi.fn(), onvideo: vi.fn(), onaction: vi.fn() };
  target = document.createElement('div');
  document.body.append(target);
  held = mount(ProofSlides, { target, props: { tiles, video: 'media/clip.mp4', caseId: 'c1', ...calls, ...props } });
  flushSync();
  return calls;
}

const strip = () => document.body.querySelector('.slides');
const tiles = () => [...document.body.querySelectorAll('.lane button.tile')];
const tile = (key) => document.body.querySelector(`.lane [data-key="${key}"]`);
const key = (node, name, extra = {}) => {
  const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...extra });
  node.dispatchEvent(event);
  return event;
};

describe('the strip of a video\'s slides', () => {
  it('shows each scene in clip order, the abandoned greyed after a rule, then + and the list', () => {
    show();
    expect(strip().getAttribute('aria-label')).toBe('Slides of the video');
    expect(tiles().map((t) => t.dataset.key)).toEqual(['proof:Road bridge', 's1', 'proof:Market', 's3', 'proof:Square', 's2']);
    // a rule sets the abandoned apart, the last ones
    const lane = document.body.querySelector('.lane');
    expect(lane.querySelector('.rule').nextElementSibling.querySelector('.tile').dataset.key).toBe('s2');
    expect(tile('s2').classList).toContain('abandoned');
    expect(document.body.querySelector('[aria-label="New scene"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Every slide"]').textContent.trim()).toBe('6');
    expect(document.body.querySelector('.chip').textContent.trim()).toBe('clip.mp4');
  });

  it('draws a proved slide with its thumbnail, never its full picture, and its time', () => {
    show();
    const bridge = tile('proof:Road bridge');
    expect(bridge.classList).toContain('proved');
    expect(bridge.querySelector('img').getAttribute('src')).toContain('proofs/.thumbs/Road%20bridge.webp');
    expect(bridge.querySelector('img').getAttribute('loading')).toBe('lazy');
    expect(bridge.querySelector('.tile-words').textContent).toBe('0:30–0:45');
    for (const img of document.body.querySelectorAll('.lane img')) expect(img.getAttribute('src')).not.toMatch(/\.png$/);
    // a proof never composed has a placeholder and says so
    expect(tile('proof:Square').querySelector('img')).toBeNull();
    expect(tile('proof:Square').querySelector('.tile-words').textContent).toBe('No picture yet');
    // the strip holds no video: thirty of them would be heavy
    expect(document.body.querySelector('video')).toBeNull();
  });

  it('marks the slide on screen, and a dot while it holds changes', () => {
    show({ dirty: true });
    const market = tile('proof:Market');
    expect(market.classList).toContain('on');
    expect(market.getAttribute('aria-selected')).toBe('true');
    expect(market.getAttribute('tabindex')).toBe('0');
    expect(market.querySelector('.dirty')).not.toBeNull();
    expect(tiles().filter((t) => t.getAttribute('tabindex') === '0')).toHaveLength(1);
  });

  it('dashes a scene still to prove, its pin in its colour, and beats on the one geolocated', () => {
    show();
    const water = tile('s1');
    expect(water.classList).toContain('draft');
    expect(water.querySelector('.pin')).not.toBeNull();
    expect(water.querySelector('.tile-title').textContent).toBe('Water tower?');
    expect(water.querySelector('.tile-words').textContent).toBe('To geolocate');
    expect(water.title).toContain('0:50–1:00');
    expect(tile('s3').querySelector('.live')).not.toBeNull();
    expect(tile('s3').querySelector('.tile-words').textContent).toBe('Geolocating');
    // the reason a scene was given up is on hover
    expect(tile('s2').title).toContain('Abandoned: too blurry');
  });

  it('shows a slide not saved yet as new, with no menu', () => {
    show({ tiles: slideTiles(ANSWER, { started: true, name: null, title: 'Proof 7' }) });
    const fresh = tile('new');
    expect(fresh.classList).toContain('new');
    expect(fresh.querySelector('.tile-words').textContent).toBe('Not saved');
    expect(fresh.parentElement.querySelector('.more')).toBeNull();
  });

  it('moves to a slide on a press, never to the one on screen', () => {
    const calls = show();
    tile('s1').click();
    expect(calls.onpick).toHaveBeenCalledWith(expect.objectContaining({ key: 's1', kind: 'draft' }));
    calls.onpick.mockClear();
    tile('proof:Market').click();
    expect(calls.onpick).not.toHaveBeenCalled();
    document.body.querySelector('[aria-label="New scene"]').click();
    expect(calls.onnew).toHaveBeenCalledOnce();
    document.body.querySelector('.chip').click();
    expect(calls.onvideo).toHaveBeenCalledOnce();
  });

  it('outlines the slide a switch heads to while the one left saves', () => {
    show({ heading: 's3' });
    expect(tile('s3').classList).toContain('heading');
    expect(tile('s3').title).toContain('Opens once this slide is saved');
  });

  it('walks the tiles with the arrows without opening one, and leaves Alt to the composer', () => {
    const calls = show();
    tile('proof:Market').focus();
    expect(key(tile('proof:Market'), 'ArrowRight').defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(tile('s3'));
    key(document.activeElement, 'ArrowLeft');
    key(document.activeElement, 'ArrowLeft');
    expect(document.activeElement).toBe(tile('s1'));
    key(document.activeElement, 'End');
    expect(document.activeElement).toBe(tile('s2'));
    key(document.activeElement, 'Home');
    expect(document.activeElement).toBe(tile('proof:Road bridge'));
    expect(calls.onpick).not.toHaveBeenCalled();
    // Alt+→ is the composer's: next slide, from anywhere
    const alt = key(document.activeElement, 'ArrowRight', { altKey: true });
    expect(alt.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(tile('proof:Road bridge'));
  });
});

describe('a tile\'s menu', () => {
  const open = (key) => {
    tile(key).parentElement.querySelector('.more').click();
    flushSync();
    return [...document.body.querySelectorAll('.float-menu .fm-item')].map((one) => one.textContent.trim());
  };

  it('offers Rename, Inspect and Delete for a proof, the next steps for a scene to prove, Restore for one given up', () => {
    show();
    expect(open('proof:Road bridge')).toEqual(['Rename', 'Show in Inspect', 'Delete…']);
    document.body.querySelectorAll('.float-menu .fm-item')[1].click();
    flushSync();
    expect(open('s1')).toEqual(['Make this slide', 'Geolocate', 'Abandon…']);
    document.body.querySelector('.float-menu .fm-item').click();
    flushSync();
    expect(open('s2')).toEqual(['Restore']);
    expect(document.body.querySelector('.float-menu .fm-note').textContent).toBe('Abandoned: too blurry');
  });

  it('hands the act and its tile over', () => {
    const calls = show();
    open('s1');
    document.body.querySelectorAll('.float-menu .fm-item')[1].click();
    expect(calls.onaction).toHaveBeenCalledWith('geolocate', expect.objectContaining({ key: 's1' }), undefined);
  });

  it('asks why before a scene is abandoned, the word optional', async () => {
    const calls = show();
    open('s1');
    document.body.querySelectorAll('.float-menu .fm-item')[2].click();
    await tick();
    const field = document.body.querySelector('.slide-why input');
    expect(field.placeholder).toBe('Why? (optional)');
    field.value = ' too dark ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.querySelector('.slide-why').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(calls.onaction).toHaveBeenCalledWith('abandon', expect.objectContaining({ key: 's1' }), 'too dark');
  });

  it('opens on a right-click too, where the pointer is', () => {
    show();
    tile('proof:Market').parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 }));
    flushSync();
    expect([...document.body.querySelectorAll('.float-menu .fm-item')].map((one) => one.textContent.trim()))
      .toEqual(['Rename', 'Show in Inspect', 'Delete…']);
  });

  it('opens from the keys on a focused tile, the context-menu key or Shift+F10, its first item focused', async () => {
    show();
    for (const init of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
      tile('proof:Market').dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
      await tick();
      flushSync();
      const items = [...document.body.querySelectorAll('.float-menu .fm-item')];
      expect(items.map((one) => one.textContent.trim())).toEqual(['Rename', 'Show in Inspect', 'Delete…']);
      await vi.waitFor(() => expect(document.activeElement).toBe(items[0]));
      // the context-menu event the same key raises leaves the menu where the keys put it
      tile('proof:Market').parentElement.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
      flushSync();
      expect(document.body.querySelectorAll('.float-menu')).toHaveLength(1);
      document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      flushSync();
    }
    expect(tile('proof:Market').getAttribute('aria-keyshortcuts')).toBe('Shift+F10');
  });

  it('renames a proof with its name held in the menu', async () => {
    const calls = show();
    open('proof:Road bridge');
    document.body.querySelector('.float-menu .fm-item').click();
    await tick();
    const field = document.body.querySelector('.slide-name input');
    expect(field.value).toBe('Road bridge');
    field.value = 'Bridge at dawn ';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    document.body.querySelector('.slide-name').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(calls.onaction).toHaveBeenCalledWith('rename', expect.objectContaining({ key: 'proof:Road bridge' }), 'Bridge at dawn');
  });

  it('deletes a proof, and gives up on one that states no place', () => {
    const calls = show({ tiles: slideTiles({ ...ANSWER, scenes: [...ANSWER.scenes, proof('Mast', { at: [120], state: 'progress' })] }, { started: true, name: 'Market' }) });
    expect(open('proof:Mast')).toEqual(['Rename', 'Show in Inspect', 'Abandon…', 'Delete…']);
    [...document.body.querySelectorAll('.float-menu .fm-item')].at(-1).click();
    expect(calls.onaction).toHaveBeenCalledWith('delete', expect.objectContaining({ key: 'proof:Mast' }), undefined);
  });
});

describe('the list of every slide', () => {
  it('finds a slide by a word and opens the first one found on Enter', async () => {
    const calls = show();
    document.body.querySelector('[aria-label="Every slide"]').click();
    await tick();
    await new Promise((resolve) => setTimeout(resolve));
    const rows = () => [...document.body.querySelectorAll('.list-rows .fm-item')];
    expect(rows()).toHaveLength(6);
    expect(rows()[2].getAttribute('aria-selected')).toBe('true');
    const field = document.body.querySelector('.list-search input');
    expect(document.activeElement).toBe(field);
    field.value = 'water';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(rows().map((one) => one.querySelector('.fm-grow').textContent)).toEqual(['Water tower?']);
    key(field, 'Enter');
    expect(calls.onpick).toHaveBeenCalledWith(expect.objectContaining({ key: 's1' }));
    flushSync();
    expect(document.body.querySelector('.list-rows')).toBeNull();
  });
});

describe('when the strip holds no tiles', () => {
  it('is a thin line for a video this proof is alone on, with + New scene', () => {
    const calls = show({ tiles: slideTiles({ video: 'v', scenes: [proof('Market')] }, { started: true, name: 'Market' }) });
    expect(strip().classList).toContain('line');
    expect(tiles()).toHaveLength(0);
    expect(strip().textContent).toContain('1 scene');
    const add = document.body.querySelector('[aria-label="New scene"]');
    expect(add.textContent.trim()).toBe('New scene');
    add.click();
    expect(calls.onnew).toHaveBeenCalledOnce();
    expect(document.body.querySelector('.fold')).toBeNull();
  });

  it('says so when the video is no longer in the case', () => {
    show({ gone: true });
    expect(strip().classList).toContain('line');
    expect(strip().textContent.trim()).toBe('The video of this proof is no longer in the case');
    expect(document.body.querySelector('[aria-label="New scene"]')).toBeNull();
  });

  it('folds to a line that keeps the count, the name and the arrows, and unfolds', () => {
    const calls = show({ folded: true });
    expect(strip().classList).toContain('line');
    expect(tiles()).toHaveLength(0);
    expect(strip().querySelector('.said.grow').textContent).toContain('3 / 6');
    expect(strip().querySelector('.said-title').textContent).toBe('Market');
    document.body.querySelector('[aria-label="Next slide"]').click();
    expect(calls.onstep).toHaveBeenCalledWith(1);
    document.body.querySelector('[aria-label="Previous slide"]').click();
    expect(calls.onstep).toHaveBeenCalledWith(-1);
    const unfold = document.body.querySelector('[aria-label="Show the slides"]');
    expect(unfold.getAttribute('aria-expanded')).toBe('false');
    unfold.click();
    flushSync();
    expect(tiles()).toHaveLength(6);
    expect(document.body.querySelector('[aria-label="Hide the slides"]')).not.toBeNull();
  });

  it('is a pager on a narrow window', () => {
    show({ width: 400 });
    expect(tiles()).toHaveLength(0);
    expect(strip().textContent).toContain('Slide 3 of 6');
    expect(strip().textContent).toContain('Market');
    expect(document.body.querySelector('[aria-label="Every slide"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Previous slide"]').disabled).toBe(false);
  });
});

describe('many slides', () => {
  const many = (n) => ({ video: 'v', scenes: Array.from({ length: n }, (_, i) => proof(`Place ${i + 1}`, { at: [i * 10] })) });

  it('shrink to their picture and number past what the strip holds, and a count says which is shown', () => {
    show({ tiles: slideTiles(many(30), { started: true, name: 'Place 7' }), width: 1400 });
    expect(strip().classList).toContain('compact');
    expect(tile('proof:Place 7').querySelector('.tile-num').textContent).toBe('7');
    expect(tile('proof:Place 7').title).toContain('Place 7');
    expect(document.body.querySelector('.tally').textContent).toBe('7 / 30');
    unmount(held); held = null; target.remove();
    show({ tiles: slideTiles(many(4), { started: true, name: 'Place 2' }), width: 1400 });
    expect(strip().classList).not.toContain('compact');
    expect(document.body.querySelector('.tally')).toBeNull();
  });

  it('say how many are out of sight each side, and scroll to them', () => {
    show({ tiles: slideTiles(many(12), { started: true, name: null, title: 'Proof 13' }) });
    const lane = document.body.querySelector('.lane');
    [...lane.querySelectorAll('.slot')].forEach((slot, index) => {
      Object.defineProperty(slot, 'offsetLeft', { value: index * 104, configurable: true });
      Object.defineProperty(slot, 'offsetWidth', { value: 98, configurable: true });
    });
    Object.defineProperty(lane, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(lane, 'scrollWidth', { value: 1352, configurable: true });
    lane.scrollBy = vi.fn();
    // the first measure finds the strip overflowing and puts the slide on screen in its middle
    lane.dispatchEvent(new Event('scroll'));
    flushSync();
    lane.scrollLeft = 312;
    lane.dispatchEvent(new Event('scroll'));
    flushSync();
    const before = document.body.querySelector('[aria-label="3 more before"]');
    const after = document.body.querySelector('[aria-label="6 more after"]');
    expect([before.textContent, after.textContent]).toEqual(['3', '6']);
    after.click();
    expect(lane.scrollBy).toHaveBeenLastCalledWith({ left: 320, behavior: 'smooth' });
  });

  it('fade into the ends of a tight strip rather than take arrows, the video named on hover', () => {
    show({ tiles: slideTiles(many(12), { started: true, name: 'Place 6' }), width: 620 });
    expect(document.body.querySelector('.chip').classList).toContain('bare');
    expect(document.body.querySelector('.chip').getAttribute('aria-label')).toBe('clip.mp4');
    const lane = document.body.querySelector('.lane');
    [...lane.querySelectorAll('.slot')].forEach((slot, index) => {
      Object.defineProperty(slot, 'offsetLeft', { value: index * 81, configurable: true });
      Object.defineProperty(slot, 'offsetWidth', { value: 75, configurable: true });
    });
    Object.defineProperty(lane, 'clientWidth', { value: 240, configurable: true });
    Object.defineProperty(lane, 'scrollWidth', { value: 972, configurable: true });
    lane.scrollLeft = 300;
    lane.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(document.body.querySelector('.edge')).toBeNull();
    expect(lane.classList).toContain('fade-before');
    expect(lane.classList).toContain('fade-after');
  });
});

describe('the strip\'s own menu', () => {
  it('exports the slides once one has a picture, and says what it does', () => {
    const onexport = vi.fn();
    show({ onexport });
    const more = document.body.querySelector('[aria-label="More for the slides"]');
    more.click();
    flushSync();
    const item = [...document.body.querySelectorAll('.float-menu .fm-item')].find((one) => one.textContent.includes('Export the slides'));
    expect(item.disabled).toBe(false);
    expect(document.body.querySelector('.float-menu .fm-note').textContent).toBe('2 pictures, numbered in clip order, in a folder of their own');
    item.click();
    expect(onexport).toHaveBeenCalledOnce();
  });

  it('holds nothing to export while no slide has a picture, and is absent where not offered', () => {
    show({ onexport: vi.fn(), tiles: slideTiles({ video: 'v', scenes: [draft('s1'), proof('Square', { png: null, at: [3] })] }, { started: true, name: 'Square' }) });
    document.body.querySelector('[aria-label="More for the slides"]').click();
    flushSync();
    expect(document.body.querySelector('.float-menu .fm-item').disabled).toBe(true);
    expect(document.body.querySelector('.float-menu .fm-note').textContent).toBe('No slide has a picture yet');
    unmount(held); held = null; target.remove();
    show();
    expect(document.body.querySelector('[aria-label="More for the slides"]')).toBeNull();
  });
});
