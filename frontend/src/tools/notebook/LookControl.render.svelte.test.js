// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import { normaliseLook } from '../../lib/notes/look.js';

// the server names the families; their faces load as the Text tab shows, Inter's file is missing
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
 * The Look panel, mounted: five tabs, one section at a time, and each setting hands
 * the whole look up at once, which the Notebook saves beside the note. A template's
 * look keeps no picture and no day. The panel opens on the tab last used, which the
 * module remembers between tests as it does between visits to the Notebook, so a
 * test that needs a section goes to its tab first.
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
const opener = () => target.querySelector('[data-guide="notebook.look"]');
const openPanel = () => { opener().click(); flushSync(); };
const tabs = () => [...panel().querySelectorAll('[role="tab"]')];
const tabNamed = (name) => tabs().find((item) => item.textContent.trim() === name);
const goTo = (name) => { tabNamed(name).click(); flushSync(); };
const pressed = (text) => [...panel().querySelectorAll('button')].find((button) => button.textContent.trim() === text);
const box = (words) => [...panel().querySelectorAll('label.switch')].find((label) => label.textContent.includes(words)).querySelector('input');

describe('the Look panel', () => {
  it('names the style on its button, and opens on its first tab the first time, one section shown', async () => {
    // a module of its own, so nothing was used before it
    vi.resetModules();
    const svelte = await import('svelte');
    const { default: Fresh } = await import('./LookControl.svelte');
    const home = document.createElement('div');
    document.body.append(home);
    const fresh = svelte.mount(Fresh, { target: home, props: { look: normaliseLook(null), onchange() {}, entities: [] } });
    svelte.flushSync();
    expect(home.textContent).toContain('Plain');
    home.querySelector('[data-guide="notebook.look"]').click();
    svelte.flushSync();
    const dialog = document.querySelector('.float-menu');
    expect(dialog.getAttribute('role')).toBe('dialog');
    expect(dialog.querySelector('[role="tablist"]')).not.toBeNull();
    expect([...dialog.querySelectorAll('[role="tab"]')].map((item) => item.textContent.trim()))
      .toEqual(['Style', 'Text', 'Page', 'Cover', 'Header & footer']);
    expect(dialog.querySelector('[role="tab"][aria-selected="true"]').textContent.trim()).toBe('Style');
    expect(dialog.querySelectorAll('.style-card')).toHaveLength(4);
    // the other sections are not drawn
    for (const words of ['Typeface', 'Accent', 'Marking', 'Subtitle', 'Footer']) expect(dialog.textContent).not.toContain(words);
    svelte.unmount(fresh);
    home.remove();
    dialog.remove();
  });

  it('puts the three switches of the document under the style cards, all as switches', () => {
    openPanel();
    goTo('Style');
    const group = panel().querySelector('.group');
    expect(group.getAttribute('aria-label')).toBe('In the document');
    expect([...group.querySelectorAll('label.switch')].map((label) => label.textContent.trim()))
      .toEqual(['Contents page', 'Numbered headings', 'List sources at the end']);
    expect([...group.querySelectorAll('input')].every((input) => input.getAttribute('role') === 'switch')).toBe(true);
    expect(panel().querySelector('input[type="checkbox"]:not([role="switch"])')).toBeNull();
  });

  it('hands up a style, a page size and a marking as soon as they are picked, each on its own tab', () => {
    openPanel();
    goTo('Style');
    [...panel().querySelectorAll('.style-card')].find((card) => card.textContent.includes('Report')).click();
    flushSync();
    goTo('Page');
    pressed('Letter').click();
    flushSync();
    pressed('TLP:AMBER+STRICT').click();
    flushSync();
    expect(changes.map((look) => [look.style, look.page, look.tlp])).toEqual([
      ['report', 'a4', ''], ['report', 'letter', ''], ['report', 'letter', 'amber-strict'],
    ]);
    expect(target.textContent).toContain('Report');
  });

  it('puts paper, accent and marking on one column of labels', () => {
    openPanel();
    goTo('Page');
    const rows = [...panel().querySelectorAll('.section > .row')];
    expect(rows.map((row) => row.querySelector('.key').textContent)).toEqual(['Paper', 'Accent', 'Marking']);
    expect(panel().querySelector('[aria-label="Page size"]')).not.toBeNull();
    expect(panel().querySelector('[aria-label="TLP marking"]')).not.toBeNull();
  });

  it('turns the cover, the contents and the numbers on', () => {
    openPanel();
    goTo('Cover');
    pressed("The style's").click();
    flushSync();
    goTo('Style');
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
    goTo('Cover');
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
    goTo('Cover');
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
    goTo('Page');
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
    goTo('Style');
    await tick();
    // nothing is asked for before the Text tab shows
    expect(loads).toEqual([]);
    goTo('Text');
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
    goTo('Text');
    const sizes = panel().querySelector('[aria-label="Text size"]');
    expect([...sizes.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual(['Smaller', 'Normal', 'Larger']);
    pressed('Larger').click();
    flushSync();
    expect(changes.at(-1).size).toBe('large');
    pressed('Normal').click();
    flushSync();
    expect(changes.at(-1).size).toBe('');
  });

  it('opens with the tab in focus, so the arrows move between sections and Tab goes into one', async () => {
    props.look = normaliseLook({ style: 'journal' });
    openPanel();
    await tick();
    await tick();
    expect(document.activeElement?.getAttribute('role')).toBe('tab');
    expect(document.activeElement?.getAttribute('aria-selected')).toBe('true');
  });

  it('shows the list of sources as the style has it until it is set, then writes on or off', () => {
    const sources = () => box('List sources at the end');
    openPanel();
    goTo('Style');
    expect(sources().closest('.group').textContent).toContain('In the document');
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
    goTo('Style');
    const sources = box('List sources at the end');
    expect(sources.checked).toBe(true);
    sources.click();
    flushSync();
    expect(changes.at(-1)).toMatchObject({ style: 'brief', sources: 'off' });
  });

  it('offers three covers: none, the style\'s with its fields, or the analyst\'s own page', () => {
    openPanel();
    goTo('Cover');
    const covers = panel().querySelector('[aria-label="Cover page"]');
    expect([...covers.querySelectorAll('button')].map((button) => button.textContent.trim())).toEqual(['Off', "The style's", 'Your own page']);
    expect(pressed('Off').getAttribute('aria-checked')).toBe('true');
    expect(panel().textContent).not.toContain('Subtitle');
    pressed("The style's").click();
    flushSync();
    expect(changes.at(-1).cover).toMatchObject({ on: true, mode: '' });
    expect(panel().textContent).toContain('Subtitle');
    // each field has its label on the one column the cover's own label is on
    expect([...panel().querySelectorAll('.section > .row')].map((row) => row.querySelector('.key').textContent)).toEqual(['Cover', 'Subtitle', 'Picture', 'Day']);
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

  it('says on the own page how to pin something to a corner', () => {
    props.look = normaliseLook({ cover: { on: true, mode: 'own' } });
    openPanel();
    goTo('Cover');
    expect(panel().textContent).toContain('A ::: top-right block, or / › Alignment, pins what it holds to a corner.');
    pressed('Off').click();
    flushSync();
    expect(panel().textContent).not.toContain('pins what it holds');
  });

  it('offers a template its own page, with no day', () => {
    props.template = true;
    props.look = normaliseLook({ cover: { on: true, mode: 'own' } });
    openPanel();
    goTo('Cover');
    expect(pressed('Your own page').getAttribute('aria-checked')).toBe('true');
    expect(panel().textContent).toContain('Centred down the page');
    expect(panel().querySelector('input[type="date"]')).toBeNull();
  });

  it('offers a template no picture and no day', () => {
    props.template = true;
    props.look = normaliseLook({ cover: { on: true } });
    openPanel();
    goTo('Cover');
    expect(panel().textContent).toContain('Subtitle');
    expect(panel().textContent).not.toContain('Picture');
    expect(panel().querySelector('input[type="date"]')).toBeNull();
  });

  describe('the tabs', () => {
    const press = (key, on = document.activeElement) => {
      on.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
      flushSync();
    };
    const selected = () => panel().querySelector('[role="tab"][aria-selected="true"]').textContent.trim();

    it('is a tablist of five, one section shown as the panel of the tab chosen', () => {
      openPanel();
      goTo('Style');
      expect(panel().querySelector('[role="tablist"]').getAttribute('aria-label')).toBe('Look sections');
      const section = panel().querySelector('[role="tabpanel"]');
      expect(tabNamed('Style').getAttribute('aria-controls')).toBe(section.id);
      expect(section.getAttribute('aria-labelledby')).toBe(tabNamed('Style').id);
      goTo('Page');
      expect(section.getAttribute('aria-labelledby')).toBe(tabNamed('Page').id);
      expect(panel().querySelectorAll('[role="tabpanel"]')).toHaveLength(1);
      expect(panel().textContent).toContain('Marking');
      expect(panel().textContent).not.toContain('Typeface');
      // only the tab shown is in the tab order
      expect(tabs().map((item) => item.tabIndex)).toEqual([-1, -1, 0, -1, -1]);
      // every tab says what it holds on hover
      for (const item of tabs()) expect(item.title, item.textContent).not.toBe('');
    });

    it('moves with the arrows, wraps round, and goes to the ends with Home and End', () => {
      openPanel();
      goTo('Style');
      tabNamed('Style').focus();
      press('ArrowRight');
      expect(selected()).toBe('Text');
      expect(document.activeElement).toBe(tabNamed('Text'));
      expect(panel().textContent).toContain('Typeface');
      press('ArrowRight');
      press('ArrowRight');
      expect(selected()).toBe('Cover');
      press('End');
      expect(selected()).toBe('Header & footer');
      expect(document.activeElement).toBe(tabNamed('Header & footer'));
      press('ArrowRight');
      expect(selected()).toBe('Style');
      press('ArrowLeft');
      expect(selected()).toBe('Header & footer');
      press('Home');
      expect(selected()).toBe('Style');
      // other keys leave the tabs alone
      press('a');
      press('ArrowDown');
      expect(selected()).toBe('Style');
      expect(changes).toHaveLength(0);
    });

    it('leaves the arrows to a field inside a section', () => {
      props.look = normaliseLook({ cover: { on: true } });
      openPanel();
      goTo('Cover');
      const subtitle = panel().querySelector('input[placeholder="A line under the title"]');
      subtitle.focus();
      press('ArrowRight', subtitle);
      expect(selected()).toBe('Cover');
    });

    it('opens on the last tab used, for this panel and any other', () => {
      openPanel();
      goTo('Header & footer');
      opener().click();
      flushSync();
      expect(panel()).toBeNull();
      openPanel();
      expect(selected()).toBe('Header & footer');
      expect(panel().textContent).toContain('Footer');
      // another Look, as a template has beside a note, starts where this one left off
      const other = document.createElement('div');
      document.body.append(other);
      const second = mount(LookControl, { target: other, props: { look: normaliseLook(null), onchange() {}, entities: [] } });
      flushSync();
      opener().click();
      flushSync();
      other.querySelector('[data-guide="notebook.look"]').click();
      flushSync();
      expect(selected()).toBe('Header & footer');
      unmount(second);
      other.remove();
    });

    it('marks a tab whose section holds something set, and no tab for a look that sets nothing', () => {
      openPanel();
      const dots = () => tabs().filter((item) => item.querySelector('.dot')).map((item) => item.textContent.trim());
      expect(dots()).toEqual([]);
      props.look = normaliseLook({ font: 'book' });
      flushSync();
      expect(dots()).toEqual(['Text']);
      props.look = normaliseLook({ size: 'large' });
      flushSync();
      expect(dots()).toEqual(['Text']);
      props.look = normaliseLook({ page: 'letter' });
      flushSync();
      expect(dots()).toEqual(['Page']);
      props.look = normaliseLook({ accent: '#c8102e' });
      flushSync();
      expect(dots()).toEqual(['Page']);
      props.look = normaliseLook({ tlp: 'amber' });
      flushSync();
      expect(dots()).toEqual(['Page']);
      props.look = normaliseLook({ cover: { on: true } });
      flushSync();
      expect(dots()).toEqual(['Cover']);
      props.look = normaliseLook({ footer: { right: 'Draft' } });
      flushSync();
      expect(dots()).toEqual(['Header & footer']);
      props.look = normaliseLook({ style: 'brief' });
      flushSync();
      expect(dots()).toEqual(['Style']);
      props.look = normaliseLook({ toc: true });
      flushSync();
      expect(dots()).toEqual(['Style']);
      props.look = normaliseLook({ style: 'report', font: 'sans', tlp: 'red', cover: { on: true }, header: { left: 'x' } });
      flushSync();
      expect(dots()).toEqual(['Style', 'Text', 'Page', 'Cover', 'Header & footer']);
      expect(tabNamed('Page').querySelector('.dot').title).toBe('Something here is set');
      expect(tabNamed('Page').querySelector('.dot').getAttribute('aria-label')).toBe('Set');
      // setting one from its tab lights it at once
      props.look = normaliseLook(null);
      flushSync();
      goTo('Text');
      pressed('Larger').click();
      flushSync();
      expect(tabNamed('Text').querySelector('.dot')).not.toBeNull();
      pressed('Normal').click();
      flushSync();
      expect(tabNamed('Text').querySelector('.dot')).toBeNull();
    });
  });

  describe('the header and the footer', () => {
    const field = (name) => panel().querySelector(`input[aria-label="${name}"]`);
    const typeIn = (name, text) => {
      const input = field(name);
      input.value = text;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    };
    const show = () => {
      openPanel();
      goTo('Header & footer');
    };

    it('is the last tab, on two rows of three one-line fields, each row labelled above it', () => {
      openPanel();
      expect(tabs().at(-1).textContent.trim()).toBe('Header & footer');
      goTo('Header & footer');
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
      show();
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
      show();
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

    it('writes a slot on Enter', () => {
      show();
      typeIn('Footer centre', 'Seen');
      field('Footer centre').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(changes.at(-1).footer.center).toBe('Seen');
    });

    it('keeps a space typed after a word while the look comes back trimmed', () => {
      vi.useFakeTimers();
      show();
      typeIn('Footer right', 'Page ');
      vi.advanceTimersByTime(500);
      flushSync();
      expect(changes.at(-1).footer.right).toBe('Page');
      expect(field('Footer right').value).toBe('Page ');
    });

    it('puts a logo in a slot instead of words, and shows it as a chip that takes it out', () => {
      show();
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

    it('shows a band already set with a dot on its tab, and the words in its fields once the tab is open', () => {
      props.look = normaliseLook({ header: { left: 'Internal' }, footer: { right: 'azimut:logo' } });
      openPanel();
      expect(tabNamed('Header & footer').querySelector('.dot')).not.toBeNull();
      goTo('Header & footer');
      expect(field('Header left').value).toBe('Internal');
      expect(panel().querySelector('.slot-chip').textContent.trim()).toBe('Azimut logo');
    });

    it('is offered to a template as it is to a note', () => {
      props.template = true;
      show();
      typeIn('Header centre', 'Draft report');
      field('Header centre').dispatchEvent(new Event('blur'));
      expect(changes.at(-1).header).toEqual({ left: '', center: 'Draft report', right: '' });
    });

    it('writes what is typed when the panel is closed before the pause is over', () => {
      vi.useFakeTimers();
      show();
      typeIn('Footer centre', 'Seen');
      opener().click();
      flushSync();
      expect(changes.at(-1).footer.center).toBe('Seen');
    });

    it('writes what is typed when another tab is pressed before the pause is over', () => {
      vi.useFakeTimers();
      show();
      typeIn('Footer centre', 'Seen');
      goTo('Page');
      vi.advanceTimersByTime(500);
      expect(changes.at(-1).footer.center).toBe('Seen');
    });
  });
});
