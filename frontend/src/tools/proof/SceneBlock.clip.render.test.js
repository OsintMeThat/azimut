// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';

// the server as the Scene tab reaches it: the player's probe, the clip, its job and its delete
const server = vi.hoisted(() => ({ clip: null, jobs: [], posts: [], deletes: [] }));
vi.mock('../../lib/api.js', () => ({
  api: {
    get: vi.fn(async (url) => {
      if (url.endsWith('/clip')) return { proof: 'depot', video: 'media/clip.mp4', clip: server.clip };
      if (url.startsWith('/api/jobs/')) return server.jobs.shift();
      return { kind: 'video', duration: 400, fps: 25 };
    }),
    post: vi.fn(async (url, body) => {
      server.posts.push({ url, body });
      if (url.endsWith('/delete-impact')) {
        return {
          blocking: [], cascade: [], tombstone: [],
          touched: [{ id: 'e_p', type: 'proof', label: 'depot', path: 'proofs/.meta/depot.json', how: ['keeps it as the clip for its post'] }],
          counts: { blocking: 0, cascade: 0, tombstone: 0, touched: 1 },
        };
      }
      return { job_id: 'j1' };
    }),
    del: vi.fn(async (url) => {
      server.deletes.push(url);
      return { status: 'deleted', deleted: ['e_c'], trash: 't1' };
    }),
  },
}));

import SceneBlock from './SceneBlock.svelte';
import { ProofScene } from './proofScene.svelte.js';
import { uiState } from '../../lib/state.svelte.js';

/**
 * Cut for the post, in the Scene tab: one quiet line under the video's field that cuts
 * a passage into a clip of its own, says how far the cut got, then the clip's passage,
 * length and size, with Show in Media and Remove.
 */

const CLIP = 'media/clip.mp4';
const CUT = { path: 'media/clip 2m10s–2m38s.mp4', start: 130, end: 158, size: 4_404_019, title: 'clip 2m10s–2m38s' };

let live = [];
let targets = [];

beforeEach(() => {
  globalThis.ResizeObserver ??= class { observe() {} disconnect() {} };
  Object.assign(server, { clip: null, jobs: [], posts: [], deletes: [] });
});

afterEach(() => {
  for (const one of live) unmount(one);
  live = [];
  for (const node of targets) node.remove();
  targets = [];
  document.body.innerHTML = '';
});

function setup({ moments = [{ start: 130, end: 158 }], name = 'depot', active = true } = {}) {
  const api = { put: vi.fn() };
  const frames = [{ panel: 'p1', video: CLIP, time: 130.4 }];
  const scene = new ProofScene({ api, toast: vi.fn(), where: () => ({ caseId: 'case', name }), frames: () => frames });
  scene.load({ video: CLIP, moments });
  const target = document.createElement('div');
  document.body.append(target);
  targets.push(target);
  live.push(mount(SceneBlock, { target, props: { scene, caseId: 'case', active, onaddframe: vi.fn() } }));
  flushSync();
  return { root: target, scene };
}

const line = (root) => root.querySelector('[data-testid="scene-clip"]');
const words = (node) => node?.textContent.replace(/\s+/g, ' ').trim() ?? '';
const button = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === text);
const settle = async (turns = 3) => {
  for (let i = 0; i < turns; i += 1) {
    await tick();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();
  }
};

describe('Cut for the post', () => {
  it('is one quiet line on a saved proof\'s passage', async () => {
    const { root } = setup();
    await settle();
    expect(words(line(root))).toBe('Cut for the post');
    expect(button(root, 'Cut for the post').getAttribute('title')).toBe('Cut this passage into a short video for the post, filed in Media');
  });

  it('cuts the passage, says how far it got, then the clip with its length and size', async () => {
    server.jobs = [
      { status: 'running', progress: { percent: 40 } },
      { status: 'done', result: { clip: CUT } },
    ];
    const { root } = setup();
    await settle();
    button(root, 'Cut for the post').click();
    await settle();
    expect(server.posts).toEqual([{ url: '/api/cases/case/proofs/depot/clip', body: { start: 130, end: 158 } }]);
    expect(words(line(root))).toBe('Cutting 2:10–2:38… 40%');
    expect(line(root).querySelector('[role="status"]')).not.toBeNull();
    // the next look at the job, half a second on
    await new Promise((resolve) => setTimeout(resolve, 650));
    await settle();
    expect(words(line(root))).toBe('Clip · 28 s · 4.2 MB Show in Media Remove');
  });

  it('shows the clip a proof already keeps, and takes the analyst to it in Media', async () => {
    server.clip = CUT;
    const { root } = setup();
    await settle();
    expect(words(line(root))).toBe('Clip · 28 s · 4.2 MB Show in Media Remove');
    button(root, 'Show in Media').click();
    expect(uiState.focusMedia).toBe(CUT.path);
    expect(uiState.tool).toBe('media');
  });

  it('removes the clip through the case trash, after the delete says the proof keeps it', async () => {
    server.clip = CUT;
    const { root } = setup();
    await settle();
    button(root, 'Remove').click();
    await settle();
    const dialog = document.querySelector('[role="alertdialog"]');
    expect(dialog.textContent).toContain('Remove the clip?');
    expect(dialog.textContent).toContain('keeps it as the clip for its post');
    expect(server.posts.at(-1)).toEqual({ url: '/api/cases/case/delete-impact', body: { ids: [], paths: [CUT.path], named: [] } });
    server.clip = null;
    button(dialog, 'Remove').click();
    await settle();
    expect(server.deletes).toEqual([`/api/cases/case/media?path=${encodeURIComponent(CUT.path)}`]);
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(words(line(root))).toBe('Cut for the post');
  });

  it('names the clip\'s passage when the proof states several', async () => {
    server.clip = { ...CUT, start: 190, end: 200 };
    const { root } = setup({ moments: [{ start: 30, end: 45 }, { start: 190, end: 200 }] });
    await settle();
    expect(words(line(root))).toBe('Clip · 3:10–3:20 · 10 s · 4.2 MB Show in Media Remove');
  });

  it('offers each passage of a proof that states several', async () => {
    const { root } = setup({ moments: [{ start: 30, end: 45 }, { start: 190, end: 200 }, { start: 312, end: null }] });
    await settle();
    expect(line(root).querySelector('.clip-what').textContent).toBe('Cut for the post');
    // a passage each, never the instant
    expect([...line(root).querySelectorAll('button')].map((b) => b.textContent)).toEqual(['0:30–0:45', '3:10–3:20']);
    button(root, '3:10–3:20').click();
    await settle();
    expect(server.posts[0].body).toEqual({ start: 190, end: 200 });
  });

  it('says why a cut stopped', async () => {
    server.jobs = [{ status: 'error', error: 'ffmpeg could not cut this video' }];
    const { root } = setup();
    await settle();
    button(root, 'Cut for the post').click();
    await settle(5);
    expect(root.querySelector('.clip-error').textContent).toBe('ffmpeg could not cut this video');
    expect(words(line(root))).toBe('Cut for the post');
  });

  it('is not there for an instant, the whole video, a proof never saved, or while the time changes', async () => {
    expect(line(setup({ moments: [{ start: 12, end: null }] }).root)).toBeNull();
    expect(line(setup({ moments: [] }).root)).toBeNull();
    expect(line(setup({ name: null }).root)).toBeNull();
    const { root } = setup();
    await settle();
    root.querySelector('.time').click();
    await settle();
    expect(line(root)).toBeNull();
  });
});
