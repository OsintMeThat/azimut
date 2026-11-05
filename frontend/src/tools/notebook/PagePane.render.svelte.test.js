// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

/**
 * The Page pane's pictures: each one the server placed can be sized where it
 * prints, and one pushed to the next page offers the width that keeps it on the
 * page it left. PDF.js and the server are stood in for; what is checked is what
 * the pane hands up.
 */

vi.mock('../../lib/notes/pdfjs.js', () => ({
  openPdf: vi.fn(async () => ({
    numPages: 2,
    getPage: async () => ({ getViewport: () => ({ width: 600, height: 840 }) }),
    destroy: vi.fn(),
  })),
  drawPage: vi.fn(async () => document.createElement('canvas')),
  releaseCanvas: vi.fn(),
}));

const answer = {
  data: new ArrayBuffer(4),
  pages: [0, 6],
  warnings: [],
  pictures: [
    // a tall picture, written at full width, pushed to page 2
    { line: 6, ref: 'media:m1', page: 1, box: [0.3, 0.05, 0.4, 0.9], width: '100%', align: 'left', gap: [0, 0.55, 0.9, 0.1, 0.9], fit: 41 },
    { line: 2, ref: 'media:m2', page: 0, box: [0.1, 0.2, 0.4, 0.2], width: '50%', align: 'center' },
  ],
};
const { asked } = vi.hoisted(() => ({ asked: [] }));
vi.mock('../../lib/notes/preview.js', () => ({
  pageLine: (pages, index) => pages[index] ?? 0,
  createPreview: ({ onresult }) => ({
    ask: (request) => { asked.push(request); onresult(answer); },
    now: async (request) => { asked.push(request); onresult(answer); },
    stop: () => {},
  }),
}));

const { canStateSourceOf, stateSourceOf } = vi.hoisted(() => ({
  canStateSourceOf: vi.fn(async (_case, entity) => entity.id === 'm2'),
  stateSourceOf: vi.fn(async () => {}),
}));
vi.mock('../../lib/notes/sources.js', () => ({ canStateSourceOf, stateSourceOf }));

const { registerOpener, resetOpeners } = await import('../../lib/notes/openers.js');
const { editionOf, reloadEditions } = await import('../../lib/notes/editions.svelte.js');
const { default: PagePane } = await import('./PagePane.svelte');

let target;
let app;
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  answer.warnings = [];
  answer.internal = 0;
  asked.length = 0;
  localStorage.clear();
  reloadEditions();
  resetOpeners();
  vi.clearAllMocks();
});

async function pane(props) {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(PagePane, { target, props: { caseId: 'c1', note: 'n1', text: 'x', look: { style: 'report' }, ...props } });
  for (let round = 0; round < 6; round += 1) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  flushSync();
}

const sheet = (index) => target.querySelectorAll('.sheet')[index];

const TEXT = ['Intro', '', '[[media:m2|Pier]]{width=50% align=center caption="Old"}', '', 'x', '', '[[media:m1|Roof]]{width=100%}'].join('\n');

