// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import CustomLayerForm from './CustomLayerForm.svelte';
import { draftForm } from './customLayerForm.fixture.svelte.js';
import { compositeScript } from '../lib/layerScripts.js';

/**
 * The one form both Settings and the map picker open. What it must get right is
 * what a user cannot undo: a name already filed under something else, a script
 * the backend would refuse, a data source that cannot answer, and the
 * difference between a Preview the map can draw and a Save that changes what
 * every capture renders.
 *
 * The draft is the caller's object, not the form's, so these tests make one the
 * way the callers do and read it back afterwards.
 */

let live;
let target;
let form;

function open({
  layer = null,
  bases = ['TRUE_COLOR', 'SWIR'],
  bands = [],
  radarLayer = '',
  ...props
} = {}) {
  form = draftForm({ layer, bases, bands, radarLayer });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(CustomLayerForm, {
    target,
    props: { form, bases, bands, onsave: vi.fn(), oncancel: vi.fn(), ...props },
  });
  flushSync();
  return target;
}

function reopen(props = {}) {
  unmount(live);
  live = null;
  target.remove();
  return open(props);
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  form = null;
});

const button = (root, label) =>
  [...root.querySelectorAll('button')].find((node) => node.textContent.trim().startsWith(label));

it('opens on the composite form, which already renders something', () => {
  const root = open();
  // the SWIR composite the hot-spot panels are made of
  expect(root.querySelector('[aria-label="Red band"]').value).toBe('B12');
  expect(root.querySelector('textarea')).toBeNull();
  // nothing is saveable until it is named
  expect(button(root, 'Save layer').disabled).toBe(true);
});

it('names each band by what it sees, not just by its number', () => {
  const root = open({ bands: ['B11', 'B12'] });
  const options = [...root.querySelector('[aria-label="Red band"]').options].map((n) => n.text);
  // "B12" says nothing about why you would pick it; the wavelength does, and it
  // is how a figure's caption names it
  expect(options).toContain('B11 · Short-wave infrared 1 · 1.61 µm');
  expect(options).toContain('B12 · Short-wave infrared 2 · 2.19 µm');
});

it('never starts on the radar layer as a Sentinel-2 data source', () => {
  // a configuration that has one often lists it first, and a script reading
  // Sentinel-2 bands through it renders nothing at all
  open({ bases: ['RADAR', 'TRUE_COLOR'], radarLayer: 'RADAR' });
  expect(form.base).toBe('TRUE_COLOR'); // the layer every setup guide builds
});

it('falls back to a usable source when true colour is not configured', () => {
  open({ bases: ['RADAR', 'VEGETATION_INDEX'], radarLayer: 'RADAR' });
  expect(form.base).toBe('VEGETATION_INDEX');
});

it('explains every control rather than naming it', () => {
  const root = open();
  expect(root.textContent).toContain('needs multiplying to fill a channel');
  expect(root.textContent).toContain('satellite data this reads');
  button(root, 'Index').click();
  flushSync();
  expect(root.textContent).toContain('a number from −1 to 1');
  expect(root.textContent).toContain('picks its colour along that bar');
  expect(root.textContent).toContain('hides everything under it');
});

it('shows the ramp instead of only naming it', () => {
  const root = open();
  button(root, 'Index').click();
  flushSync();
  const bar = root.querySelector('.ramp-bar');
  expect(bar.getAttribute('aria-label')).toContain('Vegetation');
  expect(bar.getAttribute('style')).toContain('linear-gradient');
});

it('keeps an existing layer’s name and data source, since everything is filed under them', () => {
  const root = open({
    layer: {
      id: 'PLUME_SWIR', label: 'Plume', base: 'SWIR', hint: 'hot spots', script: '//VERSION=3',
    },
  });
  expect(root.querySelector('[aria-label="Layer name"]').disabled).toBe(true);
  expect(root.querySelector('[aria-label="Layer to read data from"]').disabled).toBe(true);
  expect(root.querySelector('textarea').value).toBe('//VERSION=3');
  expect(button(root, 'Save changes')).toBeDefined();
});

it('refuses a name the configuration already serves, and says so', () => {
  const root = open({ taken: ['SWIR'] });
  const name = root.querySelector('[aria-label="Layer name"]');
  name.value = 'SWIR';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(target.textContent).toContain('already a layer');
  expect(button(root, 'Save layer').disabled).toBe(true);
  expect(button(root, 'Save layer').title).toContain('already a layer');
});

