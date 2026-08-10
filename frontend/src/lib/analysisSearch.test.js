import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateAnalysisView,
  adoptSavedAnalysisView,
  analysisSearch,
  leaveAnalysisView,
  openAnalysisCase,
  setAnalysisFilter,
} from './analysisSearch.svelte.js';
import { emptyFilter } from './entityFilter.js';

function storage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
  };
}

describe('the Board and Graph question', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage());
    openAnalysisCase(null);
  });

  it('is shared, remembered per case and cleared at the case boundary', () => {
    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'AB-123' });
    expect(analysisSearch.filter.q).toBe('AB-123');

    openAnalysisCase('case-b');
    expect(analysisSearch.filter).toEqual(emptyFilter());
    openAnalysisCase('case-a');
    expect(analysisSearch.filter.q).toBe('AB-123');
  });

  it('opens a live recipe and marks it modified when either surface changes it', () => {
    activateAnalysisView('case-a', {
      id: 'v_live', mode: 'live', spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    });
    expect(analysisSearch.snapshotId).toBeNull();
    expect(analysisSearch.modified).toBe(false);
    expect(analysisSearch.saveState).toBe('saved');

    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'harbour' });
    expect(analysisSearch.modified).toBe(true);
    expect(analysisSearch.changeVersion).toBe(1);
  });

  it('adopts an autosave response without replaying its older question', () => {
    const view = {
      id: 'v_live', mode: 'live', spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    };
    activateAnalysisView('case-a', view);
    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'harbour' });

    expect(adoptSavedAnalysisView('case-a', {
      ...view,
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
      updated_at: 'later',
    })).toBe(true);
    expect(analysisSearch.filter.q).toBe('harbour');
    expect(analysisSearch.activeView.updated_at).toBe('later');
  });

  it('identifies an immutable snapshot until the analyst leaves it', () => {
    activateAnalysisView('case-a', {
      id: 'v_snapshot', mode: 'snapshot', spec: { query: { filter: emptyFilter() } },
    });
    expect(analysisSearch.snapshotId).toBe('v_snapshot');

    leaveAnalysisView('case-a', { clear: true });
    expect(analysisSearch.activeView).toBeNull();
    expect(analysisSearch.snapshotId).toBeNull();
    expect(analysisSearch.filter).toEqual(emptyFilter());
  });
});
