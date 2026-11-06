// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { normaliseLook } from '../../lib/notes/look.js';

// the server names the families; their faces load as the panel opens, Inter's file is missing
const { loads } = vi.hoisted(() => ({ loads: [] }));
vi.mock('../../lib/notes/noteFonts.js', () => ({
  faceFamily: (key) => `azimut-note-${key}`,
  noteFonts: async () => [
    { id: '', label: "Style's own" },
    { id: 'serif', label: 'Noto Serif', note: 'Serif text, sans headings' },
    { id: 'sans', label: 'Noto Sans', note: 'Sans throughout' },
    { id: 'book', label: 'Source Serif 4', note: 'A book serif for long write-ups' },
    { id: 'modern', label: 'Inter', note: 'A clean sans for short briefs' },
  ],
  loadNoteFont: async (key) => { loads.push(key); return key !== 'modern'; },
}));

const { default: LookControl } = await import('./LookControl.svelte');

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
  loads.length = 0;
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
    for (const words of ['Style', 'Page', 'Accent', 'Marking', 'Cover', 'Contents page', 'Numbered headings']) {
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
    pressed("The style's").click();
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

  it('shows each typeface in its own face, the style\'s own first, and hands the one picked up', async () => {
    openPanel();
    for (let round = 0; round < 4; round += 1) await tick();
    flushSync();
    const cards = [...panel().querySelectorAll('.font-card')];
    expect(cards.map((card) => card.querySelector('.font-name').textContent)).toEqual(["Style's own", 'Noto Serif', 'Noto Sans', 'Source Serif 4', 'Inter']);
    expect(loads.sort()).toEqual(['book', 'modern', 'sans', 'serif']);
    // drawn in its face once loaded; one that failed keeps the interface's font
    expect(cards[3].querySelector('.font-ag').style.fontFamily).toContain('azimut-note-book');
    expect(cards[4].querySelector('.font-ag').style.fontFamily).toBe('');
    // the style's own is shown in the face Plain sets its text in
    expect(cards[0].querySelector('.font-ag').style.fontFamily).toContain('azimut-note-serif');
    expect(cards[0].getAttribute('aria-checked')).toBe('true');
    cards[3].click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ font: 'book', size: '' });
    expect(panel().querySelector('.font-card.on .font-name').textContent).toBe('Source Serif 4');
  });

  it('sets the text smaller or larger, and back to normal', () => {
    openPanel();
    const sizes = panel().querySelector('[aria-label="Text size"]');
    expect([...sizes.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual(['Smaller', 'Normal', 'Larger']);
    pressed('Larger').click();
    flushSync();
    expect(changes.at(-1).size).toBe('large');
    pressed('Normal').click();
    flushSync();
    expect(changes.at(-1).size).toBe('');
  });

  it('opens with the style picked in focus, so the keyboard goes on inside the panel', async () => {
    props.look = normaliseLook({ style: 'journal' });
    openPanel();
    await tick();
    await tick();
    expect(document.activeElement?.textContent).toContain('Journal');
  });

  it('shows the list of sources as the style has it until it is set, then writes on or off', () => {
    const sources = () => panel().querySelector('input[role="switch"]');
    openPanel();
    expect(sources().closest('.row').textContent).toContain('Sources');
    expect(sources().closest('label').textContent).toContain('List sources at the end');
    // Plain prints none of its own, a report lists them
    expect(sources().checked).toBe(false);
    props.look = normaliseLook({ style: 'report' });
    flushSync();
    expect(sources().checked).toBe(true);
    expect(changes).toHaveLength(0);
    sources().click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ style: 'report', sources: 'off' });
    expect(sources().checked).toBe(false);
    sources().click();
    flushSync();
    expect(changes.at(-1).sources).toBe('on');
    // once set, it stays as set whatever the style
    [...panel().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Plain')).click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ style: 'plain', sources: 'on' });
    expect(sources().checked).toBe(true);
  });

  it('offers a template the list of sources too', () => {
    props.template = true;
    props.look = normaliseLook({ style: 'brief' });
    openPanel();
    const sources = panel().querySelector('input[role="switch"]');
    expect(sources.checked).toBe(true);
    sources.click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ style: 'brief', sources: 'off' });
  });

  it('offers three covers: none, the style\'s with its fields, or the analyst\'s own page', () => {
    openPanel();
    const covers = panel().querySelector('[aria-label="Cover page"]');
    expect([...covers.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual(['Off', "The style's", 'Your own page']);
    expect(pressed('Off').getAttribute('aria-checked')).toBe('true');
    expect(panel().textContent).not.toContain('Subtitle');
    pressed("The style's").click();
    flushSync();
    expect(changes.at(-1).cover).toMatchObject({ on: true, mode: '' });
    expect(panel().textContent).toContain('Subtitle');
    pressed('Your own page').click();
    flushSync();
    expect(changes.at(-1).cover).toMatchObject({ on: true, mode: 'own', top: false });
    // the style's fields give way to where the page sits, and the day {date} prints
    expect(panel().textContent).not.toContain('Subtitle');
    expect(panel().textContent).not.toContain('Picture');
    expect(panel().textContent).toContain('above the End of the cover page line');
    expect(panel().querySelector('input[type="date"]')).not.toBeNull();
    const centred = [...panel().querySelectorAll('input[role="switch"]')].find((input) => input.closest('label').textContent.includes('Centred down the page'));
    expect(centred.checked).toBe(true);
    centred.click();
    flushSync();
    expect(changes.at(-1).cover).toMatchObject({ mode: 'own', top: true });
    expect(centred.checked).toBe(false);
    pressed('Off').click();
    flushSync();
    expect(changes.at(-1).cover).toMatchObject({ on: false, mode: '' });
  });

  it('offers a template its own page, with no day', () => {
    props.template = true;
    props.look = normaliseLook({ cover: { on: true, mode: 'own' } });
    openPanel();
    expect(pressed('Your own page').getAttribute('aria-checked')).toBe('true');
    expect(panel().textContent).toContain('Centred down the page');
    expect(panel().querySelector('input[type="date"]')).toBeNull();
  });

  describe('the header and the footer', () => {
    const fold = () => [...panel().querySelectorAll('button')].find((button) => button.textContent.includes('Header and footer'));
    const field = (name) => panel().querySelector(`input[aria-label="${name}"]`);
    const typeIn = (name, text) => {
      const input = field(name);
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };

    it('is folded after the other settings, and opens on two rows of three one-line fields', () => {
      openPanel();
      expect(fold().getAttribute('aria-expanded')).toBe('false');
      expect(field('Footer left')).toBeNull();
      // the last section of the panel
      expect(panel().querySelector('.look').lastElementChild.contains(fold())).toBe(true);
      fold().click();
      flushSync();
      expect(fold().getAttribute('aria-expanded')).toBe('true');
      const rows = [...panel().querySelectorAll('.band')].map((band) => [band.querySelector('.key').textContent, [...band.querySelectorAll('input')].map((input) => input.getAttribute('aria-label'))]);
      expect(rows).toEqual([
        ['Header', ['Header left', 'Header centre', 'Header right']],
        ['Footer', ['Footer left', 'Footer centre', 'Footer right']],
      ]);
      expect(field('Footer left').maxLength).toBe(120);
      expect(panel().textContent).toContain('{title} {date} {page} {pages} {name} {role} {organisation}');
      expect(changes).toHaveLength(0);
    });

    it('says what the style prints in an empty band, and no more once the band is filled', () => {
      openPanel();
      fold().click();
      flushSync();
      // Plain: the note's name and the page number, no header
      expect(['Header left', 'Header centre', 'Header right'].map((name) => field(name).placeholder)).toEqual(['', '', '']);
      expect(['Footer left', 'Footer centre', 'Footer right'].map((name) => field(name).placeholder)).toEqual(['{title}', '', '{page}']);
      props.look = normaliseLook({ style: 'report' });
      flushSync();
      expect(['Footer left', 'Footer centre', 'Footer right'].map((name) => field(name).placeholder)).toEqual(['{date}', '', 'Page {page} / {pages}']);
      // a band that holds a word replaces the style's, so its other slots say nothing
      props.look = normaliseLook({ style: 'report', footer: { center: 'Draft' } });
      flushSync();
      expect(['Footer left', 'Footer right'].map((name) => field(name).placeholder)).toEqual(['', '']);
      expect(field('Footer centre').value).toBe('Draft');
    });

    it('writes a slot once typing pauses, or when the field is left, and drops an emptied band', () => {
      vi.useFakeTimers();
      openPanel();
      fold().click();
      flushSync();
      typeIn('Footer left', 'Case {title}   ');
      expect(changes).toHaveLength(0);
      vi.advanceTimersByTime(500);
      expect(changes.at(-1).footer).toEqual({ left: 'Case {title}', center: '', right: '' });
      expect('header' in changes.at(-1)).toBe(false);
      // the field is left as typed, the trailing space is the look's to trim
      expect(field('Footer left').value).toBe('Case {title}   ');
      typeIn('Header right', 'Page {page}');
      field('Header right').dispatchEvent(new Event('blur'));
      expect(changes.at(-1).header).toEqual({ left: '', center: '', right: 'Page {page}' });
      expect(changes.at(-1).footer.left).toBe('Case {title}');
      typeIn('Header right', '');
      field('Header right').dispatchEvent(new Event('blur'));
      expect('header' in changes.at(-1)).toBe(false);
    });

    it('keeps a space typed after a word while the look comes back trimmed', () => {
      vi.useFakeTimers();
      openPanel();
      fold().click();
      flushSync();
      typeIn('Footer right', 'Page ');
      vi.advanceTimersByTime(500);
      flushSync();
      expect(changes.at(-1).footer.right).toBe('Page');
      expect(field('Footer right').value).toBe('Page ');
    });

    it('puts a logo in a slot instead of words, and shows it as a chip that takes it out', () => {
      openPanel();
      fold().click();
      flushSync();
      panel().querySelector('button[aria-label="Header left: a logo"]').click();
      flushSync();
      const choices = [...panel().querySelectorAll('.logo-pick button')].map((button) => button.textContent.trim());
      expect(choices).toEqual(['Your logo', 'Azimut logo']);
      [...panel().querySelectorAll('.logo-pick button')][0].click();
      flushSync();
      expect(changes.at(-1).header).toEqual({ left: 'azimut:my-logo', center: '', right: '' });
      // a chip, not the address
      expect(field('Header left')).toBeNull();
      expect(panel().querySelector('.slot-chip').textContent.trim()).toBe('Your logo');
      expect(panel().textContent).not.toContain('azimut:my-logo');
      panel().querySelector('button[aria-label="Header right: a logo"]').click();
      flushSync();
      [...panel().querySelectorAll('.logo-pick button')][1].click();
      flushSync();
      expect(changes.at(-1).header).toEqual({ left: 'azimut:my-logo', center: '', right: 'azimut:logo' });
      expect([...panel().querySelectorAll('.slot-chip')].map((chip) => chip.textContent.trim())).toEqual(['Your logo', 'Azimut logo']);
      panel().querySelector('.slot-chip button').click();
      flushSync();
      expect(changes.at(-1).header).toEqual({ left: '', center: '', right: 'azimut:logo' });
      expect(field('Header left').value).toBe('');
    });

    it('shows a band already set as On on its folded line, and the words in its fields once open', () => {
      props.look = normaliseLook({ header: { left: 'Internal' }, footer: { right: 'azimut:logo' } });
      openPanel();
      expect(fold().textContent).toContain('On');
      fold().click();
      flushSync();
      expect(field('Header left').value).toBe('Internal');
      expect(panel().querySelector('.slot-chip').textContent.trim()).toBe('Azimut logo');
    });

    it('is offered to a template as it is to a note', () => {
      props.template = true;
      openPanel();
      fold().click();
      flushSync();
      typeIn('Header centre', 'Draft report');
      field('Header centre').dispatchEvent(new Event('blur'));
      expect(changes.at(-1).header).toEqual({ left: '', center: 'Draft report', right: '' });
    });

    it('writes what is typed when the panel is closed before the pause is over', () => {
      vi.useFakeTimers();
      openPanel();
      fold().click();
      flushSync();
      typeIn('Footer centre', 'Seen');
      target.querySelector('[data-guide="notebook.look"]').click();
      flushSync();
      expect(changes.at(-1).footer.center).toBe('Seen');
    });
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
