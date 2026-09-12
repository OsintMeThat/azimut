// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRefsState } from './refs.svelte.js';

/**
 * The reference windows' own rules, apart from the map they float over.
 *
 * The window geometry has its own tests (lib/refViewers.js); what is asserted
 * here is when the case is read, where the windows live, and how they stack.
 */

const SHOT = { path: 'media/a.jpg', kind: 'image', title: 'A' };
const CLIP = { path: 'media/b.mp4', kind: 'video', title: 'B' };
const DOC = { path: 'media/c.pdf', kind: 'document', title: 'C' };

let api;
let notify;
let session;
let caseId;

function store() {
  return createRefsState({
    api,
    notify,
    caseId: () => caseId,
    viewers: () => session,
    setViewers: (windows) => (session = windows),
  });
}

beforeEach(() => {
  api = { get: vi.fn(async () => [SHOT, CLIP, DOC]) };
  notify = vi.fn();
  session = [];
  caseId = 'case-1';
});

describe('the picker', () => {
  it('reads the case media when it opens, never before', async () => {
    const refs = store();
    expect(api.get).not.toHaveBeenCalled();

    await refs.openPicker();
    expect(api.get).toHaveBeenCalledWith('/api/cases/case-1/media');
    expect(refs.picking).toBe(true);
  });

  it('offers images and videos, since the frame to place is often in a clip', async () => {
    const refs = store();
    await refs.openPicker();
    expect(refs.media).toEqual([SHOT, CLIP]);
  });

  it('asks nothing at all when there is no case yet', async () => {
    caseId = undefined;
    const refs = store();
    await refs.openPicker();
    expect(api.get).not.toHaveBeenCalled();
    expect(refs.media).toEqual([]);
  });

  it('says why it is empty rather than looking like a case with no media', async () => {
    api.get = vi.fn(async () => {
      throw new Error('offline');
    });
    const refs = store();
    await refs.openPicker();
    expect(notify).toHaveBeenCalledWith(expect.stringContaining('offline'), 'danger');
    expect(refs.media).toEqual([]);
    expect(refs.loading).toBe(false);
  });

  it('drops its busy flag whichever way the read ends', async () => {
    const refs = store();
    const reading = refs.openPicker();
    expect(refs.loading).toBe(true);
    await reading;
    expect(refs.loading).toBe(false);
  });
});

describe('spawning a window', () => {
  it('closes the picker and puts the window on top', async () => {
    const refs = store();
    await refs.openPicker();
    refs.add(SHOT);
    expect(refs.picking).toBe(false);
    expect(refs.open).toHaveLength(1);
    expect(refs.open[0].path).toBe(SHOT.path);
  });

  it('staggers each window so the one underneath stays grabbable', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(SHOT);
    expect(refs.open[1].x).toBeGreaterThan(refs.open[0].x);
    expect(refs.open[1].y).toBeGreaterThan(refs.open[0].y);
  });

  it('wraps the stagger before a window walks off the map', () => {
    const refs = store();
    for (let i = 0; i < 7; i += 1) refs.add(SHOT);
    expect(refs.open[6].x).toBe(refs.open[0].x);
  });

  it('gives two windows on the same image distinct ids', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(SHOT);
    expect(refs.open[0].id).not.toBe(refs.open[1].id);
  });

  it('stacks each new window above the last', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(CLIP);
    expect(refs.open[1].z).toBeGreaterThan(refs.open[0].z);
  });
});

describe('focus and close', () => {
  it('renumbers the stack rather than letting z climb without bound', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(CLIP);
    refs.add(SHOT);
    const top = refs.open[2].z;

    refs.focus(refs.open[0].id);
    expect(refs.open[0].z).toBe(top); // the focused one is on top…
    // …and nothing climbed past the number of windows
    expect(Math.max(...refs.open.map((pane) => pane.z))).toBe(refs.open.length);
  });

  it('leaves the other windows in their own order under it', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(CLIP);
    refs.add(DOC);
    const [first, second] = [refs.open[0].id, refs.open[1].id];

    refs.focus(refs.open[2].id);
    const z = new Map(refs.open.map((pane) => [pane.id, pane.z]));
    expect(z.get(first)).toBeLessThan(z.get(second));
  });

  it('closing one drops it from the session and keeps the rest', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(CLIP);
    const doomed = refs.open[0].id;

    refs.close(doomed);
    expect(refs.open).toHaveLength(1);
    expect(refs.open[0].id).not.toBe(doomed);
  });
});

describe('what the windows are', () => {
  it('holds them in the session it was handed, never in a store of its own', () => {
    const refs = store();
    refs.add(SHOT);
    // the tool's session array *is* the list — that is what makes them survive a
    // tab switch and vanish with the tab
    expect(session).toHaveLength(1);
    expect(refs.open).toBe(session);
  });
});
