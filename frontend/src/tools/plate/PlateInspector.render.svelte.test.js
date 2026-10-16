// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateInspector from './PlateInspector.svelte';
import { houseLayout } from '../../lib/plate/page.js';

let held = null;
beforeEach(() => { vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date('2026-10-20T12:00:00Z')); });
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; vi.useRealTimers(); });

function show({ element = {}, at = '2026-10-05', moments = ['2026-10-03', '2026-10-05'], kind = 'text' } = {}) {
  const spec = $state(houseLayout());
  spec.elements.push({ id: 'note', kind, box: [10, 10, 40, 10], text: 'Depot', ...element });
  held = mount(PlateInspector, { target: document.body, props: { spec, selection: ['note'], at, moments } });
  flushSync();
  return spec.elements.at(-1);
}
const end = (name) => document.body.querySelector(`button[aria-label="${name}"]`);
const press = (button) => { button.click(); flushSync(); };
const act = (text) => [...document.body.querySelectorAll('.days button')].find((button) => button.textContent.trim() === text);

describe('the days an annotation is shown on', () => {
  it('says its first and last day, and stretches them to the plate\'s day', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-03' } });
    expect(end('First day shown').textContent).toContain('3 Oct 2026');
    expect(end('Last day shown').textContent).toContain('3 Oct 2026');
    expect(document.body.querySelector('.days').classList.contains('off')).toBe(true);
    press(act('Show it on 5 Oct 2026'));
    expect([note.onward, note.until]).toEqual(['2026-10-03', '2026-10-05']);
    expect(document.body.querySelector('.days').classList.contains('off')).toBe(false);
  });

  it('takes either end from a calendar of any day, or opens it to the start or to the end', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-05' } });
    press(end('Last day shown'));
    press(document.body.querySelector('button[title="2026-10-12"]'));
    expect(note.until).toBe('2026-10-12');
    expect(document.body.querySelector('button[title="2026-10-12"]')).toBeNull();
    press(end('First day shown'));
    press(act('The start'));
    expect(note.onward).toBeNull();
    expect(end('First day shown').textContent).toContain('The start');
    press(end('Last day shown'));
    press(act('The end'));
    expect(note.until).toBeNull();
    expect(end('Last day shown').textContent).toContain('The end');
  });

  it('pulls the other end along rather than crossing it', () => {
    const note = show({ element: { onward: '2026-10-03', until: '2026-10-05' } });
    press(end('First day shown'));
    press(document.body.querySelector('button[title="2026-10-09"]'));
    expect([note.onward, note.until]).toEqual(['2026-10-09', '2026-10-09']);
    press(end('Last day shown'));
    press(act('This day'));
    expect([note.onward, note.until]).toEqual(['2026-10-05', '2026-10-05']);
  });

  it('is offered only for what stands on a played plate', () => {
    show({ kind: 'legend' });
    expect(end('First day shown')).toBeNull();
    unmount(held); held = null; document.body.innerHTML = '';
    show({ moments: [] });
    expect(end('First day shown')).toBeNull();
  });
});

describe('what belongs to a step', () => {
  function onStep(element) {
    const spec = $state(houseLayout());
    spec.steps = { '2026-10-05': [{ id: 's1', duration: 3 }] };
    spec.elements.push({ id: 'note', box: [10, 10, 40, 10], text: 'Depot', ...element });
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: ['note'], at: '2026-10-05', moments: ['2026-10-05'],
      place: { steps: ['s1'], index: 0 }, step: { id: 's1', name: 'Strike' }, caseId: 'c1' } });
    flushSync();
    return spec.elements.at(-1);
  }

  it('is shown on its step, or carried to the steps after it, or put back on the whole day', () => {
    const note = onStep({ kind: 'text', step: 's1' });
    press(act('And after'));
    expect(note.carry).toBe(true);
    press([...document.body.querySelectorAll('.days button')].find((button) => button.textContent === 'Put it on the whole day'));
    expect([note.step, note.onward, note.until]).toEqual([null, '2026-10-05', '2026-10-05']);
    // back on the day, it can be sent to the step shown
    press([...document.body.querySelectorAll('button')].find((button) => button.textContent === 'Only on Strike'));
    expect([note.step, note.carry, note.onward]).toEqual(['s1', false, null]);
  });

  it('sets a video\'s clip by its times, its sound and its source line', () => {
    const video = onStep({ kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [0, 10], caption: true, text: 'GeoWatch · x.com', sound: false });
    expect(document.body.textContent).toContain('which runs as long as the clip');
    const start = document.body.querySelector('input[aria-label="Clip start"]');
    start.value = '1:05'; start.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    // an end that came before the new start is moved after it
    expect(video.clip).toEqual([65, 75]);
    const end = document.body.querySelector('input[aria-label="Clip end"]');
    end.value = 'later'; end.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(video.clip).toEqual([65, 75]);
    expect(end.value).toBe('1:15');
    expect(document.body.querySelector('input[aria-label="Volume"]')).toBeNull();
    const sound = [...document.body.querySelectorAll('label.check')].find((label) => label.textContent.includes('In the video')).querySelector('input');
    sound.click(); flushSync();
    expect(video.sound).toBe(true);
    expect(document.body.querySelector('input[aria-label="Volume"]')).not.toBeNull();
    expect(document.body.querySelector('input[aria-label="Source line"]').value).toBe('GeoWatch · x.com');
    // a video stays upright: the clip is laid in its box as it is
    expect(document.body.querySelector('input[aria-label="Rotation"]')).toBeNull();
  });
});

