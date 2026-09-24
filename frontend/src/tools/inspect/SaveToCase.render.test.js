// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const uiState = { tool: 'inspect', focusMedia: null };
vi.mock('../../lib/state.svelte.js', () => ({
  caseState: { current: { id: 'case-a', folders: ['Roofs'] } },
  uiState,
}));

const { default: SaveToCase } = await import('./SaveToCase.svelte');

let live = null;
let target = null;

function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SaveToCase, { target, props: { defaultName: '00-00-12 roof', onsave: vi.fn(async () => {}), ...props } });
  flushSync();
  return props;
}

const nameField = () => target.querySelector('input[aria-label="Name"]');
const saveButton = () => [...target.querySelectorAll('button')].find((b) => /Save to case|Saved|Saving/.test(b.textContent) && b.classList.contains('btn-primary'));

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('Save to case', () => {
  it('holds real text from the start, never a placeholder to guess at', () => {
    show({});
    expect(nameField().value).toBe('00-00-12 roof');
  });

  it('files under the typed name, and falls back to the default when the field is cleared', async () => {
    const onsave = vi.fn(async () => {});
    show({ onsave });

    nameField().value = '  Chimney  ';
    nameField().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    saveButton().click();
    await Promise.resolve();
    expect(onsave).toHaveBeenLastCalledWith({ name: 'Chimney', folder: null, note: null });
    await Promise.resolve();
    flushSync();
    // the next output starts from its own default, not from the last typed name
    expect(nameField().value).toBe('00-00-12 roof');

    nameField().value = '   ';
    nameField().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    saveButton().click();
    await Promise.resolve();
    expect(onsave).toHaveBeenLastCalledWith({ name: '00-00-12 roof', folder: null, note: null });
  });

  it('carries a note once one is asked for', async () => {
    const onsave = vi.fn(async () => {});
    show({ onsave });

    [...target.querySelectorAll('button')].find((b) => b.textContent.includes('Add a note')).click();
    flushSync();
    const note = target.querySelector('textarea[aria-label="Note"]');
    note.value = 'The sign names the street';
    note.dispatchEvent(new Event('input'));
    flushSync();
    saveButton().click();
    await Promise.resolve();

    expect(onsave).toHaveBeenCalledWith({ name: '00-00-12 roof', folder: null, note: 'The sign names the street' });
  });

  it('says an output is already in the case, and leads to it', () => {
    show({ filedPath: 'media/00-00-12 roof.png' });

    expect(saveButton().disabled).toBe(true);
    expect(saveButton().textContent).toContain('Saved');
    [...target.querySelectorAll('button')].find((b) => b.textContent.includes('In the case')).click();
    expect(uiState.focusMedia).toBe('media/00-00-12 roof.png');
    expect(uiState.tool).toBe('media');
  });

  it('says why a save cannot happen yet, instead of failing on the press', () => {
    show({ blocked: 'Add a piece first.' });

    expect(saveButton().disabled).toBe(true);
    expect(target.textContent).toContain('Add a piece first.');
  });
});
