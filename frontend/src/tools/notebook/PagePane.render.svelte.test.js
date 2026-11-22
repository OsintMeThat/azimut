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
const { asked, askedHtml } = vi.hoisted(() => ({ asked: [], askedHtml: [] }));
/** The HTML page the server stands in with: a reading page holding one line. */
const PAGE = '<!doctype html><html><head><title>Lead</title></head><body><main class="az-body"><p>Seen at the quay.</p></main></body></html>';
vi.mock('../../lib/notes/preview.js', () => ({
  pageLine: (pages, index) => pages[index] ?? 0,
  createPreview: ({ onresult }) => ({
    ask: (request) => { asked.push(request); onresult(answer); },
    now: async (request) => { asked.push(request); onresult(answer); },
    stop: () => {},
  }),
  htmlPreview: ({ onresult }) => ({
    ask: (request) => { askedHtml.push(request); onresult({ ...answer, html: PAGE, warnings: [{ text: 'A count with no range.', line: 4, kind: 'count' }] }); },
    now: async (request) => { askedHtml.push(request); onresult({ ...answer, html: PAGE, warnings: [{ text: 'A count with no range.', line: 4, kind: 'count' }] }); },
    stop: () => {},
  }),
}));

const { canStateSourceOf, statePostedOf, stateSourceOf } = vi.hoisted(() => ({
  canStateSourceOf: vi.fn(async (_case, entity) => entity.id === 'm2'),
  statePostedOf: vi.fn(async () => {}),
  stateSourceOf: vi.fn(async () => {}),
}));
vi.mock('../../lib/notes/sources.js', () => ({ canStateSourceOf, statePostedOf, stateSourceOf }));

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
  askedHtml.length = 0;
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

  it('press the place a picture takes from its centred block when its line writes none', async () => {
    // the server says left for a place unwritten; the line and its block say centre
    const text = ['::: center', '[[media:m2|Pier]]{width=50%}', ':::', 'x', '', '', '[[media:m1|Roof]]{width=100% align=right}'].join('\n');
    answer.pictures[1].align = 'left';
    await pane({ text, onresize: vi.fn() });
    const pressedOf = (node) => [...node.querySelectorAll('button.align[aria-pressed="true"]')].map((button) => button.title);
    expect(pressedOf(sheet(0).querySelector('.picture'))).toEqual(['Centre']);
    expect(pressedOf(sheet(1).querySelector('.picture'))).toEqual(['Right']);
    answer.pictures[1].align = 'center';
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

  it('open the app\'s menu on a right-click rather than the browser\'s, its first item taking the note there', async () => {
    const onjump = vi.fn();
    await pane({ onresize: vi.fn(), onjump });
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 200, clientY: 300 });
    sheet(1).querySelector('.hit').dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    await vi.waitFor(() => expect(document.body.querySelector('.float-menu[aria-label="The page"]')).not.toBeNull());
    const menu = document.body.querySelector('.float-menu[aria-label="The page"]');
    const items = [...menu.querySelectorAll('.fm-item')];
    expect(items.map((item) => item.querySelector('.fm-grow').textContent))
      .toEqual(['Go to it in the note', 'Copy the words', 'See it on the whole screen']);
    // nothing read under the pointer: nothing to copy
    expect(items[1].disabled).toBe(true);
    items[0].click();
    flushSync();
    expect(onjump).toHaveBeenCalledWith(6, undefined);
    expect(document.body.querySelector('.float-menu[aria-label="The page"]')).toBeNull();
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

  it('offer Posted… on a proof only, holding where it was posted, and draw the pages again', async () => {
    const proofs = [
      { id: 'm1', type: 'capture', label: 'Roof', attrs: { path: 'media/roof.png' } },
      { id: 'm2', type: 'proof', label: 'Proof 28', attrs: { path: 'proofs/28.png', posted_url: 'https://x.com/me/status/1' } },
    ];
    await pane({ onresize: vi.fn(), entities: proofs, text: TEXT });
    expect(buttons(0)).toContain('Posted ✓');
    expect(buttons(1).some((label) => label.startsWith('Posted'))).toBe(false);
    [...sheet(0).querySelectorAll('.picture-bar button')].find((button) => button.textContent.trim() === 'Posted ✓').click();
    flushSync();
    const field = sheet(0).querySelector('.caption-here input[type="url"]');
    expect(field.value).toBe('https://x.com/me/status/1');
    expect(field.getAttribute('aria-label')).toBe('Posted at');
    field.value = 'https://x.com/me/status/2';
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
    expect(statePostedOf).toHaveBeenCalledWith('c1', proofs[1], 'https://x.com/me/status/2');
    expect(sheet(0).querySelector('.caption-here')).toBeNull();
  });

  it('read Posted ✓ for a proof Post marked posted with a link, as the report links it', async () => {
    const proofs = [
      { id: 'm1', type: 'capture', label: 'Roof', attrs: { path: 'media/roof.png' } },
      { id: 'm2', type: 'proof', label: 'Proof 28', attrs: { path: 'proofs/28.png',
        posted: [{ site: 'x', at: '2026-11-09T10:00:00Z', url: 'https://x.com/me/status/5' }] } },
    ];
    await pane({ onresize: vi.fn(), entities: proofs, text: TEXT });
    expect(buttons(0)).toContain('Posted ✓');
    [...sheet(0).querySelectorAll('.picture-bar button')].find((button) => button.textContent.trim() === 'Posted ✓').click();
    flushSync();
    expect(sheet(0).querySelector('.caption-here input[type="url"]').value).toBe('https://x.com/me/status/5');
  });

  it('draw the pages again when the case states where a picture comes from or was posted, and only then', async () => {
    const props = $state({ onresize: vi.fn(), entities: ENTITIES, text: TEXT });
    target = document.createElement('div');
    document.body.append(target);
    app = mount(PagePane, { target, props: { caseId: 'c1', note: 'n1', look: { style: 'report' }, ...props,
      get entities() { return props.entities; } } });
    await tick();
    flushSync();
    const before = asked.length;
    props.entities = ENTITIES.map((entity) => ({ ...entity }));
    flushSync();
    expect(asked.length).toBe(before);
    props.entities = [ENTITIES[0], { ...ENTITIES[1], type: 'proof', attrs: { ...ENTITIES[1].attrs, posted_url: 'https://x.com/me/status/3' } }];
    flushSync();
    expect(asked.length).toBe(before + 1);
    expect(asked.at(-1).text).toBe(TEXT);
    // a post Post marked posted with a link is where the report links the proof too
    const post = { site: 'x', at: '2026-11-09T10:00:00Z', url: 'https://x.com/me/status/4' };
    props.entities = [{ ...ENTITIES[0], type: 'proof', attrs: { ...ENTITIES[0].attrs, posted: [post] } }, props.entities[1]];
    flushSync();
    expect(asked.length).toBe(before + 2);
  });

  it('draw the pages again when a cited bookmark says who posted it and when, or a book changes', async () => {
    const mark = { id: 'b7', type: 'bookmark', label: 'Instagram post', attrs: { url: 'https://www.instagram.com/p/DIC1c6ysX7w/' } };
    const props = $state({ onresize: vi.fn(), entities: [...ENTITIES, mark], text: TEXT });
    target = document.createElement('div');
    document.body.append(target);
    app = mount(PagePane, { target, props: { caseId: 'c1', note: 'n1', look: { style: 'report' }, ...props,
      get entities() { return props.entities; } } });
    await tick();
    flushSync();
    const before = asked.length;
    props.entities = [...ENTITIES, { ...mark, attrs: { ...mark.attrs, author: '@gaivire_8', published_at: '2026-01-04' } }];
    flushSync();
    expect(asked.length).toBe(before + 1);
    props.entities = [...props.entities, { id: 'p1', type: 'publication', label: 'Straits of Salt', attrs: { author: 'Helena Marsh' } }];
    flushSync();
    expect(asked.length).toBe(before + 2);
    // another record changing nothing an entry reads draws nothing
    props.entities = [...props.entities, { id: 'x1', type: 'person', label: 'Someone', attrs: {} }];
    flushSync();
    expect(asked.length).toBe(before + 2);
  });

  it('draw the pages again when Settings changes who signs: a new logo, a signature or a name', async () => {
    const { prefs } = await import('../../lib/state.svelte.js');
    const kept = { picturesRev: prefs.picturesRev, logoRev: prefs.logoRev, reportName: prefs.reportName };
    await pane({ text: TEXT, entities: ENTITIES });
    const before = asked.length;
    prefs.picturesRev += 1;
    flushSync();
    expect(asked.length).toBe(before + 1);
    prefs.logoRev = '1700000000000000000';
    flushSync();
    prefs.reportName = 'A. Analyst';
    flushSync();
    expect(asked.length).toBe(before + 3);
    expect(asked.at(-1).text).toBe(TEXT);
    Object.assign(prefs, kept);
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
    // a warning about a heading lands under it, a link's on its line (`warnings.js`, `jumpFor`)
    expect(onjump).toHaveBeenCalledWith(14, { section: true });
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

describe('PDF or HTML', () => {
  const settle = async () => {
    for (let round = 0; round < 4; round += 1) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    flushSync();
  };
  const formats = () => target.querySelector('.pane-bar [role="group"][aria-label="Format"]');
  const frames = () => [...target.querySelectorAll('.html-page iframe')];

  it('shows the pages first, and the HTML page once asked, as the file reads, kept for this browser', async () => {
    await pane({});
    const [pdf, html] = formats().querySelectorAll('button');
    expect(pdf.getAttribute('aria-pressed')).toBe('true');
    expect(askedHtml).toHaveLength(0);
    expect(frames()).toHaveLength(0);
    html.click();
    await settle();
    expect(askedHtml.at(-1)).toMatchObject({ caseId: 'c1', note: 'n1', edition: 'internal', text: 'x' });
    expect(localStorage.getItem('azimut:note-page-format')).toBe('html');
    // the pages and their picture marks are gone; the page is in a frame that reaches nothing of the app
    expect(target.querySelector('.sheet')).toBeNull();
    expect(target.querySelector('.picture')).toBeNull();
    const [first, second] = frames();
    expect(first.getAttribute('sandbox')).toBe('allow-scripts allow-popups allow-popups-to-escape-sandbox');
    expect(first.getAttribute('sandbox')).not.toContain('allow-same-origin');
    expect(second.getAttribute('srcdoc')).toContain('<p>Seen at the quay.</p>');
    // the app's own lines say where the page was read to, before the page closes
    expect(second.getAttribute('srcdoc')).toMatch(/azimutPage[\s\S]*<\/script><\/body>/);
    expect(target.querySelector('.pane-bar').textContent).toContain('As the file reads in a browser');
    expect(target.querySelector('#page-warnings').textContent).toContain('A count with no range.');
  });

  it('opens on HTML when it was left there, and goes back to the pages', async () => {
    localStorage.setItem('azimut:note-page-format', 'html');
    await pane({});
    expect(askedHtml).toHaveLength(1);
    expect(asked).toHaveLength(0);
    formats().querySelectorAll('button')[0].click();
    await settle();
    expect(asked).toHaveLength(1);
    expect(frames()).toHaveLength(0);
    expect(target.querySelector('.sheet')).not.toBeNull();
    expect(localStorage.getItem('azimut:note-page-format')).toBe('pdf');
  });

  it('offers no HTML to a template, which belongs to no case', async () => {
    localStorage.setItem('azimut:note-page-format', 'html');
    await pane({ caseId: '', note: 'case' });
    expect(formats()).toBeNull();
    expect(askedHtml).toHaveLength(0);
    expect(asked).toHaveLength(1);
  });
});

describe('Full screen', () => {
  const settle = async () => {
    for (let round = 0; round < 4; round += 1) {
      await tick();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    flushSync();
  };
  /** Two frames of the browser's own, for the rAFs the pane waits on as it is given back. */
  const frames = () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(resolve, 0))));
  const stage = () => target.querySelector('.page-pane > .stage');
  const bar = () => stage().querySelector('.screen-bar');
  const press = (selector) => target.querySelector(selector).click();
  const widths = () => bar()?.querySelector('[role="group"][aria-label="Width"]');
  const pick = (group, name) => [...group.querySelectorAll('button')].find((button) => button.textContent.trim() === name).click();

  /** The browser's full screen, given to the element that asks; `refuse` makes it say no. */
  function browserScreen({ refuse = false } = {}) {
    let holder = null;
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => holder });
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => true });
    const change = () => document.dispatchEvent(new Event('fullscreenchange'));
    HTMLElement.prototype.requestFullscreen = vi.fn(async function request() {
      if (refuse) throw new TypeError('Permissions check failed');
      holder = this;
      change();
    });
    document.exitFullscreen = vi.fn(async () => {
      holder = null;
      change();
    });
    return {
      leave: () => { holder = null; change(); },
      restore: () => {
        delete document.fullscreenElement;
        delete document.fullscreenEnabled;
        delete HTMLElement.prototype.requestFullscreen;
        delete document.exitFullscreen;
      },
    };
  }
  let screen = null;
  afterEach(() => {
    screen?.restore();
    screen = null;
  });

  it('hands the preview’s own box the screen from the bar, the same frames inside, and Exit gives it back', async () => {
    screen = browserScreen();
    localStorage.setItem('azimut:note-page-format', 'html');
    await pane({ title: 'Lead' });
    const before = [...target.querySelectorAll('.html-page iframe')];
    const button = target.querySelector('.pane-bar button[aria-label="Full screen"]');
    expect(button.title).toBe('Show the preview on the whole screen');
    expect(bar()).toBeNull();
    button.click();
    await settle();
    expect(HTMLElement.prototype.requestFullscreen.mock.contexts[0]).toBe(stage());
    expect(stage().classList.contains('full')).toBe(true);
    expect(bar().textContent).toContain('Lead');
    expect(bar().textContent).toContain('As the file reads in a browser');
    expect(bar().querySelector('[role="group"][aria-label="Format"] [aria-pressed="true"]').textContent).toBe('HTML');
    // the same preview, larger: no frame drawn anew, no new page asked for
    expect([...stage().querySelectorAll('.html-page iframe')]).toEqual(before);
    const exit = bar().querySelector('button.exit');
    expect(exit.title).toBe('Back to the note (Esc)');
    expect(document.activeElement).toBe(exit);
    exit.click();
    await settle();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(bar()).toBeNull();
    expect(stage().classList.contains('full')).toBe(false);
    expect(document.activeElement).toBe(button);
  });

  it('follows the browser’s own exit, and Esc', async () => {
    screen = browserScreen();
    await pane({});
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    screen.leave();
    await settle();
    expect(bar()).toBeNull();
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(document.exitFullscreen).toHaveBeenCalledTimes(1);
    expect(bar()).toBeNull();
  });

  it('covers the window itself where the browser refuses, and Esc gives the pane back', async () => {
    screen = browserScreen({ refuse: true });
    await pane({});
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    expect(stage().classList.contains('covering')).toBe(true);
    expect(bar()).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    await settle();
    expect(stage().classList.contains('covering')).toBe(false);
    expect(bar()).toBeNull();
    // a browser with no full screen for a part of the page at all
    screen.restore();
    screen = null;
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    expect(stage().classList.contains('covering')).toBe(true);
    bar().querySelector('button.exit').click();
    await settle();
    expect(stage().classList.contains('covering')).toBe(false);
  });

  it('reads the HTML page at a desktop’s, a tablet’s or a phone’s width, and the PDF at its own', async () => {
    screen = browserScreen();
    localStorage.setItem('azimut:note-page-format', 'html');
    await pane({});
    expect(stage().dataset.width).toBe('desktop');
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    const choices = [...widths().querySelectorAll('button')];
    expect(choices.map((button) => [button.textContent.trim(), button.title])).toEqual([
      ['Desktop', 'As wide as the screen'], ['Tablet', '820 px wide, as on a tablet'], ['Phone', '390 px wide, as on a phone'],
    ]);
    expect(choices[0].getAttribute('aria-pressed')).toBe('true');
    expect(stage().dataset.width).toBe('desktop');
    pick(widths(), 'Phone');
    flushSync();
    expect(stage().dataset.width).toBe('phone');
    expect(widths().querySelector('[aria-pressed="true"]').textContent).toBe('Phone');
    pick(widths(), 'Tablet');
    flushSync();
    expect(stage().dataset.width).toBe('tablet');
    // the PDF's pages keep their own size: no width to pick
    pick(bar().querySelector('[role="group"][aria-label="Format"]'), 'PDF');
    await settle();
    expect(widths()).toBeNull();
    expect(stage().dataset.width).toBe('desktop');
    expect(stage().querySelector('.sheet')).not.toBeNull();
    pick(bar().querySelector('[role="group"][aria-label="Format"]'), 'HTML');
    await settle();
    expect(stage().dataset.width).toBe('tablet');
    // back in the pane the page takes the pane's width, the choice kept for the next time
    bar().querySelector('button.exit').click();
    await settle();
    expect(stage().dataset.width).toBe('desktop');
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    expect(stage().dataset.width).toBe('tablet');
  });

  it('keeps drawing the note while it holds the screen', async () => {
    screen = browserScreen();
    localStorage.setItem('azimut:note-page-format', 'html');
    target = document.createElement('div');
    document.body.append(target);
    const props = $state({ caseId: 'c1', note: 'n1', text: 'x', look: { style: 'report' } });
    app = mount(PagePane, { target, props });
    await settle();
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    const asked = askedHtml.length;
    props.text = 'x and y';
    await new Promise((resolve) => setTimeout(resolve, 0));
    await settle();
    expect(askedHtml.length).toBe(asked + 1);
    expect(askedHtml.at(-1).text).toBe('x and y');
    expect(bar()).not.toBeNull();
  });

  it('gives the pane back where it was read to, the HTML page as the pages', async () => {
    screen = browserScreen();
    localStorage.setItem('azimut:note-page-format', 'html');
    await pane({});
    const shown = () => stage().querySelector('.html-page iframe.shown') ?? stage().querySelectorAll('.html-page iframe')[1];
    const frame = shown();
    const said = (y) => window.dispatchEvent(new MessageEvent('message', { data: { azimutPage: y }, source: frame.contentWindow }));
    stage().querySelectorAll('.html-page iframe').forEach((node) => node.dispatchEvent(new Event('load')));
    flushSync();
    said(640);
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    said(2400);
    const told = vi.spyOn(shown().contentWindow, 'postMessage');
    bar().querySelector('button.exit').click();
    await settle();
    await frames();
    expect(told).toHaveBeenCalledWith({ azimutScroll: 640 }, '*');

    // the PDF's pages, scrolled in the pane and further on the whole screen
    pick(target.querySelector('.pane-bar [role="group"][aria-label="Format"]'), 'PDF');
    await settle();
    const pages = stage().querySelector('.pages');
    pages.scrollTop = 300;
    press('.pane-bar button[aria-label="Full screen"]');
    await settle();
    pages.scrollTop = 1200;
    bar().querySelector('button.exit').click();
    await settle();
    await frames();
    expect(pages.scrollTop).toBe(300);
  });
});
