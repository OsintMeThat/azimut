// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const ensureCase = vi.fn(async () => ({ id: 'scratch' }));
vi.mock('../lib/state.svelte.js', () => ({ ensureCase, toast: vi.fn() }));
const { default: NoCase } = await import('./NoCase.svelte');

let live;
let target;
afterEach(() => {
  if (live) unmount(live);
  target?.remove();
});

describe('a tool with no case open', () => {
  it('says what it would do and starts a scratch session from where it is', async () => {
    target = document.createElement('div');
    document.body.append(target);
    live = mount(NoCase, { target, props: { what: 'write notes' } });
    flushSync();

    expect(target.textContent).toContain('Open a case to write notes.');
    target.querySelector('button').click();
    await Promise.resolve();
    expect(ensureCase).toHaveBeenCalledTimes(1);
  });
});
