// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * A source for the note: a link already in the case is cited, a new one is kept as a
 * bookmark named from its address or downloaded, each one press.
 */

vi.mock('../lib/api.js', () => ({ api: { get: vi.fn(), post: vi.fn(), patch: vi.fn() } }));
const { default: AddSource } = await import('./AddSource.svelte');

let target;
let app;
afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  document.querySelectorAll('.float-menu').forEach((node) => node.remove());
  app = null;
  vi.useRealTimers();
});

async function open(answer) {
  vi.useFakeTimers();
  const anchor = document.createElement('button');
  document.body.append(anchor);
  target = document.createElement('div');
  document.body.append(target);
  const onpick = vi.fn();
  const lookup = vi.fn(async (_case, url) => ({ url, ...answer }));
  app = mount(AddSource, { target, props: { caseId: 'c1', anchor, onpick, lookup } });
  flushSync();
  return { onpick, lookup };
}

const field = () => document.querySelector('.float-menu input[type="url"]');
async function type(text) {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  await vi.advanceTimersByTimeAsync(250);
  flushSync();
}
const items = () => [...document.querySelectorAll('.float-menu .fm-item')].map((row) => row.textContent.replace(/\s+/g, ' ').trim());

describe('A source…', () => {
  it('cites what the case already holds for the link', async () => {
    const { onpick, lookup } = await open({ title: 'Post by @port_watch on X', found: [{ id: 'm1', type: 'media', label: 'clip.mp4', attrs: { kind: 'video' } }] });
    await type('https://twitter.com/port_watch/status/9');
    expect(lookup).toHaveBeenCalledWith('c1', 'https://twitter.com/port_watch/status/9');
    expect(items()).toEqual(['Cite “clip.mp4”']);
    document.querySelector('.float-menu .fm-item').click();
    expect(onpick.mock.calls[0][0]).toMatchObject({ id: 'cite' });
  });

  it('offers a bookmark named from the address, or a download, for a new link', async () => {
    const { onpick } = await open({ title: 'Telegram, port #4', found: [] });
    await type('https://t.me/port/4');
    expect(document.querySelector('.float-menu .said').textContent).toBe('Telegram, port #4');
    expect(items()).toEqual(['Bookmarkoffline', 'Download']);
    document.querySelectorAll('.float-menu .fm-item')[1].click();
    expect(onpick.mock.calls[0][0]).toMatchObject({ id: 'download' });
  });

  it('takes Enter as the first offer', async () => {
    const { onpick } = await open({ title: 'example.org/a', found: [] });
    await type('https://example.org/a');
    field().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onpick.mock.calls[0][0]).toMatchObject({ id: 'bookmark' });
  });

  it('asks nothing of the case for words that are not a link', async () => {
    const { lookup } = await open({ found: [] });
    await type('port strike');
    expect(lookup).not.toHaveBeenCalled();
    expect(document.querySelector('.float-menu .said').textContent).toBe('A link starts with http:// or https://');
  });
});
