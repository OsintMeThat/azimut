// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

/**
 * `/` › Interactive map: the case's layers or one of its plates, and the proofs of a
 * period, picked in one small dialog; Put answers what the map asks the server for.
 */

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));
const { default: NoteMapPicker } = await import('./NoteMapPicker.svelte');

const SOURCES = {
  layers: [{ name: 'Front, north', title: 'Front, north', features: 3, tracked: true }, { name: 'Vehicles', title: 'Vehicles', features: 58, tracked: false }],
  plates: [{ name: 'Losses', title: 'Losses', layers: 2, steps: 8, days: 1 }],
  proofs: { count: 13, first: '2026-10-18', last: '2026-11-15' },
  providers: [{ id: 'esri-world-imagery', label: 'Esri World Imagery' }, { id: 'osm', label: 'OpenStreetMap' }],
  provider: 'esri-world-imagery',
};

let target;
let app;
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.querySelectorAll('.overlay').forEach((node) => node.remove());
  app = null;
});

async function open(sources = SOURCES) {
  target = document.createElement('div');
  document.body.append(target);
  const onput = vi.fn();
  const load = vi.fn(async () => sources);
  app = mount(NoteMapPicker, { target, props: { caseId: 'c1', onput, onclose: vi.fn(), load } });
  flushSync();
  await tick();
  await tick();
  flushSync();
  return { onput, load };
}

const button = (words) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === words);
const rows = () => [...document.querySelectorAll('.map-picker .row')];
const check = (node) => { node.click(); flushSync(); };

describe('the map picker', () => {
  it('reads what the case can map, and puts nothing until something is picked', async () => {
    const { load, onput } = await open();
    expect(load).toHaveBeenCalledWith('c1');
    expect(rows().map((row) => row.textContent.replace(/\s+/g, ' ').trim())).toEqual(['Front, north Over time 3', 'Vehicles 58', 'Proofs 13']);
    expect(button('Put the map').disabled).toBe(true);
    check(rows()[0].querySelector('input'));
    expect(button('Put the map').disabled).toBe(false);
    button('Put the map').click();
    expect(onput).toHaveBeenCalledWith({ title: 'Front, north', layers: ['Front, north'], provider: 'esri-world-imagery' });
  });

  it('puts a plate with the proofs of a period, under the title written', async () => {
    const { onput } = await open();
    check(button('A Map plate'));
    check(rows().find((row) => row.textContent.includes('Losses')).querySelector('input'));
    check(rows().find((row) => row.textContent.includes('Proofs')).querySelector('input'));
    const [from, to] = document.querySelectorAll('.period input');
    expect([from.value, to.value]).toEqual(['2026-10-18', '2026-11-15']);
    const title = document.querySelector('.map-picker input.input');
    title.value = 'Where they were left';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    button('Put the map').click();
    expect(onput).toHaveBeenCalledWith({ title: 'Where they were left', plate: 'Losses', proofs: '2026-10-18..2026-11-15', provider: 'esri-world-imagery' });
  });

  it('offers no plate a case does not hold, and no proofs it has not dated', async () => {
    await open({ ...SOURCES, plates: [], proofs: { count: 0, first: '', last: '' } });
    expect(button('A Map plate').disabled).toBe(true);
    expect(rows().find((row) => row.textContent.includes('Proofs')).querySelector('input').disabled).toBe(true);
  });
});