describe('the pictures on the pages', () => {
  it('are drawn over the page they landed on, the size they have marked', async () => {
    await pane({ onresize: vi.fn() });
    const [first] = sheet(0).querySelectorAll('.picture');
    expect(first.style.left).toBe('10.000%');
    const pressed = [...first.querySelectorAll('[aria-pressed="true"]')].map((button) => button.textContent.trim() || button.title);
    expect(pressed).toEqual(['M', 'Centre']);
  });

  it('hand up a new size, held inside the page for a tall picture', async () => {
    const onresize = vi.fn();
    await pane({ onresize });
    const tall = sheet(1).querySelector('.picture');
    [...tall.querySelectorAll('button')].find((button) => button.textContent.trim() === 'M').click();
    const [picture, change] = onresize.mock.calls[0];
    expect(picture.ref).toBe('media:m1');
    // three times as tall as wide: half the page down is under a quarter across
    expect(parseFloat(change.width)).toBeLessThan(25);
  });

  it('mark the room a pushed picture left, with the width that keeps it there', async () => {
    const onresize = vi.fn();
    await pane({ onresize });
    const gap = sheet(0).querySelector('.gap');
    expect(gap.style.top).toBe('55.000%');
    gap.querySelector('button').click();
    expect(onresize).toHaveBeenCalledWith(answer.pictures[0], { width: '41%' });
  });

  it('take the note to the picture when pressed', async () => {
    const onjump = vi.fn();
    await pane({ onresize: vi.fn(), onjump });
    sheet(1).querySelector('.picture-hit').click();
    expect(onjump).toHaveBeenCalledWith(6);
  });

  it('take a caption written in place, under the picture, from what the line says', async () => {
    const onresize = vi.fn();
    await pane({ onresize, text: TEXT });
    const [first] = sheet(0).querySelectorAll('.picture');
    [...first.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Caption').click();
    flushSync();
    const field = sheet(0).querySelector('.caption-here input');
    expect(field.value).toBe('Old');
    expect(document.activeElement).toBe(field);
    // under the picture, at least half the page wide
    expect(sheet(0).querySelector('.caption-here').style.width).toBe('50.000%');
    field.value = 'Smoke over the port';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    flushSync();
    expect(onresize).toHaveBeenCalledWith(answer.pictures[1], { caption: 'Smoke over the port' });
    expect(sheet(0).querySelector('.caption-here')).toBeNull();
  });

  it('leave the caption as it was on Escape', async () => {
    const onresize = vi.fn();
    await pane({ onresize, text: TEXT });
    [...sheet(1).querySelectorAll('.picture button')].find((button) => button.textContent.trim() === 'Caption').click();
    flushSync();
    const field = sheet(1).querySelector('.caption-here input');
    expect(field.value).toBe('');
    field.value = 'Typed';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();
    expect(onresize).not.toHaveBeenCalled();
    expect(sheet(1).querySelector('.caption-here')).toBeNull();
  });

  it('keep a small picture\'s bar on the side of the page it is on', async () => {
    await pane({ onresize: vi.fn() });
    expect(sheet(0).querySelector('.picture-bar').classList.contains('from-left')).toBe(true);
    expect(sheet(1).querySelector('.picture-bar').classList.contains('from-left')).toBe(false);
  });

  it('offer no sizes where the note cannot be changed', async () => {
    await pane({});
    expect(target.querySelector('.picture-bar')).toBeNull();
    expect(target.querySelector('.gap')).toBeNull();
    expect(target.querySelectorAll('.picture')).toHaveLength(2);
  });
});

describe('the way back, and a source', () => {
  const ENTITIES = [
    { id: 'm1', type: 'capture', label: 'Roof', attrs: { path: 'media/roof.png' } },
    { id: 'm2', type: 'media', label: 'Pier', attrs: { path: 'media/pier.png', kind: 'image' } },
  ];
  const buttons = (index) => [...sheet(index).querySelectorAll('.picture-bar button')].map((button) => button.textContent.trim());

  it('offer the tool a picture was made in, beside its sizes', async () => {
    const open = vi.fn();
    registerOpener('satellite', { accepts: (entity) => entity.type === 'capture', open, label: 'Open in Map' });
    await pane({ onresize: vi.fn(), entities: ENTITIES });
    expect(buttons(1).at(-1)).toBe('Open in Map');
    expect(buttons(0)).not.toContain('Open in Map');
    [...sheet(1).querySelectorAll('.picture-bar button')].at(-1).click();
    expect(open).toHaveBeenCalledWith(ENTITIES[0]);
  });

  it('offer Source… for a picture brought in by hand, and state it under the picture', async () => {
    await pane({ onresize: vi.fn(), entities: ENTITIES, text: TEXT });
    expect(buttons(0)).toContain('Source…');
    expect(buttons(1)).not.toContain('Source…');
    [...sheet(0).querySelectorAll('.picture-bar button')].find((button) => button.textContent.trim() === 'Source…').click();
    flushSync();
    const field = sheet(0).querySelector('.caption-here input[type="url"]');
    expect(document.activeElement).toBe(field);
    field.value = 'https://t.me/port/4';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(stateSourceOf).toHaveBeenCalledWith('c1', ENTITIES[1], 'https://t.me/port/4');
    expect(sheet(0).querySelector('.caption-here')).toBeNull();
  });
});

describe('what the page warns about', () => {
  it('is listed under the bar, and a warning with a line takes the note there', async () => {
    answer.warnings = [{ text: 'Section "Method" is empty.', line: 14 }, { text: 'A picture is missing', line: null }];
    const onjump = vi.fn();
    await pane({ onjump });
    const list = target.querySelector('ul[aria-label="Warnings"]');
    expect([...list.querySelectorAll('li')].map((row) => row.textContent.trim())).toEqual(['Section "Method" is empty.', 'A picture is missing']);
    const rows = list.querySelectorAll('li');
    expect(rows[1].querySelector('button')).toBeNull();
    rows[0].querySelector('button').click();
    expect(onjump).toHaveBeenCalledWith(14);
    expect(target.querySelector('.pane-bar').textContent).toContain('2 warnings');
  });

  it('marks a part no longer in the case apart from what is only advice', async () => {
    answer.warnings = [
      { text: 'Picture "Roof" is no longer in the case.', line: 3, kind: 'missing' },
      { text: 'Picture "Quay" has no source.', line: 5, kind: 'unsourced' },
    ];
    await pane({});
    const marks = [...target.querySelectorAll('ul[aria-label="Warnings"] .warning')].map((row) => row.dataset.kind);
    expect(marks).toEqual(['missing', 'unsourced']);
  });

  it('folds away from the bar, and comes back', async () => {
    answer.warnings = [{ text: 'A picture is missing', line: null }];
    await pane({});
    const toggle = target.querySelector('.pane-bar button.warned');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    flushSync();
    expect(target.querySelector('ul[aria-label="Warnings"]')).toBeNull();
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    toggle.click();
    flushSync();
    expect(target.querySelector('ul[aria-label="Warnings"]')).not.toBeNull();
  });

  it('says nothing when there is nothing to warn about', async () => {
    await pane({});
    expect(target.querySelector('.warned')).toBeNull();
    expect(target.querySelector('ul[aria-label="Warnings"]')).toBeNull();
  });
});

describe('the editions', () => {
  const settle = async () => {
    for (let round = 0; round < 4; round += 1) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    flushSync();
  };
  const switchOf = () => target.querySelector('.pane-bar [role="group"][aria-label="Edition"]');

  it('are offered only when the note holds an internal passage', async () => {
    await pane({});
    expect(switchOf()).toBeNull();
    expect(asked.at(-1).edition).toBe('internal');
  });

  it('draw the edition picked at once, and keep it for the note', async () => {
    answer.internal = 2;
    await pane({});
    const [internal, publicOne] = switchOf().querySelectorAll('button');
    expect(internal.getAttribute('aria-pressed')).toBe('true');
    expect(publicOne.title).toBe('The note without its internal passages, for readers outside the team');
    const before = asked.length;
    publicOne.click();
    await settle();
    expect(asked.length).toBe(before + 1);
    expect(asked.at(-1)).toMatchObject({ caseId: 'c1', note: 'n1', edition: 'public' });
    expect(switchOf().querySelector('[aria-pressed="true"]').textContent).toBe('Public');
    expect(editionOf('c1', 'n1')).toBe('public');
    expect(editionOf('c1', 'n2')).toBe('internal');
  });

  it('are kept for the visit only in a template, which no note holds', async () => {
    answer.internal = 1;
    await pane({ caseId: '', note: 'case' });
    switchOf().querySelectorAll('button')[1].click();
    await settle();
    expect(asked.at(-1).edition).toBe('public');
    expect(localStorage.getItem('azimut:note-editions')).toBeNull();
  });
});
