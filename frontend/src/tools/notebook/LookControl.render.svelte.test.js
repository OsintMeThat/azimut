// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LookControl from './LookControl.svelte';
import { normaliseLook } from '../../lib/notes/look.js';

/**
 * The Look panel, mounted: each setting hands the whole look up at once, which the
 * Notebook saves beside the note. A template's look keeps no picture and no day.
 */

const ENTITIES = [
  { id: 'm1', type: 'media', label: 'quay.jpg', attrs: { path: 'media/quay.jpg', kind: 'image' } },
  { id: 'm2', type: 'media', label: 'convoy.mp4', attrs: { path: 'media/convoy.mp4', kind: 'video' } },
  { id: 'p1', type: 'place', label: 'Quay', attrs: {} },
];

const props = $state({ look: null, onchange: null, template: false, entities: ENTITIES });
let target;
let app;
let changes;

beforeEach(() => {
  changes = [];
  props.look = normaliseLook(null);
  props.template = false;
  // the Notebook takes what is handed up as the look shown
  props.onchange = (next) => { changes.push(next); props.look = next; };
  target = document.createElement('div');
  document.body.append(target);
  app = mount(LookControl, { target, props });
  flushSync();
});

afterEach(() => {
  unmount(app);
  target.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  vi.useRealTimers();
});

const panel = () => document.querySelector('.float-menu');
const openPanel = () => { target.querySelector('[data-guide="notebook.look"]').click(); flushSync(); };
const pressed = (text) => [...panel().querySelectorAll('button')].find((button) => button.textContent.trim() === text);
const box = (words) => [...panel().querySelectorAll('label.check')].find((label) => label.textContent.includes(words)).querySelector('input');

describe('the Look panel', () => {
  it('names the style on its button, and opens on the settings', () => {
    expect(target.textContent).toContain('Plain');
    openPanel();
    expect(panel().getAttribute('role')).toBe('dialog');
    for (const words of ['Style', 'Page', 'Accent', 'Marking', 'Cover page', 'Contents page', 'Numbered headings']) {
      expect(panel().textContent).toContain(words);
    }
  });

  it('hands up a style, a page size and a marking as soon as they are picked', () => {
    openPanel();
    [...panel().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Report')).click();
    flushSync();
    pressed('Letter').click();
    flushSync();
    pressed('TLP:AMBER+STRICT').click();
    flushSync();
    expect(changes.map((look) => [look.style, look.page, look.tlp])).toEqual([
      ['report', 'a4', ''], ['report', 'letter', ''], ['report', 'letter', 'amber-strict'],
    ]);
    expect(target.textContent).toContain('Report');
  });

  it('turns the cover, the contents and the numbers on', () => {
    openPanel();
    box('Cover page').click();
    flushSync();
    box('Contents page').click();
    flushSync();
    box('Numbered headings').click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ cover: { on: true }, toc: true, numbered: true });
  });

  it('saves a subtitle once typing stops, or when the field is left', () => {
    vi.useFakeTimers();
    props.look = normaliseLook({ cover: { on: true } });
    openPanel();
    const field = panel().querySelector('input[placeholder="A line under the title"]');
    field.value = 'Draft';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    expect(changes).toHaveLength(0);
    vi.advanceTimersByTime(500);
    expect(changes.at(-1).cover.subtitle).toBe('Draft');
    field.value = 'Draft 2';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    field.dispatchEvent(new Event('blur'));
    expect(changes.at(-1).cover.subtitle).toBe('Draft 2');
  });

  it('puts a picture of the case on the cover, never a video, and takes it off', () => {
    props.look = normaliseLook({ cover: { on: true } });
    openPanel();
    pressed('Choose a picture').click();
    flushSync();
    const rows = [...panel().querySelectorAll('.picture-row')];
    expect(rows.map((row) => row.textContent.trim())).toEqual(['quay.jpg']);
    rows[0].click();
    flushSync();
    expect(changes.at(-1).cover.image).toBe('m1');
    expect(panel().textContent).toContain('quay.jpg');
    panel().querySelector('button[aria-label="No picture on the cover"]').click();
    flushSync();
    expect(changes.at(-1).cover.image).toBe('');
  });

  it('takes an accent from a pasted code, and gives the style its own back', () => {
    openPanel();
    const code = panel().querySelector('input[aria-label="Accent colour code"]');
    code.value = 'rgb(200, 16, 46)';
    code.dispatchEvent(new Event('input', { bubbles: true }));
    code.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(changes.at(-1).accent).toBe('#c8102e');
    pressed("Style's own").click();
    flushSync();
    expect(changes.at(-1).accent).toBe('');
  });

  it('offers a template no picture and no day', () => {
    props.template = true;
    props.look = normaliseLook({ cover: { on: true } });
    openPanel();
    expect(panel().textContent).toContain('Subtitle');
    expect(panel().textContent).not.toContain('Picture');
    expect(panel().querySelector('input[type="date"]')).toBeNull();
  });
});
