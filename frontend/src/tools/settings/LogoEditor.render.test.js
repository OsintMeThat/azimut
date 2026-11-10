// @vitest-environment happy-dom
/**
 * Settings › Publishing › Logo: a picked logo opens the logo editor, Edit… opens it
 * on the picture as picked, and a logo nobody framed comes back byte for byte.
 */
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

const mocks = vi.hoisted(() => ({
  api: { get: vi.fn(), post: vi.fn(), del: vi.fn() },
  toast: vi.fn(),
  render: vi.fn(),
}));
vi.mock('../../lib/api.js', () => ({ api: mocks.api }));
vi.mock('../../lib/state.svelte.js', () => ({
  prefs: { reportName: '', reportRole: '', reportOrganisation: '', signatureSet: false, picturesRev: 0 },
  toast: mocks.toast,
}));
vi.mock('../../lib/logoLook.js', async (real) => ({ ...(await real()), renderLogo: mocks.render }));

const { default: LogoEditor } = await import('./LogoEditor.svelte');
const { default: PublishingTab } = await import('./PublishingTab.svelte');

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const FRAMED = new Blob(['framed'], { type: 'image/png' });

/** A picture that opens at once, 400 × 200, as happy-dom decodes none. */
class OpenedImage {
  naturalWidth = 400;
  naturalHeight = 200;
  set src(_url) { queueMicrotask(() => this.onload?.()); }
}

let held;
beforeEach(() => {
  vi.stubGlobal('Image', OpenedImage);
  URL.createObjectURL = vi.fn(() => 'blob:picture');
  URL.revokeObjectURL = vi.fn();
  mocks.render.mockResolvedValue(FRAMED);
});
afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

async function settle() {
  for (let round = 0; round < 6; round++) { await tick(); await Promise.resolve(); }
  flushSync();
}

async function editor(props) {
  held = mount(LogoEditor, { target: document.body, props: { onclose: vi.fn(), ...props } });
  await settle();
}

