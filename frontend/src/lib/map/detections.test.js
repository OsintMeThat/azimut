import { describe, expect, it } from 'vitest';
import {
  detectionsWithRuns,
  isActive,
  ruleLabel,
  runDays,
  runState,
  savedGroups,
  settledMessage,
  singleRuns,
} from './detections.js';

const watch = (id, title = id) => ({ id, title });
const run = (id, followup_id, extra = {}) => ({ id, followup_id, title: 'Harbour', status: 'ready',
  count: 0, to_review: 0, dates: ['2026-09-01', '2026-09-06'], ...extra });

describe('detections and their runs', () => {
  it('gives each detection its own history, newest first, and the run working now', () => {
    const runs = [run('r3', 'w1', { status: 'running' }), run('r2', 'w2'), run('r1', 'w1')];
    const [one, two] = detectionsWithRuns([watch('w1'), watch('w2')], runs);
    expect(one.history.map((r) => r.id)).toEqual(['r3', 'r1']);
    expect(one.latest.id).toBe('r3');
    expect(one.active.id).toBe('r3');
    expect(two.active).toBe(null);
  });

  it('keeps runs of a deleted detection among the single runs rather than losing them', () => {
    const runs = [run('r1', null), run('r2', 'gone'), run('r3', 'w1')];
    expect(singleRuns([watch('w1')], runs).map((r) => r.id)).toEqual(['r1', 'r2']);
  });

  it('groups the saved runs under their routine, then the passes swept once', () => {
    const runs = [run('r1', null, { created_at: '2026-09-01' }), run('r2', 'w2', { created_at: '2026-09-02' }),
      run('r3', 'gone', { created_at: '2026-09-03' }), run('r4', 'w2', { created_at: '2026-09-04' })];
    const groups = savedGroups([watch('w1', 'Idle'), watch('w2', 'Harbour weekly')], runs);
    expect(groups.map((group) => [group.kind, group.title])).toEqual([['routine', 'Harbour weekly'], ['once', 'One passes']]);
    expect(groups[0].runs.map((r) => r.id)).toEqual(['r4', 'r2']);
    // a deleted routine's runs are kept, with the passes swept once
    expect(groups[1].runs.map((r) => r.id)).toEqual(['r3', 'r1']);
    expect(savedGroups([watch('w2')], [run('r2', 'w2')]).map((group) => group.kind)).toEqual(['routine']);
  });

  it('names the two days a run compared', () => {
    expect(runDays(run('r', 'w'))).toBe('2026-09-01 → 2026-09-06');
    expect(runDays(run('r', 'w', { dates: ['2026-09-06', '2026-09-06'] }))).toBe('2026-09-06');
    expect(runDays(run('r', 'w', { dates: [] }))).toBe('');
  });

  it('knows queued and running from everything else', () => {
    expect(['queued', 'running', 'ready', 'failed'].map((status) => isActive({ status })))
      .toEqual([true, true, false, false]);
  });
});

describe('what a row says', () => {
  it('leads a finished run with the day of the pass it swept', () => {
    expect(runState(run('r', 'w', { count: 5, to_review: 3 }))).toEqual({ tone: 'new', text: '2026-09-06 · 3 to review' });
    expect(runState(run('r', 'w', { count: 2 })).text).toBe('2026-09-06 · 2 candidates, all reviewed');
    expect(runState(run('r', 'w')).text).toBe('2026-09-06 · nothing found');
    expect(runState(run('r', 'w', { dates: [] })).text).toBe('Nothing found');
  });

  it('says where an unfinished run stands', () => {
    expect(runState(null).text).toBe('Not run yet');
    expect(runState({ status: 'running', progress: 3, total: 40 }).text).toBe('Running · 3/40 tiles');
    expect(runState({ status: 'failed', message: 'no recent pass' })).toEqual({ tone: 'warn', text: 'Failed · no recent pass' });
    expect(runState({ status: 'no_new_imagery' }).text).toBe('No new pass since the last run');
  });

  it('names the date rule, with no reference for a one-image method', () => {
    expect(ruleLabel('manual', false)).toBe('fixed dates');
    expect(ruleLabel('latest_previous', true)).toBe('newest pass');
    expect(ruleLabel('latest_previous', false)).toBe('newest pass against the last run');
    expect(ruleLabel('latest_reference', false)).toBe('newest pass against a reference');
  });

  it('announces a settled run, and says nothing of a cancelled one', () => {
    expect(settledMessage(run('r', 'w', { count: 1 }))).toEqual({ text: 'Harbour: 1 candidate to review', kind: 'ok' });
    expect(settledMessage(run('r', 'w')).text).toBe('Harbour: nothing passed the thresholds');
    expect(settledMessage({ title: 'Harbour', status: 'failed', message: 'offline' }).kind).toBe('warn');
    expect(settledMessage({ title: 'Harbour', status: 'cancelled' })).toBe(null);
  });
});
