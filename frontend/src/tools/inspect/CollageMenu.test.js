import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const menu = readFileSync(new URL('./CollageMenu.svelte', import.meta.url), 'utf8');
const toolbar = readFileSync(new URL('./CollageToolbar.svelte', import.meta.url), 'utf8');

describe('CollageMenu scope', () => {
  it('acts on the collage it is handed, and no longer switches between several', () => {
    expect(menu).toContain('let { collage: active, selectedIds = $bindable([]), requestCrop, fileTitles = new Map() } = $props();');
    for (const source of [menu, toolbar]) {
      expect(source).not.toContain('session.');
      expect(source).not.toContain('addCollage');
    }
  });

  it('leaves what acts on the whole collage to the bar over the canvas', () => {
    expect(menu).not.toContain('auto-stitch');
    expect(menu).not.toContain('straighten');
    expect(toolbar).toContain('/inspect/auto-stitch');
  });
});

describe('the collage canvas', () => {
  it('leaves the size to the export rather than asking for one', () => {
    expect(menu).not.toContain('Canvas width in pixels');
    expect(toolbar).not.toContain('Canvas width in pixels');
  });
});
