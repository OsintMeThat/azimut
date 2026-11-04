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
vi.mock('../../lib/notes/preview.js', () => ({
  pageLine: (pages, index) => pages[index] ?? 0,
  createPreview: ({ onresult }) => ({
    ask: () => onresult(answer),
    now: async () => onresult(answer),
    stop: () => {},
  }),
}));

const { default: PagePane } = await import('./PagePane.svelte');

let target;
let app;
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
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

  it('offer no sizes where the note cannot be changed', async () => {
    await pane({});
    expect(target.querySelector('.picture-bar')).toBeNull();
    expect(target.querySelector('.gap')).toBeNull();
    expect(target.querySelectorAll('.picture')).toHaveLength(2);
  });
});
