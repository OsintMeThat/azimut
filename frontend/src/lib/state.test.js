import { describe, it, expect, beforeEach } from 'vitest';
import { caseState, uiState, closeCase } from './state.svelte.js';

describe('closeCase', () => {
  beforeEach(() => {
    caseState.current = { id: 'case-a', name: 'Case A' };
    uiState.composeQueue = ['media/a.jpg'];
    uiState.postProof = { title: 'x' };
    uiState.openProof = 'proof-a';
    uiState.openDraft = 'draft-a';
    uiState.inspectPath = 'media/a.jpg';
    uiState.focusMedia = 'media/a.jpg';
    uiState.openInspect = 'session-a';
    uiState.gotoCoords = { lat: 1, lon: 2 };
  });

  it('drops the open case', () => {
    closeCase();
    expect(caseState.current).toBeNull();
  });

  it('clears every cross-tool handoff, so nothing meant for the closed case leaks into whatever opens next', () => {
    closeCase();
    expect(uiState.composeQueue).toEqual([]);
    expect(uiState.postProof).toBeNull();
    expect(uiState.openProof).toBeNull();
    expect(uiState.openDraft).toBeNull();
    expect(uiState.inspectPath).toBeNull();
    expect(uiState.focusMedia).toBeNull();
    expect(uiState.openInspect).toBeNull();
    expect(uiState.gotoCoords).toBeNull();
  });
});
