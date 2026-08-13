import { describe, expect, it } from 'vitest';
import {
  analysisPeriodQuery,
  analysisPeriodSpec,
  emptyAnalysisPeriod,
  hasAnalysisPeriod,
  normalizeAnalysisPeriod,
} from './analysisPeriod.js';

describe('the shared fact-time period', () => {
  const period = {
    from: '2026-08-12T09:00:00Z',
    to: '2026-08-12T11:00:00Z',
    categories: ['statement', 'case_activity', 'unknown'],
  };

  it('keeps only a complete ordered window and known categories', () => {
    expect(normalizeAnalysisPeriod(period)).toEqual({
      from: period.from,
      to: period.to,
      categories: ['statement', 'case_activity'],
    });
    expect(hasAnalysisPeriod(period)).toBe(true);
    expect(normalizeAnalysisPeriod({ from: period.to, to: period.from }))
      .toEqual(emptyAnalysisPeriod());
  });

  it('spells a separate server query instead of reusing filing dates', () => {
    expect(analysisPeriodQuery(period)).toEqual({
      temporalFrom: period.from,
      temporalTo: period.to,
      temporalCategories: ['statement', 'case_activity'],
    });
  });

  it('round-trips through an analysis view spec', () => {
    expect(analysisPeriodSpec(period)).toEqual({
      from: period.from,
      to: period.to,
      field: 'fact-time',
      categories: ['statement', 'case_activity'],
    });
  });
});
