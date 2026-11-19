import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Archive every link: the calls, the run followed tab-wide until it ends, and the words
 * the dialog, the note's header and the toast say.
 */

const { get, post, toast } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), toast: vi.fn() }));
vi.mock('../api.js', () => ({ api: { get, post } }));
vi.mock('../state.svelte.js', () => ({ toast }));

const {
  POLL_MS, countWords, dayWords, endedToast, follow, followed, forgetRuns, isActive, leftWords, onEnded, planWords,
  progressWords, readPlan, readRun, rowMark, rowWords, startArchive, stopArchive,
} = await import('./linkArchive.svelte.js');

const run = (state, counts = {}, extra = {}) => ({
  state, links: [], counts: { total: 4, archived: 0, new: 0, kept: 0, older: 0, failed: 0, ...counts }, ...extra,
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  forgetRuns();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('the calls', () => {
  it('read the plan and the run, press, and stop, each at the note\'s address', async () => {
    get.mockResolvedValueOnce({ todo: 3 }).mockResolvedValueOnce({ todo: 4 }).mockResolvedValueOnce({ run: run('done') });
    await readPlan('c 1', 'n/1');
    await readPlan('c1', 'n1', { internal: true });
    expect(await readRun('c1', 'n1')).toMatchObject({ state: 'done' });
    expect(get.mock.calls.map(([path]) => path)).toEqual([
      '/api/cases/c%201/notes/n%2F1/archive', '/api/cases/c1/notes/n1/archive?internal=true', '/api/cases/c1/notes/n1/archive/run',
    ]);
    post.mockResolvedValueOnce({ run: run('queued') }).mockResolvedValueOnce({ run: run('stopping') });
    await startArchive('c1', 'n1', { fresh: true });
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/archive', { internal: false, fresh: true });
    expect(followed('c1', 'n1').state).toBe('queued');
    await stopArchive('c1', 'n1');
    expect(post).toHaveBeenLastCalledWith('/api/cases/c1/notes/n1/archive/stop', {});
    expect(followed('c1', 'n1').state).toBe('stopping');
  });
});

describe('a run followed until it ends', () => {
  it('is read again while it goes, then says how it ended and tells who listens', async () => {
    const heard = vi.fn();
    const stopHearing = onEnded(heard);
    get.mockResolvedValueOnce({ run: run('running', { archived: 2 }) })
      .mockResolvedValueOnce({ run: run('done', { archived: 4, new: 3, kept: 1 }) });
    follow('c1', 'n1', run('queued'), { title: 'Front' });
    expect(get).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(followed('c1', 'n1').counts.archived).toBe(2);
    expect(heard).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(followed('c1', 'n1').state).toBe('done');
    expect(toast).toHaveBeenCalledWith('Links of “Front” archived: 4 of 4 archived.', 'ok', 6500);
    expect(heard).toHaveBeenCalledWith('c1', 'n1', expect.objectContaining({ state: 'done' }));
    // and is read no more
    await vi.advanceTimersByTimeAsync(POLL_MS * 3);
    expect(get).toHaveBeenCalledTimes(2);
    stopHearing();
  });

  it('is not followed twice, and an ended one is never read', async () => {
    get.mockResolvedValue({ run: run('running') });
    follow('c1', 'n1', run('running'));
    follow('c1', 'n1', run('running'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(get).toHaveBeenCalledTimes(1);
    follow('c1', 'n2', run('done'));
    await vi.advanceTimersByTimeAsync(POLL_MS);
    expect(get.mock.calls.every(([path]) => path.includes('/n1/'))).toBe(true);
  });
});

describe('the words', () => {
  it('say days and times in this browser\'s time', () => {
    const at = new Date('2026-11-18T09:30:12Z');
    const clock = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
    expect(dayWords('2026-11-18T09:30:12Z', { time: true })).toBe(`${at.getDate()} Nov ${clock}`);
    expect(dayWords('2026-11-12')).toBe('12 Nov');
    expect(dayWords('')).toBe('');
    expect(dayWords('soon')).toBe('');
  });

  it('say the time left in round words', () => {
    expect(leftWords(0)).toBe('');
    expect(leftWords(40)).toBe('under a minute left');
    expect(leftWords(70)).toBe('about a minute left');
    expect(leftWords(12 * 60)).toBe('about 12 minutes left');
    expect(leftWords(3 * 3600)).toBe('about 3 hours left');
  });

  it('say what a press would do, once', () => {
    expect(planWords({ todo: 88, archived: 2, filed: 85 })).toBe('88 links to archive · 2 archived already · 85 filed as bookmarks');
    expect(planWords({ todo: 1, archived: 0, filed: 1 })).toBe('1 link to archive · 1 filed as a bookmark');
    expect(planWords({ todo: 0, archived: 3, filed: 0 })).toBe('0 links to archive · 3 archived already');
  });

  it('say how far a run is, in the dialog and in the note\'s header', () => {
    expect(countWords(run('running', { total: 88, archived: 34 }))).toBe('34 of 88 archived');
    expect(countWords(run('done', { total: 88, archived: 85, failed: 3 }))).toBe('85 of 88 archived · 3 failed');
    expect(progressWords(run('running', { total: 70, archived: 12 }))).toBe('Archiving 12 of 70…');
    expect(progressWords(run('stopping'))).toBe('Stopping the archiving…');
    expect(isActive(run('stopping'))).toBe(true);
    expect(isActive(run('stopped'))).toBe(false);
  });

  it('say each link\'s state and mark it', () => {
    const made = '2026-11-12T12:00:00Z';
    expect(rowWords({ state: 'kept', made })).toBe('copy of 12 Nov kept (under 30 days)');
    expect(rowWords({ state: 'older', made, gone: true })).toBe('no longer online · copy of 12 Nov linked');
    expect(rowWords({ state: 'older', made })).toBe('no new copy · copy of 12 Nov linked');
    expect(rowWords({ state: 'failed', reason: 'The page no longer answers.' })).toBe('The page no longer answers.');
    expect(rowWords({ state: 'saving' })).toBe('saving…');
    expect(rowWords({ state: 'waiting' })).toBe('waiting');
    expect(rowWords({ state: 'todo', held: true })).toBe('to archive');
    expect(rowWords({ state: 'todo', held: false })).toBe('to archive · new bookmark');
    expect(rowWords({ state: 'todo', reason: 'The page no longer answers.' })).toBe('last time: the page no longer answers.');
    expect(rowWords({ state: 'archived', made: '2026-03-02' })).toBe('archived 2 Mar');
    expect(['new', 'kept', 'archived', 'older', 'failed', 'saving', 'waiting'].map((state) => rowMark({ state })))
      .toEqual(['done', 'done', 'done', 'warn', 'failed', 'busy', 'waiting']);
  });

  it('say how a run ended in a toast', () => {
    expect(endedToast(run('stopped', { archived: 1 }, { reason: 'Could not reach the Internet Archive. What was done is kept.' }), 'Front'))
      .toEqual(['Archiving the links of “Front” stopped: 1 of 4 archived. Could not reach the Internet Archive. What was done is kept.', 'warn']);
    expect(endedToast(run('done', { archived: 3, failed: 1 })))
      .toEqual(['Links archived: 3 of 4 archived · 1 failed. Archive every link tries the rest again.', 'warn']);
  });
});
