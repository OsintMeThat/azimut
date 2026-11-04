// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The Page pane's pages, mounted. PDF.js is stood in for by documents whose pages
 * are drawn on demand, so what is checked is which pages are drawn and when: only
 * those near the view, the old PDF kept on screen until the new one is drawn, and
 * a page let go once it is far.
 */

const drawn = [];
const released = [];
let pending = null; // a deferred draw, to hold a new PDF back
vi.mock('../lib/notes/pdfjs.js', () => ({
  openPdf: vi.fn(async (bytes) => {
    const name = new TextDecoder().decode(bytes);
    if (name === 'broken') throw new Error('Invalid PDF structure.');
    const [, pages] = name.split(':');
    return {
      name,
      numPages: Number(pages),
      getPage: async () => ({ getViewport: () => ({ width: 612, height: 792 }) }),
      destroy: vi.fn(),
    };
  }),
  drawPage: vi.fn(async (doc, index) => {
    drawn.push(`${doc.name}#${index}`);
    if (pending && doc.name === pending.name) await pending.promise;
    const canvas = document.createElement('canvas');
    canvas.dataset.drawn = `${doc.name}#${index}`;
    return canvas;
  }),
  releaseCanvas: vi.fn((canvas) => {
    if (!canvas) return;
    released.push(canvas.dataset.drawn);
    canvas.remove();
  }),
}));

/** Says which pages are near the view only when a test does. */
class Watch {
  static all = [];
  constructor(callback) { this.callback = callback; this.nodes = new Set(); Watch.all.push(this); }
  observe(node) { this.nodes.add(node); }
  unobserve(node) { this.nodes.delete(node); }
  disconnect() { this.nodes.clear(); }
  static say(index, near) {
    for (const watch of Watch.all) {
      for (const node of watch.nodes) {
        if (Number(node.dataset.page) === index) watch.callback([{ target: node, isIntersecting: near }]);
      }
    }
  }
}
vi.stubGlobal('IntersectionObserver', Watch);

const { default: PagePreview } = await import('./PagePreview.svelte');

const bytes = (name) => new TextEncoder().encode(name).buffer;
const props = $state({ data: null, onpage: vi.fn(), onerror: vi.fn(), onpages: vi.fn() });
let target;
let app;

async function settle() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  flushSync();
}
const onScreen = () => [...target.querySelectorAll('.sheet')].map((sheet) => sheet.querySelector('canvas')?.dataset.drawn ?? '');

beforeEach(() => {
  drawn.length = 0;
  released.length = 0;
  pending = null;
  Watch.all = [];
  target = document.createElement('div');
  document.body.append(target);
  props.data = null;
  app = mount(PagePreview, { target, props });
  flushSync();
});

afterEach(() => {
  unmount(app);
  target.remove();
  vi.clearAllMocks();
});

describe('the pages of a PDF', () => {
  it('draws only the pages near the view, and lets a far one go', async () => {
    props.data = bytes('a:5');
    await settle();
    expect(target.querySelectorAll('.sheet')).toHaveLength(5);
    expect(props.onpages).toHaveBeenCalledWith(5);
    // nothing said yet about the view: the first two
    expect(drawn).toEqual(['a:5#0', 'a:5#1']);
    Watch.say(3, true);
    await settle();
    expect(drawn).toEqual(['a:5#0', 'a:5#1', 'a:5#3']);
    expect(onScreen()).toEqual(['a:5#0', 'a:5#1', '', 'a:5#3', '']);
    Watch.say(3, false);
    await settle();
    expect(released).toContain('a:5#3');
    expect(onScreen()[3]).toBe('');
  });

  it('keeps the pages shown until the new PDF is drawn, then swaps them at once', async () => {
    props.data = bytes('a:2');
    await settle();
    Watch.say(0, true);
    Watch.say(1, true);
    await settle();
    expect(onScreen()).toEqual(['a:2#0', 'a:2#1']);

    let release;
    pending = { name: 'b:3', promise: new Promise((resolve) => { release = resolve; }) };
    props.data = bytes('b:3');
    await settle();
    expect(drawn).toContain('b:3#0');
    expect(onScreen()).toEqual(['a:2#0', 'a:2#1']);
    release();
    await settle();
    expect(onScreen().slice(0, 2)).toEqual(['b:3#0', 'b:3#1']);
    expect(target.querySelectorAll('.sheet')).toHaveLength(3);
    expect(released).toEqual(expect.arrayContaining(['a:2#0', 'a:2#1']));
  });

  it('hands up the page pressed', async () => {
    props.data = bytes('a:3');
    await settle();
    target.querySelectorAll('.sheet .hit')[2].click();
    expect(props.onpage).toHaveBeenCalledWith(2);
  });

  it('says why in one line when the PDF cannot be read', async () => {
    props.data = bytes('broken');
    await settle();
    expect(props.onerror).toHaveBeenCalledWith('The PDF could not be read: Invalid PDF structure.');
  });
});
