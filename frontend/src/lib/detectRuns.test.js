import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const get = vi.fn();
const toast = vi.fn();
const reloadCase = vi.fn(async () => {});
const uiState = { tool: 'media', openAnalyzer: null };
vi.mock('./api.js', () => ({ api: { get } }));
vi.mock('./state.svelte.js', () => ({ toast, reloadCase, uiState }));
const { POLL_MS, detectRuns, openDetect, refreshRuns } = await import('./detectRuns.svelte.js');

const row = (status, extra = {}) => ({ id: 'aaaaaaaaaaaa', title: 'Harbour', status, count: 0, ...extra });

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});
afterEach(async () => {
  get.mockResolvedValue([]);
  await refreshRuns(null);
  vi.useRealTimers();
});

it('reads once and stops when nothing is working', async () => {
  get.mockResolvedValue([row('ready', { count: 2 })]);
  await refreshRuns('case-a');
  expect(get).toHaveBeenCalledWith('/api/cases/case-a/analysis/runs');
  await vi.advanceTimersByTimeAsync(POLL_MS * 3);
  expect(get).toHaveBeenCalledTimes(1);
  // a run that was already finished when the case opened is not news
  expect(toast).not.toHaveBeenCalled();
});

it('keeps reading while a run works, then says it finished and how to get to it', async () => {
  get.mockResolvedValueOnce([row('running', { progress: 1, total: 4 })])
    .mockResolvedValueOnce([row('running', { progress: 3, total: 4 })])
    .mockResolvedValue([row('ready', { count: 3 })]);
  await refreshRuns('case-a');
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(detectRuns.rows[0].progress).toBe(3);
  await vi.advanceTimersByTimeAsync(POLL_MS);
  expect(toast).toHaveBeenCalledWith('Harbour: 3 candidates to review', 'ok', 8000,
    expect.objectContaining({ label: 'Review' }));
  expect(reloadCase).toHaveBeenCalledTimes(1);
  toast.mock.calls[0][3].onClick();
  expect(uiState).toMatchObject({ tool: 'detect', openAnalyzer: 'runs-aaaaaaaaaaaa' });
  await vi.advanceTimersByTimeAsync(POLL_MS * 3);
  expect(get).toHaveBeenCalledTimes(3);
});

it('announces a run that settled before any read saw it working', async () => {
  get.mockResolvedValueOnce([]).mockResolvedValue([row('failed', { message: 'no recent pass' })]);
  await refreshRuns('case-a');
  await refreshRuns('case-a');
  expect(toast).toHaveBeenCalledWith('Harbour failed: no recent pass', 'warn', 8000, null);
});

it('never announces another case\'s runs after a switch', async () => {
  get.mockResolvedValueOnce([row('running')]).mockResolvedValue([row('ready', { count: 1 })]);
  await refreshRuns('case-a');
  get.mockResolvedValue([]);
  await refreshRuns('case-b');
  await vi.advanceTimersByTimeAsync(POLL_MS * 2);
  expect(detectRuns.caseId).toBe('case-b');
  expect(toast).not.toHaveBeenCalled();
});

it('opens Detect on the item named', () => {
  openDetect('followups-bbbbbbbbbbbb');
  expect(uiState).toMatchObject({ tool: 'detect', openAnalyzer: 'followups-bbbbbbbbbbbb' });
});
