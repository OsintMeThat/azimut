// @vitest-environment happy-dom
/**
 * The guide, mounted.
 *
 * `lib/guide.test.js` holds the text to its own rules, fails when a tool joins a
 * workspace undocumented, and decides which section a reader is in. This checks what
 * only a DOM can answer: that every section reaches the page, that a section can be
 * left at the workspace it just described, and that the contents list follows the
 * scroll without fighting the press that started it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const uiState = { tool: 'guide', guideSection: null };
vi.mock('../lib/state.svelte.js', () => ({ uiState }));

const { default: Guide } = await import('./Guide.svelte');
const { GUIDE } = await import('../lib/guide.js');

let live = null;
let target = null;

function open() {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(Guide, { target });
  flushSync();
  return target;
}

const jumps = () => [...target.querySelectorAll('.contents .jump')];
const marked = () => jumps().findIndex((jump) => jump.classList.contains('on'));

/** A scroll of the column the page actually scrolls in. */
function scroll() {
  target.querySelector('.tool-body').dispatchEvent(new Event('scroll'));
  flushSync();
}

beforeEach(() => {
  uiState.tool = 'guide';
  uiState.guideSection = null;
  vi.useFakeTimers();
  // run the measurement on the spot: this DOM has no frames and no layout, and what
  // is under test is the bookkeeping around it rather than the arithmetic
  vi.stubGlobal('requestAnimationFrame', (cb) => {
    cb();
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => {});
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  target = null;
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('the guide on screen', () => {
  it('draws every section it holds, and a contents entry for each', () => {
    open();
    expect(target.querySelectorAll('section')).toHaveLength(GUIDE.length);
    expect(target.querySelectorAll('.contents .jump')).toHaveLength(GUIDE.length);
    for (const section of GUIDE) {
      expect(target.querySelector(`#guide-${section.id}`), section.id).toBeTruthy();
    }
  });

  it('writes every point out, label and body', () => {
    open();
    const text = target.textContent;
    for (const section of GUIDE) {
      expect(text).toContain(section.lead);
      for (const point of section.points ?? []) {
        expect(text).toContain(point.label);
        expect(text).toContain(point.text);
      }
    }
  });

  it('writes the recipes, the keys and the fixes out too', () => {
    open();
    const text = target.textContent;
    for (const section of GUIDE) {
      for (const recipe of section.recipes ?? []) {
        expect(text).toContain(recipe.title);
        for (const step of recipe.steps) expect(text).toContain(step.text);
      }
      for (const group of section.keymap ?? []) {
        expect(text).toContain(group.where);
        for (const key of group.keys) expect(text).toContain(key.combo);
      }
      for (const fix of section.fixes ?? []) {
        expect(text).toContain(fix.symptom);
        expect(text).toContain(fix.fix);
      }
    }
  });

  it('opens the tool a recipe step names, from the step itself', () => {
    // reading how something is done and then hunting for the tab it is done in is
    // exactly the work a guide exists to remove
    open();
    const first = target.querySelector('.recipe .step-tool');
    expect(first.textContent.trim()).toBe('Media');
    first.click();
    flushSync();
    expect(uiState.tool).toBe('media');
  });

  it('lands on the section the topbar mark asked for, and consumes the request', () => {
    uiState.guideSection = 'map';
    open();
    expect(marked()).toBe(GUIDE.findIndex((section) => section.id === 'map'));
    // consumed, so a reader who scrolls away is not sent back next time this tab shows
    expect(uiState.guideSection).toBe(null);
  });

  it('leaves a section at the workspace it describes', () => {
    // a guide you cannot leave at the thing it just explained is a document, not help
    open();
    const map = target.querySelector('#guide-map');
    const open_it = [...map.querySelectorAll('button')].find((b) => b.textContent.includes('Open it'));
    open_it.click();
    flushSync();
    expect(uiState.tool).toBe('satellite');
  });

  it('offers no way out of the section that describes no workspace', () => {
    open();
    const start = target.querySelector('#guide-start');
    expect([...start.querySelectorAll('button')].some((b) => b.textContent.includes('Open it'))).toBe(
      false
    );
  });

  it('marks the contents entry the reader jumped to', () => {
    open();
    expect(marked()).toBe(0);
    jumps()[2].click();
    flushSync();
    expect(marked()).toBe(2);
  });

  it('lets the press own the list while the scroll it started travels', () => {
    // otherwise the one control that says "go here" walks the mark down every section
    // on the way and answers by pointing somewhere else three times first
    open();
    jumps()[2].click();
    flushSync();
    scroll();
    expect(marked()).toBe(2);
  });

  it('follows the column again once the press has landed', () => {
    open();
    jumps()[2].click();
    flushSync();
    vi.advanceTimersByTime(800);
    scroll();
    // this DOM measures every heading at zero, which is also the foot of the column,
    // so the answer is the last section: what is asserted is that it moved at all
    expect(marked()).toBe(jumps().length - 1);
  });

  it('listens on the column rather than the window', () => {
    // the page scrolls inside .tool-body, so a window listener would never fire
    open();
    window.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(marked()).toBe(0);
  });
});
