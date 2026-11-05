// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The row a tool's menu shows: it names the pinned note, and is not there at all
 * when no note is pinned, so a tool stays as it was.
 */

const { putInNote } = vi.hoisted(() => ({ putInNote: vi.fn(async () => null) }));
vi.mock('../lib/notes/putInNote.svelte.js', async (actual) => ({ ...(await actual()), putInNote }));

const { pinNote } = await import('../lib/notes/putInNote.svelte.js');
const { default: PutInNote } = await import('./PutInNote.svelte');

let target;
let app;
let unpin = () => {};
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  unpin();
  vi.clearAllMocks();
});

const offer = { id: 'point', label: 'This point', hint: 'Its coordinates', icon: 'crosshair', put: async () => ({ text: 'x' }) };

function row(props) {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(PutInNote, { target, props: { offer, ...props } });
  flushSync();
  return target.querySelector('button');
}

describe('Put in “…”', () => {
  it('is not there when no note is pinned', () => {
    expect(row()).toBeNull();
  });

  it('names the pinned note, cut short, and comes when one is pinned', () => {
    const button = row();
    expect(button).toBeNull();
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Strike on the northern quay, second night', editor: {} });
    flushSync();
    expect(target.querySelector('button').textContent.trim()).toBe('Put in “Strike on the northern…”');
    expect(target.querySelector('button').title).toBe('Its coordinates');
  });

  it('says what it puts when a menu holds two', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike', editor: {} });
    expect(row({ named: true }).textContent.trim()).toBe('Put this point in “Port strike”');
  });

  it('closes its menu and puts the offer', () => {
    unpin = pinNote({ caseId: 'c1', noteId: 'n1', title: 'Port strike', editor: {} });
    const onput = vi.fn();
    row({ onput, class: 'menu-row' }).click();
    expect(onput).toHaveBeenCalledOnce();
    expect(putInNote).toHaveBeenCalledWith(offer);
    expect(target.querySelector('button').className).toContain('menu-row');
  });
});
