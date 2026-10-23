// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(async () => []) } }));

const { uiState } = await import('../lib/state.svelte.js');
const { default: GuideDialog } = await import('./GuideDialog.svelte');
const { JOURNEYS, KEYMAP, FIXES, PAGES } = await import('../lib/guide.js');

let live;
let onclose;

async function open(at) {
  onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(GuideDialog, { target, props: { at, onclose } });
  flushSync();
  await Promise.resolve();
}

const entry = (label) => [...document.querySelectorAll('.menu .entry')].find((b) => b.textContent.trim() === label);
const current = (selector) => document.querySelector(`${selector}[aria-current]`)?.textContent.trim();
const lines = () => [...document.querySelectorAll('.legend .mark')];
const frames = () => [...document.querySelectorAll('.frame')];
const pins = () => [...document.querySelectorAll('.pin')];
const press = (node) => {
  node.click();
  flushSync();
};
function hover(node, on = true) {
  node.dispatchEvent(new MouseEvent(on ? 'mouseenter' : 'mouseleave'));
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('the guide over a tool', () => {
  it('opens on the tab of the tool it was asked from, its picture numbered', async () => {
    await open('media');
    expect(current('.menu .entry')).toBe('Sources');
    expect(current('.tabs .tab')).toBe('Media');
    expect(document.querySelector('.shot img')).not.toBeNull();
    expect(lines()).toHaveLength(PAGES.media.marks.length);
    expect(pins().map((pin) => pin.textContent.trim())).toEqual(PAGES.media.marks.map((_, i) => String(i + 1)));
  });

  it('shows only its numbers at rest, so no frame crosses another', async () => {
    await open('media');
    expect(document.querySelector('.frame.on')).toBeNull();
    expect(document.querySelector('.veil').classList.contains('on')).toBe(false);
  });

  it('rings the control of the line being read, names it by its number and dims the rest', async () => {
    await open('media');
    hover(lines()[3]);
    const lit = document.querySelectorAll('.frame.on');
    expect(lit).toHaveLength(1);
    expect(document.querySelector('.veil').classList.contains('on')).toBe(true);
    expect(document.querySelector('.shot .name').textContent).toBe(PAGES.media.marks[3].title);
    expect(pins().map((pin) => pin.classList.contains('dim'))).toEqual([true, true, true, false, true]);
    hover(lines()[3], false);
    expect(frames().some((frame) => frame.classList.contains('on'))).toBe(false);
    expect(document.querySelector('.shot .name')).toBeNull();
  });

  it('lights the line from its number on the picture too', async () => {
    await open('media');
    hover(pins()[1]);
    expect(document.querySelectorAll('.legend li')[1].classList.contains('on')).toBe(true);
  });

  it('lists the subtleties under the picture', async () => {
    await open('media');
    expect([...document.querySelectorAll('.tip strong')].map((t) => t.textContent)).toEqual(
      PAGES.media.tips.map((tip) => tip.title)
    );
  });

  it('opens the tool it explains, and closes', async () => {
    await open('media');
    uiState.tool = 'settings';
    press(document.querySelector('.go'));
    expect(uiState.tool).toBe('media');
    expect(onclose).toHaveBeenCalled();
  });
});

describe('a number that leads somewhere', () => {
  it('shows the screen its control opens, with the way back', async () => {
    await open('media');
    const leads = pins().filter((pin) => pin.classList.contains('leads'));
    expect(leads).toHaveLength(1);
    press(leads[0]);
    expect(document.querySelector('.trail').textContent).toContain('Open in…');
    expect(document.querySelector('.lead').textContent).toBe(PAGES.media.marks[4].opens.lead);
    expect(lines()).toHaveLength(1);
    press(document.querySelector('.trail button'));
    expect(document.querySelector('.trail')).toBeNull();
    expect(lines()).toHaveLength(PAGES.media.marks.length);
  });

  it('is offered from the line as well as from the number', async () => {
    await open('satellite');
    const offers = [...document.querySelectorAll('.legend .leads')];
    expect(offers.length).toBe(PAGES.satellite.marks.filter((mark) => mark.opens).length);
    press(offers[0]);
    expect(document.querySelector('.trail')).not.toBeNull();
  });

  it('forgets the trail when another tab is picked', async () => {
    await open('media');
    press(pins().find((pin) => pin.classList.contains('leads')));
    press([...document.querySelectorAll('.tabs .tab')].find((tab) => tab.textContent.trim() === 'Files'));
    expect(document.querySelector('.trail')).toBeNull();
    expect(current('.tabs .tab')).toBe('Files');
  });
});

describe('a journey', () => {
  it('walks its steps on the picture of each tool, with only that step’s frames', async () => {
    const journey = JOURNEYS[0];
    await open(`journey:${journey.id}`);
    expect([...document.querySelectorAll('.steps .step')]).toHaveLength(journey.steps.length);
    expect(document.querySelector('.lead').textContent).toBe(journey.steps[0].text);
    expect(lines()).toHaveLength(journey.steps[0].marks.length);
    press([...document.querySelectorAll('.walk button')].find((b) => b.textContent.includes('Next')));
    expect(document.querySelector('.lead').textContent).toBe(journey.steps[1].text);
    expect(document.querySelector('.go').textContent).toContain('Inspect');
    // a step reads one control at a time, so nothing in it leads elsewhere
    expect(document.querySelector('.legend .leads')).toBeNull();
  });

  it('is reached from a tool at the step it is used at', async () => {
    await open('satellite');
    const link = [...document.querySelectorAll('.journey')].find((b) => b.textContent.includes('Geolocate a photo'));
    press(link);
    expect(current('.menu .entry')).toBe('Geolocate a photo');
    expect(current('.steps .step')).toContain('Satellite');
  });
});

describe('the reference', () => {
  it('lists every key by where it is pressed', async () => {
    await open('start');
    press(entry('Shortcuts'));
    expect([...document.querySelectorAll('.keys h3')].map((h) => h.textContent)).toEqual(KEYMAP.map((g) => g.where));
    expect(document.querySelectorAll('.keys kbd').length).toBe(KEYMAP.flatMap((g) => g.keys).length);
  });

  it('answers every symptom', async () => {
    await open('start');
    press(entry('When something does not work'));
    expect(document.querySelectorAll('.fixes .card-block')).toHaveLength(FIXES.length);
  });

  it('opens Settings on its own page from the gear', async () => {
    await open('settings');
    expect(current('.menu .entry')).toBe('Settings');
    expect(document.querySelector('.tabs')).toBeNull();
  });
});

describe('the way out', () => {
  it('closes from its own header', async () => {
    await open('media');
    press(document.querySelector('.head button[aria-label="Close"]'));
    expect(onclose).toHaveBeenCalled();
  });
});
