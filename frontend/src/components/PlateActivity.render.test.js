// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateActivity from './PlateActivity.svelte';
import { endExport, exportSays, startExport } from '../lib/plate/exportRun.svelte.js';
import { uiState } from '../lib/state.svelte.js';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; endExport(); document.body.innerHTML = ''; });

describe('the top bar\'s word on a plate export', () => {
  it('shows only while one runs, says how far, and goes back to the plate', () => {
    held = mount(PlateActivity, { target: document.body });
    flushSync();
    expect(document.body.querySelector('.plate-activity')).toBeNull();
    startExport('Front', 'case-1', () => {});
    flushSync();
    expect(document.body.querySelector('.plate-activity').textContent.trim()).toBe('Plate export…');
    exportSays('Drawing 3 Oct (3 of 4)…', 3, 4);
    flushSync();
    const pill = document.body.querySelector('.plate-activity');
    expect(pill.textContent.trim()).toBe('Plate export 75%');
    expect(pill.title).toBe('Exporting Front: Drawing 3 Oct (3 of 4)…');
    uiState.tool = 'satellite';
    pill.click(); flushSync();
    expect(uiState.tool).toBe('plate');
    endExport(); flushSync();
    expect(document.body.querySelector('.plate-activity')).toBeNull();
  });
});