const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const slider = (id) => document.getElementById(id);
function slide(id, value) {
  const input = slider(id);
  input.value = String(value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

it('hands back the very picture it was given when nothing is framed', async () => {
  const picture = new Blob([PNG], { type: 'image/png' });
  const onsave = vi.fn(async () => {});
  await editor({ picture, onsave });
  button('Save').click();
  await settle();
  expect(onsave).toHaveBeenCalledWith({ logo: picture, look: null });
  expect(mocks.render).not.toHaveBeenCalled();
});

it('draws a framed logo and hands back the look it was drawn with', async () => {
  const onsave = vi.fn(async () => {});
  await editor({ picture: new Blob([PNG]), onsave });
  button('Circle').click();
  flushSync();
  slide('logo-frame', 0.05);
  document.querySelector('[aria-label="Frame colour: Azimut amber"]').click();
  document.querySelector('[aria-label="Background: White"]').click();
  flushSync();
  button('Save').click();
  await settle();
  const look = mocks.render.mock.calls[0][1];
  expect(look).toMatchObject({ shape: 'circle', border: 0.05, colour: '#e8a33d', fill: '#ffffff' });
  expect(onsave).toHaveBeenCalledWith({ logo: FRAMED, look });
});

it('shows the corners only for a rounded shape', async () => {
  await editor({ picture: new Blob([PNG]), onsave: vi.fn() });
  expect(slider('logo-corners')).toBeNull();
  button('Rounded').click();
  flushSync();
  expect(slider('logo-corners')).not.toBeNull();
});

it('opens on the look it was saved with, and starts over from the picture as picked', async () => {
  const onsave = vi.fn(async () => {});
  await editor({ picture: new Blob([PNG]), look: { shape: 'circle', border: 0.1, colour: '#112233' }, onsave });
  expect(button('Circle').getAttribute('aria-pressed')).toBe('true');
  expect(Number(slider('logo-frame').value)).toBe(0.1);
  button('Start over').click();
  flushSync();
  expect(button('Rectangle').getAttribute('aria-pressed')).toBe('true');
  expect(button('Start over').disabled).toBe(true);
  button('Save').click();
  await settle();
  expect(onsave.mock.calls[0][0].look).toBeNull();
});

it('moves the picture with the arrow keys', async () => {
  const onsave = vi.fn(async () => {});
  await editor({ picture: new Blob([PNG]), onsave });
  const view = document.querySelector('canvas');
  view.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
  view.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
  flushSync();
  button('Save').click();
  await settle();
  expect(mocks.render.mock.calls[0][1]).toMatchObject({ x: 0.02, y: -0.1 });
});

it('says why a save failed and stays open', async () => {
  const onclose = vi.fn();
  await editor({ picture: new Blob([PNG]), onsave: vi.fn(async () => { throw new Error('signature must be a PNG image'); }), onclose });
  button('Save').click();
  await settle();
  expect(document.querySelector('[role="alert"]').textContent).toBe('Could not save the logo: signature must be a PNG image');
  expect(onclose).not.toHaveBeenCalled();
  expect(button('Save').disabled).toBe(false);
});

// ---- in the tab ----------------------------------------------------------------

async function tab(props = {}) {
  const saveLogo = vi.fn(async () => {});
  held = mount(PublishingTab, {
    target: document.body,
    props: { signature: true, savePrefs: vi.fn(), removeSignature: vi.fn(), saveLogo, ...props },
  });
  await settle();
  return saveLogo;
}

it('edits a logo saved before the editor from the logo itself, and keeps it as it was', async () => {
  mocks.api.get.mockResolvedValue({ data: PNG.buffer });
  const saveLogo = await tab({ logoLook: null });
  button('Edit…').click();
  await settle();
  expect(mocks.api.get).toHaveBeenCalledWith('/api/settings/signature.png', { bytes: true, cache: 'no-store' });
  button('Save').click();
  await settle();
  const { logo, original, look } = saveLogo.mock.calls[0][0];
  expect(look).toBeNull();
  expect(logo).toBe(original);
  expect(new Uint8Array(await logo.arrayBuffer())).toEqual(PNG);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('edits a framed logo from the picture it was drawn from, never over its frame', async () => {
  mocks.api.get.mockResolvedValue({ data: PNG.buffer });
  const look = { shape: 'rounded', radius: 0.3, border: 0.02, colour: '#ffffff', fill: '', padding: 0, zoom: 1, x: 0, y: 0 };
  const saveLogo = await tab({ logoLook: look });
  button('Edit…').click();
  await settle();
  expect(mocks.api.get).toHaveBeenCalledWith('/api/settings/logo-original.png', { bytes: true, cache: 'no-store' });
  expect(button('Rounded').getAttribute('aria-pressed')).toBe('true');
  button('Save').click();
  await settle();
  const saved = saveLogo.mock.calls[0][0];
  expect(saved.logo).toBe(FRAMED);
  expect(new Uint8Array(await saved.original.arrayBuffer())).toEqual(PNG);
  expect(saved.look).toMatchObject({ shape: 'rounded', radius: 0.3 });
});

it('cancels without saving anything', async () => {
  mocks.api.get.mockResolvedValue({ data: PNG.buffer });
  const saveLogo = await tab();
  button('Edit…').click();
  await settle();
  button('Cancel').click();
  await settle();
  expect(saveLogo).not.toHaveBeenCalled();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it('opens the editor on a picked PNG, and turns away what is no PNG', async () => {
  await tab({ signature: false });
  expect(button('Edit…')).toBeUndefined();
  const input = document.querySelector('input[type="file"][accept="image/png"]');
  const pick = (file) => {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  pick(new File(['GIF89a, not a png'], 'logo.png', { type: 'image/png' }));
  await settle();
  expect(mocks.toast).toHaveBeenCalledWith('The logo must be a PNG picture', 'danger');
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  pick(new File([PNG], 'logo.png', { type: 'image/png' }));
  await settle();
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
});
