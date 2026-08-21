// @vitest-environment happy-dom
/**
 * The dialog that asks where a batch came from, actually mounted.
 *
 * What matters here is what it will and will not let through: an import may state
 * nothing (most drops are the analyst's own working files), a correction must
 * state something, and neither takes an address that is not one.
 */
import { describe, expect, it, afterEach, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: SourceDialog } = await import('./SourceDialog.svelte');

let live = null;

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SourceDialog, { target, props });
  flushSync();
  return document.body;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

const field = (root) => root.querySelector('#import-source');
const confirm = (root) => [...root.querySelectorAll('button')].at(-1);

function type(root, value) {
  const input = field(root);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

describe('on the way in', () => {
  it('counts the files it is about to file', () => {
    const root = open({ count: 3 });
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Import 3 files');
  });

  it('lets a batch through with no origin stated, and says so on the button', () => {
    const onconfirm = vi.fn();
    const root = open({ count: 2, onconfirm });
    expect(confirm(root).disabled).toBe(false);
    expect(confirm(root).textContent.trim()).toBe('Import without a source');
    confirm(root).click();
    expect(onconfirm).toHaveBeenCalledWith('');
  });

  it('hands back the trimmed address', () => {
    const onconfirm = vi.fn();
    const root = open({ count: 1, onconfirm });
    type(root, '  https://t.me/channel/42 ');
    expect(confirm(root).textContent.trim()).toBe('Import');
    confirm(root).click();
    expect(onconfirm).toHaveBeenCalledWith('https://t.me/channel/42');
  });

  it('refuses what is not an address, before the server has to', () => {
    const root = open({ count: 1 });
    type(root, 'a friend sent it');
    expect(root.textContent).toContain('The source must be an http(s) address.');
    expect(confirm(root).disabled).toBe(true);
  });
});

describe('afterwards', () => {
  it('is titled for the batch it corrects and needs an answer', () => {
    const root = open({ mode: 'state', count: 4 });
    expect(root.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe(
      'Source of 4 files'
    );
    // nothing to save: this dialog was opened to state one
    expect(confirm(root).disabled).toBe(true);
    type(root, 'https://example.org/post/7');
    expect(confirm(root).disabled).toBe(false);
  });

  it('opens on the last source stated this session', () => {
    const root = open({ mode: 'state', count: 1, value: 'https://example.org/thread' });
    expect(field(root).value).toBe('https://example.org/thread');
  });
});