describe('a symbol on the map', () => {
  it('offers the states a layer\'s marker offers, worded alike, nothing said first', () => {
    const symbol = show({ kind: 'symbol', element: { symbol: 'pin', status: '' } });
    const states = [...document.body.querySelectorAll('[aria-label="Symbol state"] button')];
    expect(states.map((button) => [button.textContent, button.title])).toEqual([
      ['–', 'No damage said, drawn plain'], ['Damaged', 'Drawn with a stroke across it'], ['Destroyed', 'Drawn with a cross over it']]);
    expect(states[0].getAttribute('aria-pressed')).toBe('true');
    press(states[2]);
    expect(symbol.status).toBe('destroyed');
    expect([...document.body.querySelectorAll('.rows .key')].filter((key) => ['Symbol', 'Size', 'State'].includes(key.textContent))
      .every((key) => key.title)).toBe(true);
  });
});

describe('hover help on every setting', () => {
  // what the pointer can rest on: every field, every chooser, every row's key and every button
  const settings = () => [...document.body.querySelectorAll('.inspector :is(select, input:not([type="file"]), textarea, [role="group"], .key, button.btn)')];
  const bare = () => settings().filter((node) => !node.closest('[title]')?.getAttribute('title'))
    .map((node) => node.getAttribute('aria-label') || node.textContent.trim() || node.outerHTML.slice(0, 60));
  const settle = async () => { for (let i = 0; i < 4; i += 1) await Promise.resolve(); flushSync(); };

  it.each([
    'text', 'label', 'credits', 'key', 'table', 'qr', 'timeline', 'legend', 'scale', 'north', 'signature', 'brand', 'image', 'shape',
  ])('says what each setting of a %s does', async (kind) => {
    const of = kind === 'legend' || kind === 'scale' || kind === 'north' || kind === 'credits' ? { of: 'map' } : {};
    show({ kind, element: { ...of, border: true, style: 'bubble', at: kind === 'label' ? [2.3, 48.8] : undefined, ...(kind === 'label' ? { of: 'map' } : {}) } });
    await settle();
    expect(settings().length).toBeGreaterThan(3);
    expect(bare()).toEqual([]);
  });

  it('says what each setting of a video does', async () => {
    show({ kind: 'video', element: { step: 's1', src: 'media/strike.mp4', clip: [0, 8], sound: true, caption: true } });
    await settle();
    expect(settings().length).toBeGreaterThan(8);
    expect(bare()).toEqual([]);
  });

  it('finds a setting left without its words', async () => {
    show({ kind: 'text' });
    await settle();
    const stray = document.createElement('select');
    document.body.querySelector('.inspector .flow').append(stray);
    await settle();
    expect(bare()).toHaveLength(1);
  });

  it.each(['arrow', 'measure', 'ring', 'cone', 'zone', 'line', 'symbol'])('says what each setting of a %s on the map does', async (kind) => {
    show({ kind, element: { of: 'map', at: [2.3, 48.8], to: [2.4, 48.9], points: [[2.3, 48.8], [2.4, 48.9], [2.35, 48.95]], heads: 'end', mask: { on: true } } });
    await settle();
    expect(bare()).toEqual([]);
  });

  it('says what each setting of a map, its ground, imagery and layers does, and of the page', async () => {
    const spec = $state(houseLayout());
    const map = spec.elements.find((element) => element.kind === 'map');
    map.grid = 'latlon';
    map.terrain = 1.5;
    const rows = [{ name: 'front', title: 'Front', categories: [{ name: 'Lines' }] }];
    map.layers = [{ name: 'front', hidden: [], stroke: 1, icons: 1 }];
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [map.id], rows, grounds: [['plain', 'Plain'], ['esri-world-imagery', 'Imagery']] } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
    map.basemap = 'esri-world-imagery'; flushSync(); await settle();
    expect(bare()).toEqual([]);
    unmount(held); held = null; document.body.innerHTML = '';
    spec.transitions = { on: true };
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: [], plays: true } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
    unmount(held); held = null; document.body.innerHTML = '';
    held = mount(PlateInspector, { target: document.body, props: { spec, selection: spec.elements.slice(-3).map((element) => element.id) } });
    flushSync(); await settle();
    expect(bare()).toEqual([]);
  });

  it('says it in the words kept for it, and follows a setting whose name changes', async () => {
    show({ kind: 'text' });
    await settle();
    expect(document.body.querySelector('[aria-label="Letter spacing"]').getAttribute('title')).toBe('Space between the letters');
    // a key says what the control beside it does
    const key = [...document.body.querySelectorAll('.key')].find((node) => node.textContent === 'Spacing');
    expect(key.getAttribute('title')).toBe('Space between the letters');
  });
});
