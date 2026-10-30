// @vitest-environment happy-dom
/** Export, in the Horizon header: the pictures offered, what a photo opens up, keeping a copy. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ExportMenu from './ExportMenu.svelte';

let app;
let host;

function show(props = {}) {
  host = document.createElement('div');
  document.body.append(host);
  app = mount(ExportMenu, { target: host, props: { onexport: vi.fn(), onproof: vi.fn(), ...props } });
  flushSync();
  host.querySelector('.em-open').click();
  flushSync();
}

const rows = () => [...host.querySelectorAll('.em-row')];
const row = (text) => rows().find((el) => el.textContent.includes(text));

afterEach(() => {
  if (app) unmount(app);
  host?.remove();
  app = null;
});

describe('the export menu', () => {
  it('offers the view and the whole turn, and the photo kinds only with a photo', () => {
    show();
    expect(row('This view').disabled).toBe(false);
    expect(row('Whole turn').disabled).toBe(false);
    for (const text of ['Photo beside the terrain', 'Photo above the terrain', 'Blink, photo and terrain', 'Send to Geo Proof']) {
      expect(row(text).disabled).toBe(true);
      expect(row(text).title).toBe('Lay a photo over the view first');
    }
    expect(row('Open in Google Earth')).toBeUndefined();
  });

  const option = (text) => [...host.querySelectorAll('.em-options label')].find((el) => el.textContent.includes(text))?.querySelector('input');

  it('exports the kind picked, signed by default, keeping a copy only once the view is saved and never for a GIF', () => {
    const onexport = vi.fn();
    show({ onexport, photo: true, saved: false });
    expect(option('Keep a copy in the case').disabled).toBe(true);
    expect(option('Sign it Azimut').checked).toBe(true);
    row('Photo beside the terrain').click();
    expect(onexport).toHaveBeenLastCalledWith('row', { keep: false, trace: false, signed: true });
    unmount(app);
    host.remove();

    show({ onexport, photo: true, saved: true });
    option('Keep a copy in the case').click();
    option('Sign it Azimut').click();
    flushSync();
    row('This view').click();
    expect(onexport).toHaveBeenLastCalledWith('view', { keep: true, trace: false, signed: false });
    host.querySelector('.em-open').click();
    flushSync();
    row('Blink, photo and terrain').click();
    expect(onexport).toHaveBeenLastCalledWith('blink', { keep: false, trace: false, signed: false });
  });

  it('offers the skyline traced on the photo only when there is one, left out unless asked', () => {
    show({ photo: true });
    expect(option('Skyline trace')).toBeUndefined();
    unmount(app);
    host.remove();
    const onexport = vi.fn();
    show({ onexport, photo: true, traced: true });
    expect(option('Skyline trace').checked).toBe(false);
    option('Skyline trace').click();
    flushSync();
    row('Photo above the terrain').click();
    expect(onexport).toHaveBeenLastCalledWith('column', { keep: false, trace: true, signed: true });
  });

  it('sends the photo and the terrain to Geo Proof, and opens the same camera in Google Earth', () => {
    const onproof = vi.fn();
    show({ onproof, photo: true, earth: 'https://earth.google.com/web/@1,2,3a,0d,35y,0h,90t,0r' });
    const earth = row('Open in Google Earth');
    expect(earth.getAttribute('href')).toBe('https://earth.google.com/web/@1,2,3a,0d,35y,0h,90t,0r');
    expect(earth.getAttribute('target')).toBe('_blank');
    row('Send to Geo Proof').click();
    expect(onproof).toHaveBeenCalled();
  });

  it('waits while a picture is being drawn', () => {
    host = document.createElement('div');
    document.body.append(host);
    app = mount(ExportMenu, { target: host, props: { busy: 'turn' } });
    flushSync();
    expect(host.querySelector('.em-open').disabled).toBe(true);
    expect(host.querySelector('.em-spin')).not.toBeNull();
  });
});
