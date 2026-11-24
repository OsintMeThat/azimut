// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * One press of an engine button, for Reverse Search and Inspect's zone search
 * alike. The road is chosen before anything is awaited, since the button is a real
 * link; the extension's road copies first and falls back to the two gestures on
 * any refusal.
 */

const toast = vi.fn();
vi.mock('./state.svelte.js', () => ({ toast }));
const handOffReverse = vi.fn();
vi.mock('./extBridge.js', () => ({ handOffReverse }));

const { MAX_HANDOFF_BYTES, UPLOAD_PAGES } = await import('./reverseSearch.js');
const { copyPicture, engineRoad, filledEngines, pressEngine } = await import('./reverseHandoff.js');

const engine = (id) => UPLOAD_PAGES.find((e) => e.id === id);
const LENS = engine('google');
const YANDEX = engine('yandex');

let written;
let opened;
let downloads;

function picture(blob = new Blob(['png'], { type: 'image/png' })) {
  return { png: vi.fn(() => Promise.resolve(blob)), name: 'reverse-clip-zone.png', what: 'zone' };
}

const press = () => ({ preventDefault: vi.fn() });
const settle = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};

beforeEach(() => {
  written = [];
  opened = [];
  downloads = [];
  toast.mockReset();
  handOffReverse.mockReset();
  globalThis.ClipboardItem = class {
    constructor(items) {
      this.items = items;
    }
  };
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { write: vi.fn(async (items) => written.push(...items)) },
  });
  vi.spyOn(window, 'open').mockImplementation((url) => opened.push(url));
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:zone');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
    downloads.push(this.download);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('which engines a press fills', () => {
  it('fills only with the extension there and the switch on', () => {
    expect(filledEngines(true, '1.0.0')).toEqual(UPLOAD_PAGES.filter((e) => e.fill));
    expect(filledEngines(false, '1.0.0')).toEqual([]);
    expect(filledEngines(true, null)).toEqual([]);
  });

  it('keeps an engine it cannot fill on its old road', () => {
    expect(engineRoad(LENS, [LENS])).toBe('fill');
    expect(engineRoad(LENS, [])).toBe('paste');
    expect(engineRoad(YANDEX, [])).toBe('drag');
  });
});

describe('a press without the extension', () => {
  it('lets the link open the paste engine and puts the picture on the clipboard', async () => {
    const event = press();
    const pic = picture();
    pressEngine(event, LENS, pic, []);
    await settle();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(pic.png).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    expect(toast.mock.calls[0][0]).toMatch(/^Copied the zone\. Paste it in the tab with/);
  });

  it('lets the link open the drag engine and saves the picture under its name', async () => {
    const event = press();
    pressEngine(event, YANDEX, picture(), []);
    await settle();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(downloads).toEqual(['reverse-clip-zone.png']);
    expect(toast).toHaveBeenCalledWith('Saved the zone. Drag it into the tab', 'ok', 4500);
  });

  it('says so when the picture could not be made', async () => {
    const pic = { png: () => Promise.reject(new Error('render failed')), name: 'x.png', what: 'zone' };
    pressEngine(press(), YANDEX, pic, []);
    await settle();
    expect(downloads).toEqual([]);
    expect(toast).toHaveBeenCalledWith('render failed', 'warn');
  });
});

describe('a press the extension fills', () => {
  it('stops the link, copies once and hands the picture over', async () => {
    handOffReverse.mockResolvedValue(true);
    const event = press();
    const pic = picture();
    pressEngine(event, LENS, pic, [LENS]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    await settle();
    await vi.waitFor(() => expect(handOffReverse).toHaveBeenCalledTimes(1));
    expect(pic.png).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    const [payload] = handOffReverse.mock.calls[0];
    expect(payload.url).toBe(LENS.url);
    expect(payload.image).toMatchObject({ name: 'reverse-clip-zone.png', type: 'image/png' });
    expect(atob(payload.image.data)).toBe('png');
    await vi.waitFor(() => expect(toast).toHaveBeenCalledWith('Google Lens is opening with the zone.', 'info', 4200));
    expect(opened).toEqual([]);
  });

  it('opens the engine itself and keeps the paste road when the extension refuses', async () => {
    handOffReverse.mockRejectedValue(new Error('no answer'));
    pressEngine(press(), LENS, picture(), [LENS]);
    await vi.waitFor(() => expect(opened).toEqual([LENS.url]));
    expect(toast.mock.calls.at(-1)[0]).toMatch(/^Opened Google Lens\. Paste the zone with/);
  });

  it('saves the picture for a drag engine when the extension refuses', async () => {
    handOffReverse.mockRejectedValue(new Error('not permitted'));
    pressEngine(press(), YANDEX, picture(), [YANDEX]);
    await vi.waitFor(() => expect(opened).toEqual([YANDEX.url]));
    expect(downloads).toEqual(['reverse-clip-zone.png']);
    expect(toast).toHaveBeenCalledWith('Opened Yandex. Drag the saved zone in', 'ok', 4500);
  });

  it('does not carry a picture too big for the hand-off', async () => {
    const big = { size: MAX_HANDOFF_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(0) };
    pressEngine(press(), LENS, picture(big), [LENS]);
    await vi.waitFor(() => expect(opened).toEqual([LENS.url]));
    expect(handOffReverse).not.toHaveBeenCalled();
  });
});

describe('copying a picture', () => {
  it('takes a note of its own, for a copy that opens no engine', async () => {
    await copyPicture(picture(), 'Copied the zone');
    expect(written).toHaveLength(1);
    expect(toast).toHaveBeenCalledWith('Copied the zone', 'ok', 4500);
  });

  it('reports a clipboard that refuses', async () => {
    navigator.clipboard.write = vi.fn(async () => {
      throw new Error('Document is not focused');
    });
    expect(await copyPicture(picture())).toBe(false);
    expect(toast).toHaveBeenCalledWith('Document is not focused', 'warn');
  });
});
