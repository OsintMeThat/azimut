import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { caseState, uiState, closeCase, setSidebarWidth } from './state.svelte.js';
import { MIN_W, MAX_W } from './sidebar.js';

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

describe('setSidebarWidth', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('takes a dragged width as-is when it fits', () => {
    vi.stubGlobal('window', { innerWidth: 1600 });
    setSidebarWidth(440);
    expect(uiState.sidebarW).toBe(440);
  });

  it('clamps against the live window, not just the fixed bounds', () => {
    vi.stubGlobal('window', { innerWidth: 900 });
    setSidebarWidth(MAX_W); // legal on a wide screen, half the canvas here
    expect(uiState.sidebarW).toBe(450);

    setSidebarWidth(10);
    expect(uiState.sidebarW).toBe(MIN_W);
  });
});
