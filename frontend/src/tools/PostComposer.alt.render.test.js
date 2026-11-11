// @vitest-environment happy-dom
/**
 * Alt text in Post, actually mounted: one quiet box beside the post's first picture,
 * off by default. Off, the post is the one it always was: no field, the same draft and
 * the same hand-off. On, every picture of every post gets a field (never a video), with
 * its first words from the case, a counter against the platform's limit and Copy; the
 * draft keeps the texts by picture, and the extension takes them beside the files.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('konva', () => ({ default: {} }));

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(async () => ({})), post: vi.fn(), del: vi.fn(async () => ({})) },
}));
vi.mock('../lib/api.js', () => ({ api }));

const bridge = vi.hoisted(() => ({ installed: null, handOffPost: null }));
vi.mock('../lib/extBridge.js', () => ({
  extensionVersion: () => bridge.installed,
  extensionOutdated: () => false,
  handOffPost: (...args) => bridge.handOffPost(...args),
  onPostLinkCaught: () => () => {},
  onPostHandoffReport: () => () => {},
}));

// a thread's contact sheet is drawn by a canvas happy-dom has not: its path is what matters here
const sheets = vi.hoisted(() => ({ file: null }));
vi.mock('./post/threadSheet.js', () => ({ fileThreadSheet: (...args) => sheets.file(...args) }));

const { caseState, prefs, templatesState, uiState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');
const { startPost } = await import('./post/start.js');
const { EXTENSION_WINDOW_KEY } = await import('./post/extensionWindow.js');
const { ALT_BOX_TITLE } = await import('../lib/postAlt.js');

const CASE = { id: 'case-1', folders: [], entities: [] };
const SOURCE_X = 'https://x.com/someone/status/1850000000000000000';
const DESCRIPTION = 'A formation of 13 helicopters was spotted heading East';
const PROOF = {
  title: 'Proof 3', description: DESCRIPTION, when: null, coordsText: '10.303315, -66.874095', source: SOURCE_X,
  png: 'proofs/helicopters.png',
};
const GEO = { lat: 10.303315, lon: -66.874095, dms: '10°18′11.9″N 66°52′26.7″W', plus_code: '76XH+8F5' };
const CLASSIC_KEYS = [
  'description', 'coordsText', 'place', 'mention', 'source', 'date', 'proofPng', 'tweet1', 'tweet1Edited',
  'target', 'body', 'mediaEnabled', 'mediaType', 'mediaText', 'mediaTextIncludesPrefix', 'mediaPaths',
  'mediaPath', 'extraTweets',
];
const MEDIA = [
  { path: 'media/before.png', kind: 'image', title: 'Before' },
  { path: 'media/after.png', kind: 'image', title: 'After' },
  { path: 'media/clip.mp4', kind: 'video', title: 'Clip' },
];

const VIDEO = 'media/convoy.mp4';
const SHEET = 'media/Convoy on the coast road contact sheet.jpg';
const scene = (proof, title, coords, extra = {}) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments: [], at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }],
  description: null, when: null, when_zone: null, ...extra,
});
const SCENES = {
  video: VIDEO,
  scenes: [
    scene('bridge', 'Road bridge', '48.850000, 2.350000', { description: 'The convoy crosses the road bridge' }),
    scene('gate', 'Port gate', '48.860000, 2.360000'),
    scene('village', 'Hilltop village', '48.870000, 2.370000'),
  ],
};
const slideRow = (name, title, slide) => ({
  name, title, updated_at: '2026-11-08T10:00:00Z', png: `proofs/${name}.png`, thumb: null,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 3, order: slide - 1,
});

let target;
let app;
let lists;
let clipboard;

function answer(path) {
  if (path === `/api/cases/${CASE.id}`) return CASE;
  if (path.endsWith('/drafts')) return lists.drafts;
  if (path.endsWith('/proofs')) return lists.proofs;
  if (path.endsWith('/media')) return lists.media;
  if (path.includes('/scenes?video=')) return SCENES;
  if (path.includes('/inspect/probe')) return { kind: 'video', duration: 95 };
  if (path.startsWith('/api/geo/reverse')) return { address: { village: 'Los Anacuos', state: 'Miranda', country: 'Venezuela' } };
  const draft = /\/drafts\/(.+)$/.exec(path);
  if (draft) return lists.saved[decodeURIComponent(draft[1])];
  const spec = /\/proofs\/([^/]+)$/.exec(path);
  if (spec) return lists.specs[decodeURIComponent(spec[1])] ?? null;
  // every file the case holds is found again, so nothing reads as deleted
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
  if (path.includes('/derivation')) return { entities: [], links: [] };
  if (path.includes('/entities')) return { items: [], next: null };
  return [];
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const saved = async () => {
  await new Promise((resolve) => setTimeout(resolve, 850));
  await settle();
};
const draftWrites = () => api.post.mock.calls.filter(([path]) => path.endsWith('/drafts'));
const lastState = () => draftWrites().at(-1)[1].state;
const mountPost = async () => {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(PostComposer, { target });
  flushSync();
  await settle();
};
const box = () => target.querySelector('.alt-box input');
const fields = () => [...target.querySelectorAll('.alt-input')];
const field = (name) => target.querySelector(`.alt-input[aria-label="Alt text for ${name}"]`);
const tick = async (on) => {
  box().checked = on;
  box().dispatchEvent(new Event('change', { bubbles: true }));
  await settle();
};
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
};
const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === name);

beforeEach(() => {
  vi.clearAllMocks();
  lists = { drafts: [], proofs: [], media: MEDIA, saved: {}, specs: { helicopters: { description: DESCRIPTION } } };
  api.get.mockImplementation(async (path) => answer(path));
  api.put.mockImplementation(async () => ({}));
  api.post.mockImplementation(async (path, body) => {
    if (path === '/api/geo/parse') return GEO;
    if (path.endsWith('/drafts')) return { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` };
    return {};
  });
  sheets.file = vi.fn(async () => SHEET);
  bridge.installed = null;
  bridge.handOffPost = vi.fn(async () => true);
  prefs.postTemplate = '';
  prefs.postKindTemplates = {};
  prefs.postMention = '@GeoConfirmed';
  prefs.postTarget = 'x';
  prefs.postPrefill = true;
  prefs.postAltText = false;
  templatesState.post = [];
  uiState.toasts.splice(0);
  uiState.tool = 'post';
  uiState.postProof = null;
  uiState.postStart = null;
  caseState.current = CASE;
  localStorage.setItem(EXTENSION_WINDOW_KEY, 'not-now');
  clipboard = vi.fn(async () => {});
  vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: clipboard } });
  vi.stubGlobal('open', vi.fn());
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  document.querySelectorAll('.overlay').forEach((node) => node.remove());
  caseState.current = null;
  uiState.tool = 'overview';
  uiState.postStart = null;
  uiState.postProof = null;
  prefs.postAltText = false;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the box off', () => {
  it('shows one quiet box beside the proof, and no field', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    expect(target.querySelectorAll('.alt-box')).toHaveLength(1);
    expect(box().checked).toBe(false);
    expect(box().closest('.alt-box').title).toBe(ALT_BOX_TITLE);
    expect(box().closest('.media-attach')).not.toBeNull();
    expect(fields()).toHaveLength(0);
  });

  it('saves the draft and hands the thread over exactly as before', async () => {
    bridge.installed = '0.3.4';
    await mountPost();
    uiState.postProof = { ...PROOF };
    await saved();
    expect(Object.keys(lastState())).toEqual(CLASSIC_KEYS);
    target.querySelector('[data-guide="post.publish"]').click();
    await settle();
    const [message] = bridge.handOffPost.mock.calls[0];
    expect(message.posts).toEqual([{ text: lastState().tweet1, files: [PROOF.png] }]);
  });

  it('shows no box on a post without a picture', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF, png: null };
    await settle();
    expect(target.querySelector('.alt-box')).toBeNull();
  });
});

describe('the box on', () => {
  it('gives the proof its sentence, keeps the choice for the next posts, and saves the text by picture', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await tick(true);
    expect(api.put).toHaveBeenCalledWith('/api/settings/prefs', { post_alt_text: true });
    expect(prefs.postAltText).toBe(true);
    // under the proof's own preview: no second picture beside its field
    expect(field('helicopters.png').value).toBe(DESCRIPTION);
    expect(target.querySelector('.alt-thumb')).toBeNull();
    await saved();
    expect(Object.keys(lastState())).toEqual([...CLASSIC_KEYS, 'alt']);
    expect(lastState().alt).toEqual({ [PROOF.png]: DESCRIPTION });
  });

  it('puts a field under each picture of each post, and none under a video', async () => {
    prefs.postAltText = true;
    await mountPost();
    startPost('free', ['media/before.png', 'media/after.png', 'media/clip.mp4']);
    await settle();
    expect(fields().map((one) => one.getAttribute('aria-label'))).toEqual(['Alt text for before.png', 'Alt text for after.png']);
    // a free post's pictures are the analyst's own: nothing to start from
    expect(fields().map((one) => one.value)).toEqual(['', '']);
    expect(target.querySelectorAll('.alt-box')).toHaveLength(1);
    expect(box().checked).toBe(true);
  });

  it('counts against the platform picked, and Copy copies the text', async () => {
    prefs.postAltText = true;
    await mountPost();
    startPost('free', ['media/before.png']);
    await settle();
    const row = () => field('before.png').closest('.alt-row');
    type(field('before.png'), 'é'.repeat(1001));
    expect(row().querySelector('.alt-count').textContent).toBe('1001/1000');
    expect(row().querySelector('.alt-count').classList.contains('over')).toBe(true);
    button(target.querySelector('.target-tabs'), 'Bluesky').click();
    flushSync();
    expect(row().querySelector('.alt-count').textContent).toBe('1001/2000');
    expect(row().querySelector('.alt-count').classList.contains('over')).toBe(false);
    type(field('before.png'), 'A depot seen from the north');
    button(row(), 'Copy').click();
    await settle();
    expect(clipboard).toHaveBeenCalledWith('A depot seen from the north');
  });

  it('gives a Compare picture its name and dates as the start gave them', async () => {
    prefs.postAltText = true;
    await mountPost();
    startPost('compare', ['media/after.png'], { title: 'Kherson bridge', span: { before: '2024-05-01', after: '2025-06-01' } });
    await settle();
    expect(field('after.png').value).toBe('Kherson bridge, 2024-05-01 → 2025-06-01');
  });

  it('starts a field once: a text cleared stays cleared', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await tick(true);
    type(field('helicopters.png'), '');
    await tick(false);
    await tick(true);
    expect(field('helicopters.png').value).toBe('');
    await saved();
    expect('alt' in lastState()).toBe(false);
  });

  it('keeps nothing once the box is off, and the texts come back on', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await tick(true);
    type(field('helicopters.png'), 'Thirteen helicopters over a ridge');
    await saved();
    expect(lastState().alt).toEqual({ [PROOF.png]: 'Thirteen helicopters over a ridge' });
    await tick(false);
    expect(fields()).toHaveLength(0);
    expect(prefs.postAltText).toBe(false);
    await saved();
    expect(Object.keys(lastState())).toEqual(CLASSIC_KEYS);
    await tick(true);
    expect(field('helicopters.png').value).toBe('Thirteen helicopters over a ridge');
  });

  it('hands each picture\'s text to the extension beside its file', async () => {
    bridge.installed = '0.3.4';
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await tick(true);
    type(field('helicopters.png'), 'Thirteen helicopters over a ridge');
    target.querySelector('[data-guide="post.publish"]').click();
    await settle();
    const [message] = bridge.handOffPost.mock.calls[0];
    expect(Object.keys(message)).toEqual(['url', 'caseId', 'posts', 'draft']);
    expect(message.posts).toEqual([
      { text: expect.any(String), files: [PROOF.png], alt: { [PROOF.png]: 'Thirteen helicopters over a ridge' } },
    ]);
  });
});

describe('a saved post', () => {
  const STATE = {
    description: DESCRIPTION, coordsText: PROOF.coordsText, place: 'Los Anacuos, Miranda, Venezuela', mention: '@GeoConfirmed',
    source: SOURCE_X, date: '', proofPng: PROOF.png, tweet1: 'Helicopters', tweet1Edited: true, target: 'x',
    body: undefined, mediaEnabled: true, mediaType: 'none', mediaText: '', mediaTextIncludesPrefix: true,
    mediaPaths: [], mediaPath: null, extraTweets: [],
  };
  const open = async (state) => {
    lists.drafts = [{ name: 'Helicopters', title: 'Helicopters', target: 'x', posts: 1 }];
    lists.saved = { Helicopters: { title: 'Helicopters', state } };
    await mountPost();
    uiState.openDraft = 'Helicopters';
    await settle();
  };

  it('opens with its texts and its box on, whatever the preference', async () => {
    await open({ ...STATE, alt: { [PROOF.png]: 'Thirteen helicopters over a ridge' } });
    expect(box().checked).toBe(true);
    expect(field('helicopters.png').value).toBe('Thirteen helicopters over a ridge');
    // opening writes nothing
    await saved();
    expect(draftWrites()).toHaveLength(0);
  });

  it('opens as it always did with the box off', async () => {
    await open(STATE);
    expect(box().checked).toBe(false);
    expect(fields()).toHaveLength(0);
    await saved();
    expect(draftWrites()).toHaveLength(0);
  });

  it('opens with its first words when the box is on, and writes nothing until it changes', async () => {
    prefs.postAltText = true;
    await open(STATE);
    expect(field('helicopters.png').value).toBe(DESCRIPTION);
    await saved();
    expect(draftWrites()).toHaveLength(0);
    type(field('helicopters.png'), 'Thirteen helicopters');
    await saved();
    expect(lastState().alt).toEqual({ [PROOF.png]: 'Thirteen helicopters' });
  });

  it('stays posted when its first words arrive on opening', async () => {
    prefs.postAltText = true;
    const posted = { ...STATE, publish: { site: 'x', posted_at: '2026-11-09T10:00:00Z' } };
    await open(posted);
    expect(field('helicopters.png').value).toBe(DESCRIPTION);
    expect(target.querySelector('.tool-header').textContent).not.toContain('Changed since posted');
  });
});

describe('a video thread', () => {
  it('describes its contact sheet by its places, and each place\'s picture by its sentence', async () => {
    prefs.postAltText = true;
    lists.proofs = [slideRow('bridge', 'Road bridge', 1), slideRow('gate', 'Port gate', 2), slideRow('village', 'Hilltop village', 3)];
    lists.media = [{ path: VIDEO, kind: 'video', title: 'Convoy on the coast road', size: 48_000_000, source: { type: 'upload' } }];
    await mountPost();
    startPost('video', [VIDEO]);
    await settle();
    await settle();
    expect(field('Convoy on the coast road contact sheet.jpg').value)
      .toBe('Pictures of the 3 places geolocated in the video, numbered as in the post');
    expect(field('bridge.png').value).toBe('The convoy crosses the road bridge');
    expect(field('gate.png').value).toBe('');
    // the video's own post has no field
    expect(fields()).toHaveLength(4);
    type(field('gate.png'), 'A port gate behind a fence');
    await saved();
    expect(lastState().alt).toEqual({
      [SHEET]: 'Pictures of the 3 places geolocated in the video, numbered as in the post',
      'proofs/bridge.png': 'The convoy crosses the road bridge',
      'proofs/gate.png': 'A port gate behind a fence',
    });
  });
});
