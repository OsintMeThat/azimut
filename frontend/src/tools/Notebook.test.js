import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import { caseState, uiState } from '../lib/state.svelte.js';
import Notebook from './Notebook.svelte';

afterEach(() => {
  caseState.current = null;
  uiState.openNotebook = null;
});

const source = readFileSync(new URL('./Notebook.svelte', import.meta.url), 'utf8');

describe('Notebook notes menu', () => {
  it('closes on a click outside and on Escape', () => {
    expect(source).toContain('class="menu-backdrop" onclick={closeNotesMenu}');
    expect(source).toContain("if (event.key === 'Escape' && menuOpen) closeNotesMenu();");
    expect(source).toContain('<svelte:window onkeydown={onWindowKeydown} />');
  });

  it('searches and browses note folders once the case has more than six notes', () => {
    expect(source).toContain('const NOTE_SEARCH_MIN = 6;');
    expect(source).toContain('{#if notesBrowserOpen || noteEntities.length > NOTE_SEARCH_MIN}');
    expect(source).toContain("import FolderBrowser from '../components/FolderBrowser.svelte'");
    expect(source).toContain('rootLabel="Notes"');
    expect(source).toContain('onselect={(note) => selectNote(note.id)}');
    expect(source).toContain('matches={(note) => matchesNote(note, query)}');
  });

  it('leaves the browser and the search behind when the menu closes', () => {
    expect(source).toContain(`  function closeNotesMenu() {
    menuOpen = false;
    notesBrowserOpen = false;
    notesBrowsePath = '';
  }`);
  });
});

describe('Notebook note creation', () => {
  it('shows a new-note button beside the open note tabs', () => {
    caseState.current = { id: 'case-1', entities: [] };

    const { body } = render(Notebook);

    expect(body).toContain('aria-label="New note"');
    expect(body).toContain('title="New note"');
  });

  it('shows reset for the case-wide note', () => {
    caseState.current = { id: 'case-1', entities: [] };

    const { body } = render(Notebook);

    expect(body).toContain('aria-label="Reset note content"');
    expect(body).not.toContain('aria-label="Delete note"');
  });

  it('offers both PDF exports beside the preview-only control', () => {
    caseState.current = { id: 'case-1', entities: [] };

    const { body } = render(Notebook);

    // The open note has its own destination dialog; another dialog selects several.
    expect(body).toContain('aria-label="Export this note as PDF"');
    expect(body).toContain('aria-label="Export several notes as PDF"');
    expect(body.indexOf('aria-label="Export this note as PDF"'))
      .toBeLessThan(body.indexOf('title="Preview only"'));
  });

  it('opens a destination dialog before exporting the current note', () => {
    expect(source).toContain('onclick={openCurrentExportDialog}');
    expect(source).toContain('<Modal title="Export note as PDF"');
    expect(source).toContain('singleExportId = noteId ?? \'case\';');
    expect(source).toContain('onclick={() => (exportPicker = true)}>Change</button>');
    expect(source).toContain('onclick={() => runExport([singleExportId])}');
    expect(source).toContain("{exportBusy ? 'Exporting…' : 'Export PDF'}");
  });

});

describe('Notebook — the debounced save and the export', () => {
  const notebook = readFileSync(new URL('./Notebook.svelte', import.meta.url), 'utf8');

  it('writes a pending edit before exporting instead of dropping it', () => {
    // Switching tabs resets `saved` without touching the timer, so the timer can
    // hold the only copy of another tab's edit. Cancelling it lost that edit
    // while the header still read "Saved".
    expect(notebook).toContain('await flushPendingSave();');
    expect(notebook).toContain('async function flushPendingSave()');
    expect(notebook).toContain('if (write) await write();');
    expect(notebook).not.toMatch(/exportBusy = true;\s*\n\s*try \{\s*\n\s*clearTimeout\(saveTimer\);/);
  });

  it('still drops the pending edit when the note is being deleted or reset', () => {
    expect(notebook).toMatch(/function cancelPendingSave\(\) \{[\s\S]*?pendingSave = null;/);
  });
});