it('lets the last action speak over what is still missing', () => {
  // a preview needs no name, so nagging for one would answer the wrong question
  const root = open({ onpreview: vi.fn(), note: 'Drawn on the map.' });
  expect(root.textContent).toContain('Drawn on the map.');
  expect(root.textContent).not.toContain('Name the layer.');
  // and Save still says why it cannot be pressed
  expect(button(root, 'Save layer').title).toBe('Name the layer.');
});

it('hands back what was typed, once it is saveable', () => {
  const onsave = vi.fn();
  const root = open({ onsave });
  const name = root.querySelector('[aria-label="Layer name"]');
  name.value = 'plume swir';
  name.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(name.value).toBe('PLUME_SWIR'); // typed into the only shape a name has
  button(root, 'Save layer').click();
  flushSync();
  expect(onsave).toHaveBeenCalledWith(
    expect.objectContaining({ id: 'PLUME_SWIR', base: 'TRUE_COLOR' })
  );
});

it('only offers a preview where there is a map to draw it on', () => {
  expect(button(open(), 'Preview')).toBeUndefined();
  expect(button(reopen({ onpreview: vi.fn() }), 'Preview')).toBeDefined();
});

it('previews without a name, because nothing is being filed yet', () => {
  const onpreview = vi.fn();
  const root = open({ onpreview });
  expect(button(root, 'Preview').disabled).toBe(false);
  button(root, 'Preview').click();
  flushSync();
  const expected = compositeScript({ red: 'B12', green: 'B11', blue: 'B04' });
  expect(onpreview).toHaveBeenCalledWith(expect.objectContaining({ script: expected }));
});

it('will not send a script past the budget', () => {
  const root = open({ scriptMax: 20, onpreview: vi.fn() });
  button(root, 'Custom script').click();
  flushSync();
  const script = root.querySelector('textarea');
  script.value = 'x'.repeat(40);
  script.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
  expect(button(root, 'Preview').disabled).toBe(true);
  expect(target.textContent).toContain('40/20');
});

it('offers the bands the backend named, and falls back to the common ones', () => {
  const only = open({ bands: ['B02', 'B08'] });
  expect([...only.querySelector('[aria-label="Red band"]').options].map((n) => n.value)).toEqual([
    'B02',
    'B08',
  ]);
  // never an empty picker while the list is still being read
  const fallback = reopen();
  expect([...fallback.querySelector('[aria-label="Red band"]').options].length).toBeGreaterThan(3);
});

it('hands the generated script over on the way to Custom script', () => {
  // the arithmetic of each form is covered in lib/layerScripts.test.js; what is
  // worth pinning here is that leaving a form keeps what it wrote
  const root = open({ onpreview: vi.fn() });
  button(root, 'Custom script').click();
  flushSync();
  const carried = root.querySelector('textarea').value;
  expect(carried).toContain('//VERSION=3');
  expect(carried).toContain('2.5 * p.B12');
});

it('starts a composite or an index from the figures people publish', () => {
  const root = open();
  button(root, 'Natural').click();
  flushSync();
  expect(form.composite.red).toBe('B04');
  expect(form.hint).toBe('What the eye would see');

  button(root, 'Index').click();
  flushSync();
  button(root, 'NBR').click();
  flushSync();
  expect([form.index.high, form.index.low]).toEqual(['B08', 'B12']);
  expect(form.index.rampId).toBe('heat');
});

it('shows what an index is, and writes one', () => {
  const root = open({ onpreview: vi.fn() });
  button(root, 'Index').click();
  flushSync();
  expect(root.textContent).toContain('(A − B) / (A + B)');
  button(root, 'Custom script').click();
  flushSync();
  const script = root.querySelector('textarea').value;
  expect(script).toContain('(p.B08 - p.B04) / sum');
  expect(script).toContain('function colour(');
});

it('opens a saved layer on its script, not on a form that never wrote it', () => {
  const root = open({ layer: { id: 'X', base: 'TRUE_COLOR', script: '//VERSION=3\nmine\n' } });
  expect(root.querySelector('textarea').value).toBe('//VERSION=3\nmine\n');
  // and the forms are still there to start over from
  expect(button(root, 'Composite')).toBeDefined();
});

it('writes into the caller’s draft, so closing the form does not lose it', () => {
  const root = open();
  const label = root.querySelector('[aria-label="Label"]');
  label.value = 'SWIR plume';
  label.dispatchEvent(new Event('input', { bubbles: true }));
  button(root, 'Index').click();
  flushSync();
  // the caller holds this object and can hand it back to a fresh form
  expect(form.label).toBe('SWIR plume');
  expect(form.way).toBe('index');
});
