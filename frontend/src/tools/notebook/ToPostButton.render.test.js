// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * To Post in the Notebook's header: what its title promises, when it waits, and
 * what it hands over, the selection in place of the note when there is one.
 */

const { noteToPost, toast } = vi.hoisted(() => ({ noteToPost: vi.fn(async () => true), toast: vi.fn() }));
vi.mock('../../lib/notes/toPost.js', () => ({ noteToPost }));
vi.mock('../../lib/state.svelte.js', () => ({ toast }));

const { default: ToPostButton } = await import('./ToPostButton.svelte');

let component;
let target;

function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  component = mount(ToPostButton, { target, props: { caseId: 'case-a', noteId: 'n1', ...props } });
  flushSync();
  return target.querySelector('[data-guide="notebook.to-post"]');
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
}

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target?.remove();
  vi.clearAllMocks();
});

describe('To Post', () => {
  it('says it sends the note, its public edition only, and sends the whole of it', async () => {
    const button = show({ text: '# Findings\n\nSmoke over the quay.' });
    expect(button.textContent.trim()).toBe('To Post');
    expect(button.title).toBe('Opens Post with this note as a thread, its public edition only');
    expect(button.disabled).toBe(false);
    button.click();
    await settle();
    expect(noteToPost).toHaveBeenCalledWith('case-a', 'n1', '# Findings\n\nSmoke over the quay.', null);
  });

  it('says the selection goes when there is one, and sends it', async () => {
    const button = show({ noteId: 'case', text: 'Before. Smoke over the quay.', selection: { from: 8, to: 28 } });
    expect(button.title).toBe('Opens Post with the selection as a thread, its public edition only');
    button.click();
    await settle();
    expect(noteToPost).toHaveBeenCalledWith('case-a', 'case', 'Before. Smoke over the quay.', { from: 8, to: 28 });
  });

  it('waits on an empty note, and while the note is read', () => {
    expect(show({ text: '' }).disabled).toBe(true);
    unmount(component);
    target.remove();
    expect(show({ text: ' \n\n\t' }).disabled).toBe(true);
    unmount(component);
    target.remove();
    expect(show({ text: 'Words.', ready: false }).disabled).toBe(true);
    expect(noteToPost).not.toHaveBeenCalled();
  });

  it('is pressed once at a time, and says why when the note could not go', async () => {
    let release;
    noteToPost.mockImplementationOnce(() => new Promise((resolve, reject) => { release = reject; }));
    const button = show({ text: 'Words.' });
    button.click();
    flushSync();
    expect(button.disabled).toBe(true);
    button.click();
    expect(noteToPost).toHaveBeenCalledTimes(1);
    release(new Error('the note is too large to send to Post'));
    await settle();
    expect(button.disabled).toBe(false);
    expect(toast).toHaveBeenCalledWith('Not sent to Post: the note is too large to send to Post', 'danger');
  });
});
