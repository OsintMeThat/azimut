// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import DraftPage from './DraftPage.svelte';
import { slideTiles } from '../../lib/proofSlides.js';

/** The page a scene still to prove shows in place of a proof, when the strip lands on it. */

const draft = (id, extra = {}) => ({ kind: 'draft', id, start: null, end: null, label: '', captures: [], abandoned: null, ...extra });
const tileOf = (row, geolocating = null) =>
  slideTiles({ video: 'media/clip.mp4', scenes: [row], geolocating }, { started: false, page: row.id }).find((t) => t.key === row.id);

let held = null;
let target = null;

afterEach(() => {
  if (held) unmount(held);
  target?.remove();
  held = null;
  target = null;
});

function show(tile, props = {}) {
  const onaction = vi.fn();
  target = document.createElement('div');
  document.body.append(target);
  held = mount(DraftPage, { target, props: { tile, caseId: 'c1', onaction, ...props } });
  flushSync();
  return { root: target, onaction };
}

const buttons = (root) => [...root.querySelectorAll('button')].map((b) => b.textContent.trim());

describe('the page of a scene still to prove', () => {
  it('names the scene, says when it is and where it stands, and offers the next steps', () => {
    const { root, onaction } = show(tileOf(draft('s1', { start: 130, end: 158, label: 'Road bridge?', footage: 3 })));
    expect(root.querySelector('h3').textContent).toBe('Road bridge?');
    // its time, then its mark and its two counts, the hover saying them in words
    const counts = root.querySelector('.draft-line [data-testid="scene-counts"]');
    expect(root.querySelector('.draft-line > span').textContent).toBe('2:10–2:38');
    expect(counts.title).toBe('To geolocate: no map capture yet, 3 pictures from the video');
    expect([...counts.querySelectorAll('[data-testid^="count-"]')].map((c) => c.textContent.trim())).toEqual(['0', '3']);
    expect(buttons(root)).toEqual(['Make this slide', 'Geolocate', 'Abandon…']);
    root.querySelector('.btn-primary').click();
    expect(onaction).toHaveBeenCalledWith('make');
    [...root.querySelectorAll('button')][1].click();
    expect(onaction).toHaveBeenCalledWith('geolocate');
  });

  it('says it is geolocated now, and shows the captures it gathered', () => {
    const tile = tileOf(draft('s3', { start: 5, end: null, captures: ['captures/a.png', 'captures/b.png'] }), 's3');
    const { root } = show(tile, { captures: [{ path: 'captures/a.png', thumb: 'captures/.thumbs/a.webp' }, { path: 'captures/b.png', thumb: null }] });
    expect(root.querySelector('h3').textContent).toBe('0:05');
    const counts = root.querySelector('.draft-line [data-testid="scene-counts"]');
    expect(counts.dataset.stage).toBe('live');
    expect(counts.title).toBe('Geolocating: 2 map captures, nothing from the video yet');
    const pictures = [...root.querySelectorAll('.draft-captures img')].map((img) => img.getAttribute('src'));
    expect(pictures).toEqual([expect.stringContaining('captures/.thumbs/a.webp'), expect.stringContaining('captures/b.png')]);
  });

  it('asks why before the scene is given up, and Cancel keeps it', async () => {
    const { root, onaction } = show(tileOf(draft('s1', { start: 3, end: 9 })));
    [...root.querySelectorAll('button')][2].click();
    await tick();
    await new Promise((resolve) => setTimeout(resolve));
    const field = root.querySelector('.draft-why input');
    expect(document.activeElement).toBe(field);
    expect(buttons(root)).toEqual(['Abandon', 'Cancel']);
    [...root.querySelectorAll('button')][1].click();
    flushSync();
    expect(buttons(root)).toEqual(['Make this slide', 'Geolocate', 'Abandon…']);
    [...root.querySelectorAll('button')][2].click();
    await tick();
    const again = root.querySelector('.draft-why input');
    again.value = 'too dark';
    again.dispatchEvent(new Event('input', { bubbles: true }));
    root.querySelector('.draft-why').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(onaction).toHaveBeenCalledWith('abandon', 'too dark');
  });

  it('offers only Restore for a scene given up, with the word it was given up with', () => {
    const { root, onaction } = show(tileOf(draft('s2', { start: 70, abandoned: { reason: 'too blurry' } })));
    expect(root.querySelector('.draft-page').classList).toContain('given');
    expect(root.querySelector('.draft-line').textContent.trim()).toBe('Abandoned: too blurry');
    expect(buttons(root)).toEqual(['Restore']);
    root.querySelector('button').click();
    expect(onaction).toHaveBeenCalledWith('restore');
  });
});
