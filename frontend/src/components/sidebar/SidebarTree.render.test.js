// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { buildTree } from '../../lib/folderTree.js';
import { MEDIA_DRAG } from '../../lib/drag.js';
import SidebarTree from './SidebarTree.svelte';

/**
 * A file dragged out of the Media library onto a folder of the sidebar.
 *
 * The folders used to take only the tree's own rows. A thumbnail let go on one
 * was dropped in silence, and the library's import overlay stayed up behind it.
 */

let live = null;
let target = null;

function show(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SidebarTree, {
    target,
    props: {
      tree: buildTree(['Energodar', 'Fronte'], []),
      unfiled: { items: [{ id: 'e9', type: 'note', label: 'Loose note', attrs: {} }], done: true },
      caseId: 'case-a',
      ...props,
    },
  });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

function drag(type, data) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: Object.keys(data), getData: (key) => data[key] ?? '', dropEffect: 'none' },
  });
  return event;
}

const folderRow = (root, name) =>
  [...root.querySelectorAll('.frow')].find((row) => row.querySelector('.fname')?.textContent === name);

const payload = JSON.stringify([{ path: 'media/quai.jpg', title: 'quai.jpg', folder: '' }]);

describe('a media dropped on a folder', () => {
  it('lights the folder it hovers and takes the drop', () => {
    const root = show();
    const over = drag('dragover', { [MEDIA_DRAG]: payload });
    folderRow(root, 'Energodar').dispatchEvent(over);
    flushSync();
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('move');
    expect(folderRow(root, 'Energodar').classList.contains('dropping')).toBe(true);
  });

  it('files it in that folder', () => {
    const onfilemedia = vi.fn();
    const onfile = vi.fn();
    const root = show({ onfilemedia, onfile });
    folderRow(root, 'Energodar').dispatchEvent(drag('drop', { [MEDIA_DRAG]: payload }));
    flushSync();
    expect(onfile).not.toHaveBeenCalled();
    expect(onfilemedia).toHaveBeenCalledWith(
      [{ type: 'media', label: 'quai.jpg', attrs: { path: 'media/quai.jpg', folder: '' } }],
      'Energodar'
    );
    expect(folderRow(root, 'Energodar').classList.contains('dropping')).toBe(false);
  });

  it('unfiles it on the Unfiled row', () => {
    const onfilemedia = vi.fn();
    const root = show({ onfilemedia });
    folderRow(root, 'Unfiled').dispatchEvent(drag('drop', { [MEDIA_DRAG]: payload }));
    expect(onfilemedia).toHaveBeenCalledWith(expect.any(Array), '');
  });

  it('refuses a desktop file and a stray link, which are not its to take', () => {
    const onfilemedia = vi.fn();
    const root = show({ onfilemedia });
    for (const data of [{ Files: '' }, { 'text/uri-list': 'https://example.org' }]) {
      const over = drag('dragover', data);
      folderRow(root, 'Fronte').dispatchEvent(over);
      flushSync();
      expect(over.defaultPrevented).toBe(false);
      expect(folderRow(root, 'Fronte').classList.contains('dropping')).toBe(false);
    }
    expect(onfilemedia).not.toHaveBeenCalled();
  });
});
