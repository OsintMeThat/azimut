import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  activateAnalysisView,
  adoptSavedAnalysisView,
  analysisSearch,
  catalogViews,
  leaveAnalysisView,
  openAnalysisCase,
  renameAnalysisView,
  setAnalysisFilter,
  setAnalysisPeriod,
  timelineViews,
  viewFamily,
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
      id: 'v_live', mode: 'live', surface: 'board',
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    });
    expect(catalogViews.snapshotId).toBeNull();
    expect(catalogViews.modified).toBe(false);
    expect(catalogViews.saveState).toBe('saved');

    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'harbour' });
    expect(catalogViews.modified).toBe(true);
    expect(catalogViews.changeVersion).toBe(1);
  });

  it('shares and restores a fact-time period without turning it into a filing date', () => {
    const period = {
      from: '2026-08-12T09:00:00Z',
      to: '2026-08-12T11:00:00Z',
      categories: ['statement'],
    };
    activateAnalysisView('case-a', {
      id: 'v_time_filter', mode: 'live', surface: 'board',
      spec: { query: { filter: emptyFilter() }, timeline: period },
    });
    expect(analysisSearch.period).toEqual(period);
    expect(analysisSearch.filter.since).toBe('');

    setAnalysisPeriod('case-a', { ...period, to: '2026-08-12T12:00:00Z' });
    expect(catalogViews.modified).toBe(true);
  });

  it('adopts an autosave response without replaying its older question', () => {
    const view = {
      id: 'v_live', mode: 'live', surface: 'graph',
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    };
    activateAnalysisView('case-a', view);
    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'harbour' });

    expect(adoptSavedAnalysisView('case-a', {
      ...view,
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
      updated_at: 'later',
    })).toBe(true);
    expect(analysisSearch.filter.q).toBe('harbour');
    expect(catalogViews.activeView.updated_at).toBe('later');
  });

  it('identifies an immutable snapshot until the analyst leaves it', () => {
    activateAnalysisView('case-a', {
      id: 'v_snapshot', mode: 'snapshot', surface: 'board',
      spec: { query: { filter: emptyFilter() } },
    });
    expect(catalogViews.snapshotId).toBe('v_snapshot');

    leaveAnalysisView('case-a', 'board', { clear: true });
    expect(catalogViews.activeView).toBeNull();
    expect(catalogViews.snapshotId).toBeNull();
    expect(analysisSearch.filter).toEqual(emptyFilter());
    expect(analysisSearch.period.from).toBe('');
  });
});

describe('the two families of saved views', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', storage());
    openAnalysisCase(null);
  });

  it('sorts Board and Graph together and the Timeline apart', () => {
    expect([viewFamily('board'), viewFamily('graph')]).toEqual(['catalog', 'catalog']);
    expect(viewFamily('timeline')).toBe('timeline');
  });

  it('holds one reading per family at once, and neither unseats the other', () => {
    activateAnalysisView('case-a', {
      id: 'v_board', mode: 'live', surface: 'board',
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    });
    activateAnalysisView('case-a', {
      id: 'v_time', mode: 'live', surface: 'timeline', spec: { timeline: { tracks: [] } },
    });

    expect(catalogViews.activeView?.id).toBe('v_board');
    expect(timelineViews.activeView?.id).toBe('v_time');
    // a timeline recipe carries no catalog question, and must not impose its absence
    expect(analysisSearch.filter.q).toBe('port');

    leaveAnalysisView('case-a', 'timeline', { clear: true });
    expect(timelineViews.activeView).toBeNull();
    expect(catalogViews.activeView?.id).toBe('v_board');
    expect(analysisSearch.filter.q).toBe('port');
  });

  it('marks only the catalog modified when the shared question changes', () => {
    activateAnalysisView('case-a', {
      id: 'v_time', mode: 'live', surface: 'timeline', spec: { timeline: { tracks: [] } },
    });
    activateAnalysisView('case-a', {
      id: 'v_board', mode: 'live', surface: 'board',
      spec: { query: { filter: { ...emptyFilter(), q: 'port' } } },
    });

    setAnalysisFilter('case-a', { ...emptyFilter(), q: 'harbour' });

    expect(catalogViews.modified).toBe(true);
    expect(timelineViews.modified).toBe(false);
    expect(timelineViews.changeVersion).toBe(0);
  });

  it('answers an autosave into the family the saved view belongs to', () => {
    const view = { id: 'v_time', mode: 'live', surface: 'timeline', spec: { timeline: {} } };
    activateAnalysisView('case-a', view);

    expect(adoptSavedAnalysisView('case-a', { ...view, updated_at: 'later' })).toBe(true);
    expect(timelineViews.activeView.updated_at).toBe('later');
    expect(catalogViews.activeView).toBeNull();
  });

  it('carries a rename onto the open reading, spec and family untouched', () => {
    const spec = { timeline: { tracks: [] } };
    activateAnalysisView('case-a', {
      id: 'v_time', name: 'Tracks', mode: 'live', surface: 'timeline', spec,
    });

    expect(renameAnalysisView('case-a', 'v_time', 'Convoy tracks')).toBe(true);
    expect(timelineViews.activeView.name).toBe('Convoy tracks');
    // The autosave sends the name it is holding, so an unrenamed spec would be
    // written back with the old label — the recipe itself stays the same object.
    expect(timelineViews.activeView.spec).toBe(spec);
    expect(catalogViews.activeView).toBeNull();

    expect(renameAnalysisView('case-a', 'v_other', 'Nowhere')).toBe(false);
    expect(renameAnalysisView('case-b', 'v_time', 'Wrong case')).toBe(false);
    expect(timelineViews.activeView.name).toBe('Convoy tracks');
  });

  it('empties both families at the case boundary', () => {
    activateAnalysisView('case-a', { id: 'v_board', mode: 'live', surface: 'board', spec: {} });
    activateAnalysisView('case-a', { id: 'v_time', mode: 'live', surface: 'timeline', spec: {} });

    openAnalysisCase('case-b');

    expect(catalogViews.activeView).toBeNull();
    expect(timelineViews.activeView).toBeNull();
    expect(analysisSearch.period.from).toBe('');
  });
});
