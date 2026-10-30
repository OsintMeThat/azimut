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

  it('opens on collected media with every type, then keeps the narrowing picked', async () => {
    const refs = store();
    expect(refs.category).toBe(null);
    expect(refs.showWorking).toBe(false);

    await refs.openPicker();
    refs.category = 'video';
    refs.showWorking = true;
    refs.add(CLIP); // closes the picker
    await refs.openPicker();
    expect(refs.category).toBe('video');
    expect(refs.showWorking).toBe(true);
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

describe('a clip', () => {
  it('reads its frame rate when it opens, so a step is one frame', async () => {
    api.get = vi.fn(async (url) => (url.includes('/inspect/probe') ? { fps: 25 } : []));
    const refs = store();
    refs.add(CLIP);
    expect(api.get).toHaveBeenCalledWith('/api/cases/case-1/inspect/probe?path=media%2Fb.mp4');
    await vi.waitFor(() => expect(refs.open[0].fps).toBe(25));
  });

  it('asks nothing for a picture', () => {
    const refs = store();
    refs.add(SHOT);
    expect(api.get).not.toHaveBeenCalled();
  });

  it('keeps the default rate when the probe fails, without a word', async () => {
    api.get = vi.fn(async () => {
      throw new Error('no ffprobe');
    });
    const refs = store();
    refs.add(CLIP);
    await Promise.resolve();
    expect(refs.open[0].fps).toBe(null);
    expect(notify).not.toHaveBeenCalled();
  });

  it('keeps a frame as a picture a step down from it, on top, with its facts', () => {
    const refs = store();
    refs.add({ ...CLIP, notes: 'Gate' });
    const clip = refs.open[0];
    refs.keepFrame(clip.id, 'data:image/jpeg;base64,AA', 12.4);

    const frame = refs.open[1];
    expect(frame).toMatchObject({
      kind: 'image',
      still: 'data:image/jpeg;base64,AA',
      title: 'B · 0:12.400',
      x: clip.x + 26,
      y: clip.y + 26,
      docked: false,
    });
    expect(frame.facts.notes).toBe('Gate');
    expect(frame.z).toBeGreaterThan(clip.z);
  });

  it('keeps nothing for a window that has gone, or for no picture', () => {
    const refs = store();
    refs.add(CLIP);
    refs.keepFrame('ref-nope', 'data:image/jpeg;base64,AA', 0);
    refs.keepFrame(refs.open[0].id, null, 0);
    expect(refs.open).toHaveLength(1);
  });
});

describe('the dock', () => {
  it('docks a window in the column asked and lists each where it is', () => {
    const refs = store();
    refs.add(SHOT);
    refs.add(CLIP);
    refs.add(SHOT);
    refs.place(refs.open[1].id, 'left');
    refs.place(refs.open[2].id, 'right');
    expect(refs.dockedOn('left').map((pane) => pane.title)).toEqual(['B']);
    expect(refs.dockedOn('right')).toHaveLength(1);
    expect(refs.floating.map((pane) => pane.title)).toEqual(['A']);
  });

  it('pins a window to a corner, over the map, and moves it from a column to one', () => {
    const refs = store();
    refs.add(SHOT);
    refs.place(refs.open[0].id, 'left');
    refs.place(refs.open[0].id, 'tl');
    expect(refs.open[0]).toMatchObject({ docked: false, corner: 'tl' });
    expect(refs.floating).toHaveLength(1); // pinned is still over the map
    refs.place(refs.open[0].id, 'right');
    expect(refs.open[0]).toMatchObject({ docked: 'right', corner: false });
  });

  it('sets a window free when asked for the place it is in, or for none', () => {
    const refs = store();
    refs.add(SHOT);
    refs.place(refs.open[0].id, 'br');
    refs.place(refs.open[0].id, 'br');
    expect(refs.open[0]).toMatchObject({ docked: false, corner: false });
    refs.place(refs.open[0].id, 'left');
    refs.place(refs.open[0].id, null);
    expect(refs.open[0]).toMatchObject({ docked: false, corner: false });
    refs.place('ref-nope', 'tl'); // a window that has gone
  });

  it('puts a frame kept from a docked clip in the column beside it', () => {
    const refs = store();
    refs.add(CLIP);
    refs.place(refs.open[0].id, 'left');
    refs.keepFrame(refs.open[0].id, 'data:image/jpeg;base64,AA', 1);
    expect(refs.dockedOn('left')).toHaveLength(2);
  });

  it('keeps each column to what leaves the map at least half', () => {
    const refs = store();
    expect(refs.dockWidth('right')).toBe(340);
    refs.setDockWidth('right', 1200, 1600);
    expect(refs.dockWidth('right')).toBe(800);
    refs.setDockWidth('right', 10, 1600);
    expect(refs.dockWidth('right')).toBe(220);
  });

  it('counts the other column before widening one', () => {
    const refs = store();
    refs.add(SHOT);
    refs.place(refs.open[0].id, 'left');
    refs.setDockWidth('left', 600, 1600);
    refs.setDockWidth('right', 5000, 1600);
    // half of what the left column leaves, not half of the row
    expect(refs.dockWidth('right')).toBe(500);
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
