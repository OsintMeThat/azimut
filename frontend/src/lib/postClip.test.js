import { describe, expect, it, vi } from 'vitest';

vi.mock('./api.js', () => ({ api: { get: vi.fn(), post: vi.fn() } }));

import { clipLength, clipWords, cutClip, cuttable, readClip } from './postClip.js';

/** Cut for the post, as the Scene tab asks for it: which passages, the job, the words. */

const CLIP = { path: 'media/clip 0m30s–0m45s.mp4', start: 30, end: 45, size: 2_202_009, title: 'clip 0m30s–0m45s' };

describe('which passages can be cut', () => {
  it('is a stretch of half a second to ten minutes, never an instant', () => {
    expect(cuttable({ start: 30, end: 45 })).toBe(true);
    expect(cuttable({ start: 30, end: null })).toBe(false);
    expect(cuttable({ start: 30, end: 30.2 })).toBe(false);
    expect(cuttable({ start: 0, end: 600 })).toBe(true);
    expect(cuttable({ start: 0, end: 601 })).toBe(false);
  });
});

describe('a clip in words', () => {
  it('says its passage, its length and its size', () => {
    expect(clipWords(CLIP)).toBe('0:30–0:45 · 15 s · 2.1 MB');
    expect(clipWords({ ...CLIP, size: null })).toBe('0:30–0:45 · 15 s');
    expect(clipWords(null)).toBe('');
    expect(clipWords(CLIP, { passage: false })).toBe('15 s · 2.1 MB');
  });

  it('says a short length in seconds and a long one as a clock', () => {
    expect(clipLength(0.8)).toBe('1 s');
    expect(clipLength(28.4)).toBe('28 s');
    expect(clipLength(125)).toBe('2:05');
    expect(clipLength(0)).toBe('');
  });
});

describe('the cut', () => {
  it('reads the clip a proof keeps', async () => {
    const get = vi.fn(async () => ({ proof: 'Bridge', video: 'media/clip.mp4', clip: CLIP }));
    expect(await readClip('c 1', 'Road bridge', { get })).toEqual({ video: 'media/clip.mp4', clip: CLIP });
    expect(get).toHaveBeenCalledWith('/api/cases/c%201/proofs/Road%20bridge/clip');
  });

  it('answers at once with a clip the case already holds', async () => {
    const post = vi.fn(async () => ({ clip: CLIP }));
    const get = vi.fn();
    expect(await cutClip('c', 'Bridge', { start: 30, end: 45 }, { post, get })).toEqual(CLIP);
    expect(post).toHaveBeenCalledWith('/api/cases/c/proofs/Bridge/clip', { start: 30, end: 45 });
    expect(get).not.toHaveBeenCalled();
  });

  it('follows the job, saying how far it got, to the clip it filed', async () => {
    const post = vi.fn(async () => ({ job_id: 'j1' }));
    const steps = [
      { status: 'running', progress: {} },
      { status: 'running', progress: { percent: 40 } },
      { status: 'done', result: { clip: CLIP } },
    ];
    const get = vi.fn(async () => steps.shift());
    const heard = [];
    const clip = await cutClip('c', 'Bridge', { start: 30, end: 45 }, { post, get, onprogress: (p) => heard.push(p), sleep: async () => {} });
    expect(clip).toEqual(CLIP);
    expect(heard).toEqual([0, 40]);
    expect(get).toHaveBeenCalledWith('/api/jobs/j1');
  });

  it('says why a cut stopped', async () => {
    const post = vi.fn(async () => ({ job_id: 'j1' }));
    const get = vi.fn(async () => ({ status: 'error', error: 'ffmpeg could not cut this video' }));
    await expect(cutClip('c', 'Bridge', { start: 30, end: 45 }, { post, get, sleep: async () => {} })).rejects.toThrow(
      'ffmpeg could not cut this video',
    );
  });

  it('stops following quietly once the caller moved on', async () => {
    const post = vi.fn(async () => ({ job_id: 'j1' }));
    const get = vi.fn();
    expect(await cutClip('c', 'Bridge', { start: 30, end: 45 }, { post, get, isStale: () => true })).toBeNull();
    expect(get).not.toHaveBeenCalled();
  });
});
