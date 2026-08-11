// @vitest-environment happy-dom
/**
 * The paste dialog, actually mounted.
 *
 * Its whole job is to show a different set of boxes depending on what was pasted
 * and where, and to say no when a surface will not take something. Reading the
 * source cannot tell whether the folder picker really stays away from the Media
 * grid, or whether the button that files a nameless bookmark is really disabled.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { resolvePaste } from '../lib/clipboardPaste.js';

const { default: PasteDialog } = await import('./PasteDialog.svelte');

// happy-dom has no object-URL plumbing, and the preview is not what these assert.
URL.createObjectURL = () => 'blob:preview';
URL.revokeObjectURL = () => {};

const imageFile = () => new File([new Uint8Array([1, 2, 3])], 'image.png', { type: 'image/png' });

let live = null;

function open(resolved, props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(PasteDialog, { target, props: { resolved, ...props } });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const labels = (root) => [...root.querySelectorAll('.modal-label')].map((el) => el.textContent.trim());
const addButton = (root) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Add'));

describe('a refusal', () => {
  it('says why, and offers nothing to fill in', () => {
    const root = open(resolvePaste('media', { kind: 'url', url: 'https://example.com/x' }));
    expect(root.textContent).toContain('URL field');
    expect(root.querySelectorAll('input')).toHaveLength(0);
    expect(addButton(root)).toBeUndefined();
    expect(root.textContent).toContain('Close');
  });

  it('is titled for what it is, whatever was pasted', () => {
    // "Paste link" over a sentence explaining that links do not go here reads as
    // an invitation
    const root = open(resolvePaste('media', { kind: 'url', url: 'https://example.com/x' }));
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Nothing to paste here'
    );
  });

  it('closes on the one button it has', () => {
    const onclose = vi.fn();
    const root = open(resolvePaste('board', { kind: 'text', text: 'notes' }), { onclose });
    [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Close').click();
    expect(onclose).toHaveBeenCalled();
  });
});

describe('a pasted image', () => {
  const payload = () => ({ kind: 'image', file: imageFile(), sourceUrl: '' });

  it('shows the pixels and asks for a name and an origin', () => {
    const root = open(resolvePaste('media', payload()));
    expect(root.querySelector('.preview img')?.getAttribute('src')).toBe('blob:preview');
    expect(labels(root)).toEqual(['Title', 'Source URL']);
    // the field exists because a pasted screenshot has no origin of its own
    expect(root.textContent).toContain('no origin of its own');
  });

  it('offers a folder in Files and nowhere else', () => {
    const filed = open(resolvePaste('files', payload()), { folders: ['Sources'] });
    expect(labels(filed)).toContain('Folder (in My work)');
    unmount(live);
    live = null;
    document.body.innerHTML = '';

    const drawn = open(resolvePaste('graph', payload()));
    expect(labels(drawn)).not.toContain('Folder (in My work)');
  });

  it('files with no title, since a stamped name is the honest default', () => {
    const resolved = resolvePaste('media', payload());
    const onconfirm = vi.fn();
    const root = open(resolved, { onconfirm });
    expect(addButton(root).disabled).toBe(false);
    addButton(root).click();
    expect(onconfirm).toHaveBeenCalledWith(resolved);
  });

  it('refuses to file a source that is not an address, and says so', () => {
    const resolved = resolvePaste('media', payload());
    const root = open(resolved);
    const source = root.querySelector('#paste-source');
    source.value = 'nonsense';
    source.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(root.textContent).toContain('http(s) address');
    expect(addButton(root).disabled).toBe(true);
  });

  it('carries what was typed back to the surface that opened it', () => {
    const onconfirm = vi.fn();
    const root = open(resolvePaste('files', payload(), { folder: 'Sources' }), { onconfirm });
    const title = root.querySelector('#paste-title');
    title.value = 'Front gate';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    addButton(root).click();
    expect(onconfirm.mock.calls[0][0].values).toMatchObject({
      title: 'Front gate',
      folder: 'Sources',
    });
  });
});

describe('a pasted link', () => {
  const payload = { kind: 'url', url: 'https://leak.example.com/thread/1' };

  it('shows the address and asks what a bookmark needs', () => {
    const root = open(resolvePaste('files', payload));
    expect(root.querySelector('.target')?.textContent).toContain('leak.example.com/thread/1');
    expect(labels(root)).toEqual(['Title', 'Folder (in My work)', 'Notes']);
    // no source field: the link is the source
    expect(root.querySelector('#paste-source')).toBeNull();
  });

  it('opens on the host as a title, so the button is live straight away', () => {
    const root = open(resolvePaste('graph', payload));
    expect(root.querySelector('#paste-title').value).toBe('leak.example.com');
    expect(addButton(root).disabled).toBe(false);
  });

  it('holds the button once the title is emptied', () => {
    const root = open(resolvePaste('graph', payload));
    const title = root.querySelector('#paste-title');
    title.value = '';
    title.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(root.textContent).toContain('needs a title');
    expect(addButton(root).disabled).toBe(true);
  });
});

describe('while it is filing', () => {
  it('says so and cannot be pressed twice', () => {
    const root = open(resolvePaste('board', { kind: 'url', url: 'https://x.example' }), {
      busy: true,
    });
    expect(addButton(root).disabled).toBe(true);
    expect(addButton(root).textContent.trim()).toBe('Adding…');
  });
});
