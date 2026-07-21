import { describe, expect, it, vi, afterEach } from 'vitest';
import {
  clampNotebookHelpPosition, clampNotebookSplit, loadNotebookSplit, saveNotebookSplit,
  loadNotebookText, NOTEBOOK_DEFAULT_SPLIT,
} from './notebook.js';

afterEach(() => vi.unstubAllGlobals());

describe('clampNotebookSplit', () => {
  it('keeps the writer between the configured limits', () => {
    expect(clampNotebookSplit(5, 1400)).toBe(30);
    expect(clampNotebookSplit(90, 1400)).toBe(70);
  });

  it('makes room for both 280px panes in a narrower Notebook', () => {
    expect(clampNotebookSplit(30, 700)).toBe(40);
    expect(clampNotebookSplit(70, 700)).toBe(60);
  });
});

describe('loadNotebookText', () => {
  it('rejects a late response after another note becomes active', async () => {
    let activeKey = 'case-1:a';
    let resolveA;
    const requestA = loadNotebookText('case-1:a', '/notes/a', {
      get: () => new Promise((resolve) => { resolveA = resolve; }),
      currentKey: () => activeKey,
    });

    activeKey = 'case-1:b';
    const requestB = loadNotebookText('case-1:b', '/notes/b', {
      get: async () => ({ text: 'Note B' }),
      currentKey: () => activeKey,
    });
    expect(await requestB).toEqual({ accepted: true, text: 'Note B' });

    resolveA({ text: 'Late note A' });
    expect(await requestA).toEqual({ accepted: false, text: 'Late note A' });
  });
});

describe('Notebook split persistence', () => {
  it('round-trips a split value', () => {
    const values = {};
    vi.stubGlobal('localStorage', {
      getItem: (key) => values[key] ?? null,
      setItem: (key, value) => { values[key] = value; },
    });
    saveNotebookSplit(61.4);
    expect(loadNotebookSplit()).toBe(61.4);
  });

  it('uses the default when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('denied'); } });
    expect(loadNotebookSplit()).toBe(NOTEBOOK_DEFAULT_SPLIT);
  });
});

describe('clampNotebookHelpPosition', () => {
  it('keeps the Markdown helper inside the Notebook', () => {
    expect(clampNotebookHelpPosition(-40, 900, 720, 540, 1200, 800)).toEqual({ x: 12, y: 248 });
    expect(clampNotebookHelpPosition(240, 80, 720, 540, 1200, 800)).toEqual({ x: 240, y: 80 });
  });

  it('anchors an oversized helper to the viewport margin', () => {
    expect(clampNotebookHelpPosition(100, 100, 720, 540, 600, 400)).toEqual({ x: 12, y: 12 });
  });

  it('reclamps the helper after expanding from its collapsed title bar', () => {
    expect(clampNotebookHelpPosition(600, 700, 380, 48, 1000, 800)).toEqual({ x: 600, y: 700 });
    expect(clampNotebookHelpPosition(600, 700, 760, 540, 1000, 800)).toEqual({ x: 228, y: 248 });
  });
});
