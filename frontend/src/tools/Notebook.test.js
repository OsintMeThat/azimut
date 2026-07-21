import { describe, expect, it, afterEach } from 'vitest';
import { render } from 'svelte/server';
import { caseState, uiState } from '../lib/state.svelte.js';
import Notebook from './Notebook.svelte';

afterEach(() => {
  caseState.current = null;
  uiState.openNotebook = null;
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

  it('places PDF download beside the preview-only control', () => {
    caseState.current = { id: 'case-1', entities: [] };

    const { body } = render(Notebook);

    expect(body).toContain('aria-label="Download PDF"');
    expect(body.indexOf('aria-label="Download PDF"')).toBeLessThan(body.indexOf('title="Preview only"'));
  });

});
