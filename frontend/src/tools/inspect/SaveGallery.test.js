import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import SaveGallery from './SaveGallery.svelte';

const source = readFileSync(new URL('./SaveGallery.svelte', import.meta.url), 'utf8');

const SAVABLES = [
  { key: 'frame:1', kind: 'frame', defaultName: 'roof 00-01-00', thumb: '/files/c/a.png' },
  { key: 'frame:2', kind: 'frame', defaultName: 'roof 00-02-00', thumb: '/files/c/b.png' },
];

function body(overrides = {}) {
  const saveUi = { selected: {}, folder: '', touched: {}, baseName: '', note: '' };
  const names = { 'frame:1': 'roof 00-01-00', 'frame:2': 'roof 00-02-00', ...overrides.names };
  return render(SaveGallery, {
    props: {
      savables: SAVABLES,
      saveUi,
      saveName: (it) => names[it.key] ?? '',
      setSaveName: (it, v) => (names[it.key] = v),
      ...overrides,
    },
  }).body;
}

describe('SaveGallery naming', () => {
  it('offers a name field per card instead of a fixed label', () => {
    const html = body();
    expect(html).toContain('aria-label="Name for roof 00-01-00"');
    expect(html).toContain('aria-label="Name for roof 00-02-00"');
    expect(html).not.toContain('class="label"');
  });

  it('holds the name as editable text, not a placeholder to guess at', () => {
    const html = body();
    expect(html).toContain('value="roof 00-01-00"');
    expect(html).toContain('value="roof 00-02-00"');
  });

  it('shows the base name the gallery was refilled with', () => {
    const html = body({ names: { 'frame:1': 'Roof 01', 'frame:2': 'Roof 02' } });
    expect(html).toContain('value="Roof 01"');
  });

  it('reads and writes through the owner of the name, not a local copy', () => {
    expect(source).toContain('bind:value={() => saveName(it), (v) => setSaveName(it, v)}');
    expect(source).not.toContain('saveUi.names[it.key]');
  });

  it('caps a name at the length the API accepts', () => {
    expect(body()).toContain('maxlength="200"');
  });



  it('keeps the thumbnail as the tick target, so typing does not toggle it', () => {
    expect(source).toContain('<button class="pick" onclick={() => toggle(it.key)}');
    expect(source).not.toContain('<button class="card"');
  });

  it('moves the saved badge onto the thumbnail, clear of the name field', () => {
    const saved = [{ ...SAVABLES[0], saved: true }];
    const html = body({ savables: saved });
    expect(html).toContain('saved');
    expect(source).toContain(`{#if it.saved}<span class="badge">saved</span>{/if}
          </div>`);
  });
});
