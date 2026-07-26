import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import SaveMenu from './SaveMenu.svelte';

const SAVABLES = [
  { key: 'frame:1', kind: 'frame', defaultName: 'roof 00-01-00' },
  { key: 'frame:2', kind: 'frame', defaultName: 'roof 00-02-00' },
];

function body(overrides = {}) {
  const saveUi = { selected: {}, folder: '', names: {}, baseName: '', note: '' };
  return render(SaveMenu, {
    props: { savables: SAVABLES, saveUi, saving: false, save: vi.fn(), ...overrides },
  }).body;
}

describe('SaveMenu naming', () => {
  it('offers a base name for the whole batch', () => {
    const html = body();
    expect(html).toContain('Base name (optional)');
    expect(html).toContain('placeholder="Names the batch"');
  });

  it('offers one note for the batch, capped at the length the API accepts', () => {
    const html = body();
    expect(html).toContain('Note (optional)');
    expect(html).toContain('maxlength="2000"');
  });

  it('still offers the folder, unchanged', () => {
    expect(body()).toContain('Folder (optional)');
  });

  it('says names carry into the library, in one clause', () => {
    expect(body()).toContain('Tick what to save. Names carry into the Media Library with the provenance.');
  });
});
