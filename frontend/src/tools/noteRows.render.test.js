// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { flushSync, mount, unmount } from 'svelte';

/**
 * Where each tool shows `Put in “<note>”`: inside the menu or panel it already
 * has, only while a note is pinned beside, and never as a new button of its own.
 * The two map menus are mounted; the tools' own wiring is read off their source,
 * as their files are too large to mount here.
 */

const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../lib/notes/putInNote.svelte.js');
const { default: CaptureOptions } = await import('./satellite/CaptureOptions.svelte');
const { default: MapContextMenu } = await import('./satellite/MapContextMenu.svelte');

const VIEW = { id: 'view', label: 'This view', hint: 'Captured and filed in the case', icon: 'camera', put: async () => ({ text: 'x' }) };
const POINT = { id: 'point', label: 'This point', hint: 'Its coordinates', icon: 'pin', put: async () => ({ text: 'y' }) };

let held = null;
let unpin = () => {};
afterEach(() => {
  if (held) unmount(held);
  held = null;
  unpin();
  unpin = () => {};
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

function captureMenu(props = {}) {
  held = mount(CaptureOptions, {
    target: document.body,
    props: {
      menuOpen: true, mode: 'center', hover: false, selectArmed: false, capturing: false, blocked: false,
      widgetBase: false, runCapture: vi.fn(), ratios: [{ id: 'free', label: 'Free' }], ratio: 'free',
      presets: [{ id: 'md', label: '1200' }], preset: 'md', customWidth: 1200, customHeight: 675, resolution: 1,
      scaleNorth: false, openScreenshot: vi.fn(), openExtensionGate: vi.fn(), noteOffer: VIEW, ...props,
    },
  });
  flushSync();
}

const putRow = () => document.body.querySelector('[data-put]');

describe('the capture menu', () => {
  it('shows nothing new while no note is pinned', () => {
    captureMenu();
    expect(putRow()).toBeNull();
  });

  it('puts the view in the pinned note, named, and closes', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike' });
    captureMenu();
    expect(putRow().textContent.trim()).toBe('Put in “Port strike”');
    expect(putRow().dataset.put).toBe('view');
    putRow().click();
    flushSync();
    expect(putInNote).toHaveBeenCalledWith(VIEW);
    expect(document.body.querySelector('.size-menu')).toBeNull();
  });

  it('offers no view on a basemap that cannot be captured', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike' });
    captureMenu({ blocked: true });
    expect(putRow()).toBeNull();
  });
});

describe('the right-click menu', () => {
  function pointMenu(onclose = vi.fn()) {
    held = mount(MapContextMenu, {
      target: document.body,
      props: {
        at: { lat: 15.36941, lon: 44.19104, x: 120, y: 80 }, frame: { width: 1000, height: 700 }, zoom: 17,
        format: 'dd', fullscreen: false, lookup: null, notePoint: POINT, onpick: vi.fn(), onclose,
      },
    });
    flushSync();
    return onclose;
  }

  it('puts the point clicked in the pinned note, beside its copies', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'A very long note title about the port strike' });
    const onclose = pointMenu();
    expect(putRow().textContent.trim()).toBe('Put this point in “A very long note title…”');
    expect(putRow().getAttribute('role')).toBe('menuitem');
    putRow().click();
    expect(onclose).toHaveBeenCalled();
    expect(putInNote).toHaveBeenCalledWith(POINT);
  });

  it('is the menu it always was with no note pinned', () => {
    pointMenu();
    expect(putRow()).toBeNull();
  });
});

describe('each tool puts its row where the hand already goes', () => {
  const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

  it.each([
    ['./ProofComposer.svelte', "offerPuts('proof',", '<PutInNote offer={noteOffer} class="export-option put" onput={() => (exportMenuOpen = false)} />'],
    ['./Inspector.svelte', "offerPuts('inspect',", '<PutInNote offer={noteFrame} class="btn btn-sm" role="button" />'],
    ['./Collage.svelte', "offerPuts('collage',", '<PutInNote offer={noteCollage} class="btn btn-sm" role="button" />'],
    ['./Compare.svelte', "offerPuts('compare',", '<PutInNote offer={notePair} class="btn put-row" role="button" onput={() => (rightPanel = null)} />'],
    ['./detect/DetectReview.svelte', "offerPuts('detect',", '<PutInNote offer={notePin} class="btn btn-sm" role="button" />'],
    ['./Satellite.svelte', "offerPuts('satellite',", 'noteOffer={noteView}'],
  ])('%s offers its puts and shows its row in its own menu', (path, offers, row) => {
    const source = read(path);
    expect(source).toContain(offers);
    expect(source).toContain(row);
  });

  it('offers a pinned candidate only, never one still in the queue', () => {
    const source = read('./detect/DetectReview.svelte');
    expect(source).toContain("const pinned = $derived(candidate?.review === 'kept' && candidate?.entity_id ? candidate : null);");
    expect(source).toContain("offerPuts('detect', () => (pinned ? [notePin] : []));");
    // the row sits in the pinned verdict, nowhere else
    const verdict = source.slice(source.indexOf("{#if candidate?.review === 'kept'}"), source.indexOf("{:else if candidate?.review === 'noted'}"));
    expect(verdict).toContain('<PutInNote');
  });

  it('puts the pair side by side whatever the screen shows, and asks the server to reuse it', () => {
    const source = read('./Compare.svelte');
    expect(source).toContain("compose(sources, { renderMode: 'side', renderChangeMap: null })");
    expect(source).toContain("form.append('spec', JSON.stringify({ ...sessionSpec(), mode: 'side', difference: false }));");
    expect(source).toContain("form.append('reuse', 'true');");
    // an unsaved comparison is saved under a made-up name, nothing asked
    expect(source).toContain('const { gone } = await storeSession(owner, title, { unique: true });');
  });

  it('saves an unsaved proof through its own save and waits for it', () => {
    const source = read('./ProofComposer.svelte');
    expect(source).toContain('if (saving || checking || overwritePrompt) return;');
    expect(source).toContain("else if (dirty || !savedName) reject(new Error('The proof was not saved, so nothing went in'));");
  });
});
