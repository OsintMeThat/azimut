// @vitest-environment happy-dom
/**
 * A video thread in Post, actually mounted: offered only for a video of two proofs or
 * more, from New post, the home's series card and Geo Proof's strip; laid out in the
 * order picked, its contact sheet on the recap, the clip or the link offered when the
 * video is too long for the platform, saved as a draft and handed to the extension
 * like any thread.
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

// the sheet and the map are drawn by the browser's canvas, which happy-dom has not: what is
// asked of them, and their filing, are the subject here
const sheets = vi.hoisted(() => ({ file: null, map: null, preview: null, build: null }));
vi.mock('./post/threadSheet.js', () => ({
  fileThreadSheet: (...args) => sheets.file(...args),
  fileRecapMap: (...args) => sheets.map(...args),
}));
vi.mock('../lib/recapMap.js', async (original) => ({
  ...(await original()),
  recapMapPreview: (...args) => sheets.preview(...args),
  buildRecapMap: (...args) => sheets.build(...args),
}));

const { caseState, prefs, templatesState, uiState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');
const { EXTENSION_WINDOW_KEY } = await import('./post/extensionWindow.js');
const { VIDEO_THREAD_STARTERS } = await import('../lib/post.js');

const CASE = { id: 'case-1', folders: [], entities: [] };
const VIDEO = 'media/convoy.mp4';
const SHEET = 'media/Convoy on the coast road contact sheet.jpg';
const MAP = 'media/Convoy on the coast road recap map.jpg';
const CLIP = 'media/Convoy on the coast road 0m00s–0m07s.mp4';
const SOURCE = 'https://x.com/example/status/1';

const slideRow = (name, title, slide, extra = {}) => ({
  name, title, updated_at: '2026-11-08T10:00:00Z', png: `proofs/${name}.png`, thumb: null,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 3, order: slide - 1, ...extra,
});
const sceneRow = (proof, title, moments, coords, extra = {}) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments, at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }],
  description: null, when: null, when_zone: null, ...extra,
});
const SCENES = {
  video: VIDEO,
  scenes: [
    sceneRow('bridge', 'Road bridge', [{ start: 0, end: 7 }], '48.850000, 2.350000', {
      description: 'The convoy crosses the road bridge south of the port',
      clip: { path: CLIP, start: 0, end: 7, size: 2_100_000, title: 'Convoy 0m00s–0m07s' },
    }),
    sceneRow('gate', 'Port gate', [{ start: 15, end: null }], '48.860000, 2.360000'),
    sceneRow('village', 'Hilltop village', [], '48.870000, 2.370000', { at: [40] }),
  ],
};
const MEDIA = [
  { path: VIDEO, kind: 'video', title: 'Convoy on the coast road', size: 48_000_000, source: { type: 'download', url: SOURCE, webpage_url: SOURCE } },
  { path: 'media/lone.mp4', kind: 'video', title: 'Lone clip', size: 1_000_000, source: { type: 'upload' } },
];
// a thread opens with no title: the analyst gives one, or its line drops
const RECAP = '1. [0:00–0:07] Road bridge\n2. [0:15] Port gate\n3. Hilltop village\n\n@GeoConfirmed';
const PLACES = [
  'The convoy crosses the road bridge south of the port\n[0:00–0:07]\n\n48.850000, 2.350000',
  'Port gate\n[0:15]\n\n48.860000, 2.360000',
  'Hilltop village\n\n48.870000, 2.370000',
];

let target;
let app;
let lists;

function answer(path) {
  if (path === `/api/cases/${CASE.id}`) return CASE;
  if (path.endsWith('/drafts')) return lists.drafts;
  if (path.endsWith('/proofs')) return lists.proofs;
  if (path.endsWith('/media')) return MEDIA;
  if (path.includes('/scenes?video=')) return lists.scenes[decodeURIComponent(path.split('video=')[1])] ?? { video: null, scenes: [] };
  if (path.includes('/inspect/probe')) return { kind: 'video', duration: lists.seconds };
  const draft = /\/drafts\/(.+)$/.exec(path);
  if (draft) return lists.saved[decodeURIComponent(draft[1])];
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
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
const mountPost = async () => {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(PostComposer, { target });
  flushSync();
  await settle();
};
const home = () => target.querySelector('[data-testid="post-home"]');
const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.replace(/\s+/g, ' ').trim() === name);
const dialog = (name) => document.querySelector(`[role="dialog"][aria-label="${name}"]`);
const panel = () => target.querySelector('[data-testid="video-thread"]');
const posts = () => [...target.querySelectorAll('.tweet-block')].map((block) => ({
  num: block.querySelector('.tweet-num').textContent.trim(),
  label: block.querySelector('.tweet-head .label').textContent.trim(),
  text: block.querySelector('textarea')?.value ?? '',
}));
const toasts = () => uiState.toasts.map((t) => t.message);
const titleField = () => panel().querySelector('.vt-field input');
const recapPicture = () => panel().querySelector('[data-testid="recap-picture"]');
/** Recap first's picture: the proofs sheet, filed as the thread's recap carries it. */
async function pickSheet() {
  button(recapPicture(), 'Proofs sheet').click();
  await settle();
}
/** Make the map, filed for the recap. */
async function makeMap() {
  button(recapPicture(), 'Make the map').click();
  await settle();
}
function typeTitle(text) {
  titleField().value = text;
  titleField().dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** New post → Video thread → this video. */
async function startFromGallery(title = 'Convoy on the coast road') {
  await mountPost();
  button(home(), 'New post').click();
  await settle();
  [...dialog('New post').querySelectorAll('.np-card')][1].click();
  await settle();
  const row = [...dialog('Video thread').querySelectorAll('.vp-row')].find((one) => one.textContent.includes(title));
  row.click();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  lists = {
    drafts: [],
    proofs: [
      slideRow('bridge', 'Road bridge', 1), slideRow('gate', 'Port gate', 2), slideRow('village', 'Hilltop village', 3),
      slideRow('lone', 'Lone place', 1, { video: 'media/lone.mp4', video_title: 'Lone clip', slides: 1 }),
    ],
    saved: {},
    scenes: { [VIDEO]: SCENES, 'media/lone.mp4': { video: 'media/lone.mp4', scenes: [sceneRow('lone', 'Lone place', [], '1.0, 2.0')] } },
    seconds: 95,
  };
  api.get.mockImplementation(async (path) => answer(path));
  api.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/drafts')) return { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` };
    return {};
  });
  sheets.file = vi.fn(async () => SHEET);
  sheets.map = vi.fn(async () => MAP);
  sheets.preview = vi.fn(async () => ({ url: 'blob:preview', missing: 0, revoke: vi.fn() }));
  sheets.build = vi.fn(async () => ({ blob: new Blob(['map'], { type: 'image/jpeg' }), missing: 0 }));
  bridge.installed = null;
  bridge.handOffPost = vi.fn(async () => true);
  prefs.postTemplate = '';
  prefs.postKindTemplates = {};
  prefs.postMention = '@GeoConfirmed';
  prefs.postTarget = 'x';
  prefs.postPrefill = true;
  templatesState.post = [];
  templatesState.proof = [];
  prefs.proofTemplate = '';
  prefs.signatureHandle = '';
  uiState.toasts.splice(0);
  uiState.tool = 'post';
  uiState.postProof = null;
  uiState.postStart = null;
  caseState.current = CASE;
  localStorage.setItem(EXTENSION_WINDOW_KEY, 'not-now');
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
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('where a thread is offered', () => {
  it('New post → Video thread lists only the videos with two proofs or more', async () => {
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    [...dialog('New post').querySelectorAll('.np-card')][1].click();
    await settle();
    const rows = [...dialog('Video thread').querySelectorAll('.vp-row')].map((row) => row.textContent.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Convoy on the coast road 3 proofs']);
  });

  it('says so when no video has two proofs', async () => {
    lists.proofs = lists.proofs.slice(2);
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    [...dialog('New post').querySelectorAll('.np-card')][1].click();
    await settle();
    expect(dialog('Video thread').querySelectorAll('.vp-row')).toHaveLength(0);
    expect(dialog('Video thread').textContent).toContain('No video has two proofs to post yet');
  });

  it('the home\'s series card offers it for two proofs or more, and keeps each proof one press away', async () => {
    await mountPost();
    const series = [...home().querySelectorAll('.ph-video')];
    expect(series.map((one) => one.querySelector('h5').textContent)).toEqual(['Convoy on the coast road', 'Lone clip']);
    expect(button(series[0], 'Video thread')).toBeTruthy();
    expect(series[0].querySelectorAll('.ph-chip')).toHaveLength(3);
    // a video of one proof: its proof waits, and no thread is offered
    expect(button(series[1], 'Video thread')).toBeUndefined();
    expect(series[1].querySelectorAll('.ph-chip')).toHaveLength(1);

    button(series[0], 'Video thread').click();
    await settle();
    expect(target.querySelector('.kind-chip').textContent.trim()).toBe('Video thread');
    expect(posts()[0].text).toBe(RECAP);
  });

  it('a video that turns out to hold fewer than two proofs to post is no thread', async () => {
    await mountPost();
    uiState.postStart = { kind: 'video', media: ['media/lone.mp4'], about: null };
    await settle();
    expect(toasts()).toContain('This video has fewer than two proofs to post. Each one can go out as a geolocation.');
    expect(target.querySelector('[data-testid="video-thread"]')).toBeNull();
    expect(draftWrites()).toHaveLength(0);
  });
});

describe('Recap first, as it opens', () => {
  it('lays out the places on a map, the video with its link, then a post per place', async () => {
    await startFromGallery();
    // named after neither the video nor a place: no name until the analyst gives one
    expect(target.querySelector('.title-input').value).toBe('');
    expect(panel().querySelector('.vt-title').textContent).toBe('Convoy on the coast road');
    expect(panel().querySelector('.vt-said').textContent.trim()).toBe('3 places');
    expect(panel().querySelector('.vt-order.on .vt-order-name').textContent).toBe('Recap first');
    expect(posts()).toEqual([
      { num: '1', label: 'Recap', text: RECAP },
      { num: '2', label: 'Video', text: `Source: ${SOURCE}` },
      { num: '3', label: 'Road bridge', text: PLACES[0] },
      { num: '4', label: 'Port gate', text: PLACES[1] },
      { num: '5', label: 'Hilltop village', text: PLACES[2] },
    ]);
    // places that stand apart: the map, previewed, made on a press; no sheet filed meanwhile
    expect(recapPicture().querySelector('[role="radio"][aria-checked="true"]').textContent).toBe('Map');
    expect(sheets.file).not.toHaveBeenCalled();
    expect(target.querySelector('.first-pics img')).toBeNull();
    await makeMap();
    expect(sheets.map).toHaveBeenCalledWith(CASE.id, { video: VIDEO, blob: expect.any(Blob) });
    expect(target.querySelector('.first-pics img').getAttribute('src')).toContain(encodeURIComponent('recap map'));
    expect(recapPicture().querySelector('[data-testid="recap-made"]').textContent).toContain('On the recap');
    // the fields a geolocation asks for are the places' own here
    for (const id of ['#pc-desc', '#pc-coords', '#pc-place', '#pc-date']) expect(target.querySelector(id), id).toBeNull();
    expect(target.querySelector('#pc-mention').value).toBe('@GeoConfirmed');
    expect(target.querySelector('#pc-source').value).toBe(SOURCE);
  });

  it('files the proofs sheet for the recap once it is picked', async () => {
    await startFromGallery();
    await pickSheet();
    // the sheet is filed for the recap, from the places in clip order
    expect(sheets.file).toHaveBeenCalledTimes(1);
    const [caseId, asked] = sheets.file.mock.calls[0];
    expect(caseId).toBe(CASE.id);
    expect(asked.video).toBe(VIDEO);
    expect(asked.slides.map((one) => one.name)).toEqual(['bridge', 'gate', 'village']);
    expect(target.querySelector('.first-pics img').getAttribute('src')).toContain(encodeURIComponent('contact sheet'));
  });

  it('saves itself as a video thread, each post carrying its files', async () => {
    await startFromGallery();
    await makeMap();
    await saved();
    const state = draftWrites().at(-1)[1].state;
    expect(state).toMatchObject({
      kind: 'video', video: VIDEO, order: 'recap', first: 'recap', recap: 'map', map: MAP, mediaEnabled: false,
      mapOptions: { background: 'satellite', line: false, signature: false, mark: false },
      firstMedia: [MAP], firstMediaType: 'images', tweet1: RECAP,
      posts: VIDEO_THREAD_STARTERS[0].posts.map((one) => ({ ...one })),
    });
    expect(state.extraTweets.map((one) => [one.key, one.mediaType, one.mediaPaths])).toEqual([
      ['video', 'video', [VIDEO]],
      ['place:bridge', 'images', ['proofs/bridge.png']],
      ['place:gate', 'images', ['proofs/gate.png']],
      ['place:village', 'images', ['proofs/village.png']],
    ]);
    expect('clip' in state || 'link' in state || 'sheet' in state).toBe(false);
  });

  it('hands the whole thread to the extension, each post with its files', async () => {
    bridge.installed = '0.3.4';
    await startFromGallery();
    await pickSheet();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    target.querySelector('[data-guide="post.publish"]').click();
    await settle();
    const [message] = bridge.handOffPost.mock.calls[0];
    expect(message.posts).toEqual([
      { text: RECAP, files: [SHEET] },
      { text: `Source: ${SOURCE}`, files: [VIDEO] },
      { text: PLACES[0], files: ['proofs/bridge.png'] },
      { text: PLACES[1], files: ['proofs/gate.png'] },
      { text: PLACES[2], files: ['proofs/village.png'] },
    ]);
    expect(message.draft).toBe(draftWrites().at(-1)[1].title);
  });

  it('opens again as it was saved', async () => {
    lists.drafts = [{ name: 'Convoy', title: 'Convoy', target: 'x', kind: 'video', video: VIDEO, posts: 3 }];
    lists.saved = { Convoy: { title: 'Convoy', state: {
      kind: 'video', video: VIDEO, order: 'proof', first: 'place:bridge', posts: VIDEO_THREAD_STARTERS[2].posts,
      body: VIDEO_THREAD_STARTERS[2].body, mention: '@GeoConfirmed', source: SOURCE, target: 'bluesky',
      tweet1: 'My own words', tweet1Edited: true, firstMedia: ['proofs/bridge.png'], firstMediaType: 'images',
      mediaEnabled: false, mediaType: 'none',
      extraTweets: [
        { text: 'The video', mediaPaths: [VIDEO], mediaType: 'video', isMediaTweet: true, mediaTextIncludesPrefix: true, key: 'video' },
        { text: PLACES[1], mediaPaths: ['proofs/gate.png'], mediaType: 'images', isMediaTweet: true, mediaTextIncludesPrefix: true, key: 'place:gate' },
      ],
    } } };
    await mountPost();
    home().querySelector('.ph-open').click();
    await settle();
    expect(posts().map((p) => [p.num, p.label, p.text])).toEqual([
      ['1', 'Road bridge', 'My own words'], ['2', 'Video', 'The video'], ['3', 'Port gate', PLACES[1]],
    ]);
    expect(panel().querySelector('.vt-order.on .vt-order-name').textContent).toBe('Proof first');
    // opening writes nothing
    await saved();
    expect(draftWrites()).toHaveLength(0);
  });
});

describe('the thread\'s title', () => {
  it('is empty until the analyst gives one, never the video\'s name, and its line comes and goes with it', async () => {
    await startFromGallery();
    expect(titleField().value).toBe('');
    expect(titleField().placeholder).toMatch(/^Optional/);
    expect(posts()[0].text).toBe(RECAP);
    typeTitle('Convoy at dawn');
    expect(posts()[0].text).toBe(`Convoy at dawn\n\n${RECAP}`);
    await saved();
    expect(draftWrites().at(-1)[1].state.title).toBe('Convoy at dawn');
    // cleared, its line drops again
    typeTitle('');
    expect(posts()[0].text).toBe(RECAP);
    await saved();
    expect(draftWrites().at(-1)[1].state.title).toBe('');
  });

  it('a thread saved before it had one says the video\'s title, as it did', async () => {
    lists.drafts = [{ name: 'Convoy', title: 'Convoy', target: 'x', kind: 'video', video: VIDEO, posts: 2 }];
    lists.saved = { Convoy: { title: 'Convoy', state: {
      kind: 'video', video: VIDEO, order: 'video', first: 'video', posts: VIDEO_THREAD_STARTERS[1].posts,
      body: VIDEO_THREAD_STARTERS[1].body, mention: '@GeoConfirmed', source: SOURCE, target: 'x',
      tweet1: `Convoy on the coast road\n\n@GeoConfirmed\n\nSource: ${SOURCE}`, tweet1Edited: false,
      firstMedia: [VIDEO], firstMediaType: 'video', mediaEnabled: false, mediaType: 'none',
      extraTweets: [{ text: PLACES[1], mediaPaths: ['proofs/gate.png'], mediaType: 'images', isMediaTweet: true, mediaTextIncludesPrefix: true, key: 'place:gate' }],
    } } };
    await mountPost();
    home().querySelector('.ph-open').click();
    await settle();
    expect(titleField().value).toBe('Convoy on the coast road');
    expect(posts()[0].text).toBe(`Convoy on the coast road\n\n@GeoConfirmed\n\nSource: ${SOURCE}`);
    await saved();
    expect(draftWrites()).toHaveLength(0);
  });

  it('prints on no picture: the sheet and the map are asked for with the places alone', async () => {
    await startFromGallery();
    typeTitle('Convoy at dawn');
    await makeMap();
    const [places, , options, deps] = sheets.build.mock.calls[0];
    expect(places.map((one) => one.number)).toEqual([1, 2, 3]);
    expect(JSON.stringify([places, options, Object.keys(deps)])).not.toContain('Convoy at dawn');
    await pickSheet();
    const [, asked] = sheets.file.mock.calls[0];
    expect(Object.keys(asked).sort()).toEqual(['slides', 'video']);
  });
});

describe('the order', () => {
  it('changes where each post goes and keeps the words written on one', async () => {
    await startFromGallery();
    const gate = [...target.querySelectorAll('.tweet-block textarea')][3];
    gate.value = 'The gate, as I say it';
    gate.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    button(panel(), 'Video first The video, then a post per place').click();
    await settle();
    expect(posts().map((p) => p.label)).toEqual(['Video', 'Road bridge', 'Port gate', 'Hilltop village']);
    expect(posts()[0].text).toBe(`@GeoConfirmed\n\nSource: ${SOURCE}`);
    expect(posts()[2].text).toBe('The gate, as I say it');
    button(panel(), 'All in one One post with the places and their pictures').click();
    await settle();
    expect(posts()).toHaveLength(1);
    expect(posts()[0].text).toBe(`${RECAP}\n\nSource: ${SOURCE}`);
    // back where it started: the recap's words, and the place's as written
    button(panel(), 'Recap first The places on a map or the proofs sheet, then the video, then a post per place').click();
    await settle();
    expect(posts().map((p) => p.text)).toEqual([RECAP, `Source: ${SOURCE}`, PLACES[0], 'The gate, as I say it', PLACES[2]]);
  });

  it('starts on the kind\'s default template, its order and its words', async () => {
    templatesState.post = [{ id: 'po_v', name: 'Desk thread', data: {
      kind: 'video', order: 'video', body: '#scenes', mention: '@Desk', mediaEnabled: false, extraTweets: [{ text: 'Follow for more' }],
      posts: [{ role: 'video', body: '#video by #mention' }, { role: 'place', body: '#timecode' }],
    } }];
    prefs.postKindTemplates = { video: 'po_v' };
    await startFromGallery();
    typeTitle('Convoy on the coast road');
    expect(posts().map((p) => p.text)).toEqual([
      'Convoy on the coast road by @Desk', '[0:00–0:07]', '[0:15]', '', 'Follow for more',
    ]);
  });
});

describe('the recap map', () => {
  const radios = (name) => [...recapPicture().querySelectorAll(`[role="radiogroup"][aria-label="${name}"] [role="radio"]`)];
  const lastPreview = () => sheets.preview.mock.calls.at(-1);
  const check = (name) => [...recapPicture().querySelectorAll('label.rm-check')].find((one) => one.textContent.trim() === name).querySelector('input');

  it('is previewed on a plain ground, no tile asked for, until the analyst asks for the map', async () => {
    const fetchSpy = vi.fn(async () => new Response(new Blob()));
    vi.stubGlobal('fetch', fetchSpy);
    await startFromGallery();
    expect(sheets.preview).toHaveBeenCalled();
    const [places, fit, options, deps] = lastPreview();
    // numbered as #scenes numbers them, each in its scene's colour, all of them framed
    expect(places.map((one) => [one.number, one.name])).toEqual([[1, 'bridge'], [2, 'gate'], [3, 'village']]);
    expect(new Set(places.map((one) => one.colour)).size).toBe(3);
    expect(fit.ok).toBe(true);
    expect(options).toEqual({ background: 'satellite', line: false, signature: false, mark: false });
    expect(deps.loadTile).toBeNull();
    expect(fetchSpy.mock.calls.some(([url]) => String(url).includes('/api/tiles'))).toBe(false);
    expect(recapPicture().querySelector('.rm-preview img').getAttribute('src')).toBe('blob:preview');

    button(recapPicture(), 'Show the map').click();
    await settle();
    expect(typeof lastPreview()[3].loadTile).toBe('function');
    expect(button(recapPicture(), 'Show the map')).toBeUndefined();
  });

  it('redraws the preview as a choice changes, and a map made before is made again', async () => {
    await startFromGallery();
    await makeMap();
    expect(posts()[0].text).toBe(RECAP);
    expect(target.querySelector('.first-pics img')).not.toBeNull();
    check('Line in video order').click();
    await settle();
    expect(lastPreview()[2]).toMatchObject({ line: true, background: 'satellite' });
    // the map on the recap was another: it is made again before it goes out
    expect(target.querySelector('.first-pics img')).toBeNull();
    expect(button(recapPicture(), 'Make the map')).toBeTruthy();
    radios('Background').find((one) => one.textContent === 'Map').click();
    await settle();
    expect(lastPreview()[2]).toMatchObject({ line: true, background: 'map' });
    // picking a ground is a press for the map
    expect(typeof lastPreview()[3].loadTile).toBe('function');
    await makeMap();
    expect(sheets.build.mock.calls.at(-1)[2]).toMatchObject({ line: true, background: 'map' });
    await saved();
    expect(draftWrites().at(-1)[1].state).toMatchObject({ recap: 'map', map: MAP, mapOptions: { line: true, background: 'map' } });
  });

  it('signs as the analyst\'s default proof style does', async () => {
    templatesState.proof = [{ id: 'pt_1', name: 'House', data: {
      signatureText: { anchor: 'bl', size: 28, color: '#ffffff' }, azimutMark: { anchor: 'bl', show: 'both', size: 28 },
    } }];
    prefs.proofTemplate = 'pt_1';
    prefs.signatureHandle = '@desk';
    await startFromGallery();
    expect(lastPreview()[2]).toMatchObject({ signature: true, mark: true });
    expect(lastPreview()[3]).toMatchObject({ handle: '@desk', style: templatesState.proof[0].data });
    check('Azimut mark').click();
    await settle();
    expect(lastPreview()[2]).toMatchObject({ signature: true, mark: false });
  });

  it('falls back to the proofs sheet for places too close together, and says so', async () => {
    lists.scenes[VIDEO] = { ...SCENES, scenes: SCENES.scenes.map((row) => ({
      ...row, points: [{ lat: 48.85, lon: 2.35, coords: '48.850000, 2.350000', label: '' }],
    })) };
    await startFromGallery();
    expect(recapPicture().querySelector('[data-testid="recap-fallback"]').textContent)
      .toBe('These places are too close together for a map, so the recap shows the proofs sheet.');
    expect(button(recapPicture(), 'Map').disabled).toBe(true);
    expect(sheets.file).toHaveBeenCalledTimes(1);
    expect(target.querySelector('.first-pics img').getAttribute('src')).toContain(encodeURIComponent('contact sheet'));
    expect(recapPicture().querySelector('.rm-preview')).toBeNull();
    await saved();
    expect('recap' in draftWrites().at(-1)[1].state).toBe(false);
  });

  it('opens a thread saved with its map on the map, and one saved before maps on its sheet', async () => {
    const stateOf = (name, extra) => ({ title: name, state: {
      kind: 'video', video: VIDEO, order: 'recap', first: 'recap', posts: VIDEO_THREAD_STARTERS[0].posts, body: VIDEO_THREAD_STARTERS[0].body,
      mention: '@GeoConfirmed', source: SOURCE, target: 'x', tweet1: RECAP, tweet1Edited: false, mediaEnabled: false, mediaType: 'none',
      extraTweets: [], ...extra,
    } });
    lists.drafts = [
      { name: 'Mapped', title: 'Mapped', target: 'x', kind: 'video', video: VIDEO, posts: 1, updated_at: '2026-11-10T10:00:00Z' },
      { name: 'Older', title: 'Older', target: 'x', kind: 'video', video: VIDEO, posts: 1, updated_at: '2026-11-09T10:00:00Z' },
    ];
    lists.saved = {
      Mapped: stateOf('Mapped', { recap: 'map', map: MAP, mapOptions: { background: 'map', line: true }, firstMedia: [MAP], firstMediaType: 'images' }),
      Older: stateOf('Older', { sheet: SHEET, firstMedia: [SHEET], firstMediaType: 'images' }),
    };
    await mountPost();
    [...home().querySelectorAll('.ph-open')][0].click();
    await settle();
    expect(recapPicture().querySelector('[data-testid="recap-made"]')).not.toBeNull();
    expect(target.querySelector('.first-pics img').getAttribute('src')).toContain(encodeURIComponent('recap map'));
    expect(lastPreview()[2]).toEqual({ background: 'map', line: true, signature: false, mark: false });
    // reopened, its tiles wait for a press again
    expect(lastPreview()[3].loadTile).toBeNull();

    target.querySelector('.tool-header').querySelector('button[title="Back to the posts of this case"]').click();
    await settle();
    [...home().querySelectorAll('.ph-open')][1].click();
    await settle();
    expect(radios('Recap picture').find((one) => one.getAttribute('aria-checked') === 'true').textContent).toBe('Proofs sheet');
    expect(target.querySelector('.first-pics img').getAttribute('src')).toContain(encodeURIComponent('contact sheet'));
    await saved();
    expect(draftWrites()).toHaveLength(0);
  });
});

describe('a video too long for the platform', () => {
  it('offers the clip a place cut, and the video post carries it', async () => {
    lists.seconds = 25 * 60;
    await startFromGallery();
    const over = panel().querySelector('[data-testid="video-over"]');
    expect(over.textContent).toContain('This video runs 25:00, and X takes 20 minutes from a free account.');
    over.querySelector('.vt-choice').click();
    await settle();
    expect(panel().querySelector('[data-testid="video-over"]')).toBeNull();
    expect(panel().querySelector('[data-testid="video-instead"]').textContent).toContain('the clip of Road bridge');
    await saved();
    const state = draftWrites().at(-1)[1].state;
    expect(state.clip).toBe(CLIP);
    expect(state.extraTweets[0]).toMatchObject({ key: 'video', mediaPaths: [CLIP], mediaType: 'video' });
    // and back to the whole video
    button(panel(), 'Post the whole video').click();
    await settle();
    expect(panel().querySelector('[data-testid="video-over"]')).not.toBeNull();
  });

  it('offers the link when no place has a clip, and never cuts on its own', async () => {
    lists.seconds = 25 * 60;
    lists.scenes[VIDEO] = { ...SCENES, scenes: SCENES.scenes.map(({ clip, ...row }) => row) };
    await startFromGallery();
    const over = panel().querySelector('[data-testid="video-over"]');
    expect(over.textContent).toContain('Cut for the post, in Geo Proof\'s Scene tab, makes one.');
    button(over, 'Post the link instead').click();
    await settle();
    expect(posts()[1]).toMatchObject({ label: 'Video link', text: `Source: ${SOURCE}` });
    expect(api.post.mock.calls.some(([path]) => path.includes('/clip'))).toBe(false);
  });

  it('says nothing for a video that fits, and reads the limit of the platform picked', async () => {
    lists.seconds = 15 * 60;
    await startFromGallery();
    expect(panel().querySelector('[data-testid="video-over"]')).toBeNull();
    button(target, 'Bluesky').click();
    await settle();
    expect(panel().querySelector('[data-testid="video-over"]').textContent).toContain('Bluesky takes 10 minutes.');
  });
});
