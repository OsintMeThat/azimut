// @vitest-environment happy-dom
/**
 * The thread's preview inside Post, actually mounted: Preview stands in for the posts
 * being written and reads them as the extension would get them, the same texts, files
 * and alt texts, post by post; the platform picked switches its look and its limits; a
 * recap map still to make shows the column's small preview and is never made for it;
 * nothing is read from the case or the network to show it; and a new post opens on Write.
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

// the sheet and the map are drawn by a canvas happy-dom has not: what is asked of them is the subject
const sheets = vi.hoisted(() => ({ file: null, make: null, preview: null }));
vi.mock('./post/threadSheet.js', () => ({
  fileThreadSheet: (...args) => sheets.file(...args),
  makeRecapMap: (...args) => sheets.make(...args),
}));
vi.mock('../lib/recapMap.js', async (original) => ({
  ...(await original()),
  recapMapPreview: (...args) => sheets.preview(...args),
}));

const { caseState, prefs, templatesState, uiState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');
const { EXTENSION_WINDOW_KEY } = await import('./post/extensionWindow.js');

const CASE = { id: 'case-1', folders: [], entities: [] };
const SOURCE = 'https://www.instagram.com/reel/C8kXyZaBcDe/?igsh=MWZ1dGx0a2Y0';
const FIRST = [
  'Al Jawf, Yemen - 7H872G9H+FC', '', 'A formation of 13 helicopters heading East', '', '16.018740, 45.528599', '',
  '@GeoConfirmed', '', `Source: ${SOURCE}`,
].join('\n');
const METHOD = `Method: ${'the pylons, the deck line and the cranes line up from one place only. '.repeat(5).trim()}`;
const DRAFT = {
  title: 'Bridge thread',
  state: {
    target: 'x', proofPng: 'proofs/bridge.png', tweet1: FIRST, tweet1Edited: true, source: SOURCE,
    mediaEnabled: true, mediaType: 'images', mediaPaths: ['media/yard.jpg', 'media/channel.jpg'],
    mediaText: '2/ Image:\nThe yard and the channel', mediaTextIncludesPrefix: true,
    extraTweets: [{ text: METHOD, mediaType: 'none', mediaPaths: [] }],
    alt: { 'proofs/bridge.png': 'Thirteen helicopters over a desert road' },
  },
};
const MEDIA = [
  { path: 'media/yard.jpg', kind: 'image', title: 'Yard', thumbnail: 'media/.thumbs/yard.jpg' },
  { path: 'media/channel.jpg', kind: 'image', title: 'Channel', thumbnail: 'media/.thumbs/channel.jpg' },
];
const PROOFS = [{ name: 'bridge', title: 'Road bridge', updated_at: '2026-11-08T10:00:00Z', png: 'proofs/bridge.png', thumb: 'media/.thumbs/bridge.jpg', video: null }];

// a video thread of three places, Recap first on its map
const VIDEO = 'media/convoy.mp4';
const slideRow = (name, title, slide) => ({
  name, title, updated_at: '2026-11-08T10:00:00Z', png: `proofs/${name}.png`, thumb: `media/.thumbs/${name}.jpg`,
  video: VIDEO, video_title: 'Convoy on the coast road', slide, slides: 3, order: slide - 1,
});
const sceneRow = (proof, title, moments, coords) => ({
  kind: 'proof', proof, proof_id: `e_${proof}`, title, moments, at: [], png: `proofs/${proof}.png`, state: 'proved',
  points: [{ lat: Number(coords.split(', ')[0]), lon: Number(coords.split(', ')[1]), coords, label: '' }],
  description: null, when: null, when_zone: null,
});
const SCENES = {
  video: VIDEO,
  scenes: [
    sceneRow('bridge', 'Road bridge', [{ start: 0, end: 7 }], '48.850000, 2.350000'),
    sceneRow('gate', 'Port gate', [{ start: 15, end: null }], '48.860000, 2.360000'),
    sceneRow('village', 'Hilltop village', [], '48.870000, 2.370000'),
  ],
};
const VIDEO_ROW = { path: VIDEO, kind: 'video', title: 'Convoy on the coast road', size: 48_000_000, thumbnail: 'media/.thumbs/convoy.jpg',
  source: { type: 'download', url: 'https://x.com/example/status/1', webpage_url: 'https://x.com/example/status/1' } };

let target;
let app;
let lists;

function answer(path) {
  if (path === `/api/cases/${CASE.id}`) return CASE;
  if (path.endsWith('/drafts')) return lists.drafts;
  if (path.endsWith('/proofs')) return lists.proofs;
  if (path.endsWith('/media')) return lists.media;
  if (path.includes('/scenes?video=')) return SCENES;
  if (path.includes('/inspect/probe')) return { kind: 'video', duration: 95 };
  const draft = /\/drafts\/(.+)$/.exec(path);
  if (draft) return lists.saved[decodeURIComponent(draft[1])];
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
  if (path.includes('/derivation')) return { entities: [], links: [] };
  if (path.includes('/entities')) return { items: [], next: null };
  return [];
}

const settle = async () => {
  for (let i = 0; i < 8; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
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
const tab = (name) => [...target.querySelectorAll('[role="tab"]')].find((one) => one.textContent.trim() === name);
const preview = () => target.querySelector('[data-testid="thread-preview"]');
const shown = () => [...target.querySelectorAll('[data-testid="preview-post"]')];
const cards = () => [...target.querySelectorAll('.tweet-block')];
const calls = () => api.get.mock.calls.length + api.post.mock.calls.length + api.put.mock.calls.length;

async function openDraft() {
  await mountPost();
  uiState.openDraft = 'Bridge thread';
  await settle();
}
async function press(name) {
  tab(name).click();
  await settle();
}

beforeEach(() => {
  vi.clearAllMocks();
  lists = {
    drafts: [{ name: 'Bridge thread', title: 'Bridge thread', updated_at: '2026-11-10T08:00:00Z', target: 'x', posts: 3 }],
    proofs: PROOFS,
    media: MEDIA,
    saved: { 'Bridge thread': DRAFT },
  };
  api.get.mockImplementation(async (path) => answer(path));
  api.post.mockImplementation(async (path, body) => {
    if (path.endsWith('/drafts')) return { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` };
    return {};
  });
  sheets.file = vi.fn(async () => 'media/sheet.jpg');
  sheets.make = vi.fn(async () => 'media/map.jpg');
  sheets.preview = vi.fn(async () => ({ url: 'blob:recap-preview', missing: 0, revoke: vi.fn() }));
  bridge.installed = null;
  bridge.handOffPost = vi.fn(async () => true);
  prefs.postTemplate = '';
  prefs.postKindTemplates = {};
  prefs.postMention = '@GeoConfirmed';
  prefs.postTarget = 'x';
  prefs.postPrefill = true;
  prefs.postAltText = false;
  prefs.signatureHandle = '';
  templatesState.post = [];
  templatesState.proof = [];
  prefs.proofTemplate = '';
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

describe('Preview in Post', () => {
  it('opens on Write, and Preview shows the posts the extension would get, reading nothing to do it', async () => {
    await openDraft();
    expect(tab('Write').getAttribute('aria-selected')).toBe('true');
    expect(preview()).toBeNull();
    const written = cards().map((card) => card.querySelector('textarea').value);
    expect(written).toHaveLength(3);

    const before = calls();
    await press('Preview');
    expect(calls()).toBe(before);
    // the posts being written make way while it is shown
    expect(cards()).toHaveLength(0);
    expect(shown().map((post) => post.querySelector('.tp-text').textContent)).toEqual([
      FIRST.replace(SOURCE, 'instagram.com/reel/C8kXyZ…'), written[1], written[2],
    ]);
    const pictures = shown().map((post) => [...post.querySelectorAll('.tp-pic img')].map((img) => img.getAttribute('src')));
    expect(pictures).toEqual([
      ['/files/case-1/media/.thumbs/bridge.jpg'],
      ['/files/case-1/media/.thumbs/yard.jpg', '/files/case-1/media/.thumbs/channel.jpg'],
      [],
    ]);
    // the proof's text goes with it, and says so on the picture
    expect(shown()[0].querySelector('.tp-alt').getAttribute('title')).toBe('Thirteen helicopters over a desert road');
    // the long one is counted as the composer counts it, and marked past the limit
    expect(shown()[2].querySelector('.tp-count').textContent).toBe(`${METHOD.length}/280`);
    expect(shown()[2].querySelector('mark.tp-over').textContent).toBe(METHOD.slice(280));

    await press('Write');
    expect(preview()).toBeNull();
    expect(cards().map((card) => card.querySelector('textarea').value)).toEqual(written);
  });

  it('follows the platform picked, its look and its limits', async () => {
    await openDraft();
    await press('Preview');
    expect(shown().map((post) => post.querySelector('.tp-count').textContent.split('/')[1])).toEqual(['280', '280', '280']);
    button(target.querySelector('.target-tabs'), 'Bluesky').click();
    await settle();
    expect(preview().classList.contains('sky')).toBe(true);
    expect(shown().map((post) => post.querySelector('.tp-count').textContent.split('/')[1])).toEqual(['300', '300', '300']);
    expect(shown()[0].querySelector('.tp-text').textContent).toContain('www.instagram.com/reel/C8kXyZa...');
  });

  describe('a post that went out', () => {
    const POSTED = { site: 'x', url: 'https://x.com/desk/status/1855000000000000000', posted_at: '2026-11-10T10:05:00Z' };
    const saved = (name, publish) => ({ title: name, state: { ...DRAFT.state, publish } });
    const open = async (name) => {
      [...home().querySelectorAll('.ph-open')].find((b) => b.textContent.includes(name)).click();
      await settle();
    };
    const goHome = async () => {
      button(target.querySelector('.tool-header'), 'Posts').click();
      await settle();
    };
    const selected = () => tab('Preview').getAttribute('aria-selected') === 'true' ? 'Preview' : 'Write';

    beforeEach(() => {
      lists.drafts = [
        { name: 'Out', title: 'Out', target: 'x', posts: 3, state: 'posted' },
        { name: 'Edited', title: 'Edited', target: 'x', posts: 3, state: 'changed' },
        { name: 'Bridge thread', title: 'Bridge thread', target: 'x', posts: 3, state: 'draft' },
      ];
      // marked from its card before it was ever opened: what stands is what went out
      lists.saved.Out = saved('Out', { ...POSTED, changed: false });
      lists.saved.Edited = saved('Edited', { ...POSTED, mark: 'not this post', changed: true });
    });

    it('opens on Preview while it stands Posted, and Write stays one press away', async () => {
      await mountPost();
      await open('Out');
      expect(selected()).toBe('Preview');
      expect(shown()).toHaveLength(3);
      expect(cards()).toHaveLength(0);
      await press('Write');
      expect(cards()).toHaveLength(3);
      // nothing remembered: opened again, it is Posted again, and on Preview
      await goHome();
      await open('Out');
      expect(selected()).toBe('Preview');
    });

    it('opens on Write once changed since posted, as a draft and a new post do', async () => {
      await mountPost();
      await open('Edited');
      expect(target.querySelector('.pc-pill').textContent.trim()).toBe('Changed since posted');
      expect(selected()).toBe('Write');
      await goHome();
      await open('Out');
      expect(selected()).toBe('Preview');
      // from a posted post on Preview straight to a draft: Write
      uiState.openDraft = 'Bridge thread';
      await settle();
      expect(selected()).toBe('Write');
      expect(preview()).toBeNull();
    });

    it('stays on the tab it is on when it is marked posted while open', async () => {
      await mountPost();
      await open('Bridge thread');
      expect(selected()).toBe('Write');
      target.querySelector('.tool-header button[aria-label="Mark as posted"]').click();
      flushSync();
      const popover = document.querySelector('.float-menu[role="dialog"][aria-label="Mark as posted"]');
      button(popover, 'Mark as posted').click();
      await settle();
      expect(target.querySelector('.pc-pill').textContent).toContain('Posted');
      expect(selected()).toBe('Write');
      await press('Preview');
      expect(selected()).toBe('Preview');
    });
  });

  it('a new post opens on Write', async () => {
    await openDraft();
    await press('Preview');
    button(target.querySelector('.tool-header'), 'Posts').click();
    await settle();
    expect(home()).not.toBeNull();
    button(home(), 'New post').click();
    await settle();
    [...dialog('New post').querySelectorAll('.np-card')][0].click();
    await settle();
    expect(tab('Write').getAttribute('aria-selected')).toBe('true');
    expect(preview()).toBeNull();
    expect(cards().length).toBeGreaterThan(0);
  });
});

describe('a video thread in Preview', () => {
  it('shows the recap map still to make on the column’s small preview, and never makes it to show it', async () => {
    lists.drafts = [];
    lists.proofs = [slideRow('bridge', 'Road bridge', 1), slideRow('gate', 'Port gate', 2), slideRow('village', 'Hilltop village', 3)];
    lists.media = [VIDEO_ROW];
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    [...dialog('New post').querySelectorAll('.np-card')][1].click();
    await settle();
    [...dialog('Video thread').querySelectorAll('.vp-row')][0].click();
    await settle();
    expect(target.querySelector('[data-testid="recap-map-pending"]')).not.toBeNull();
    const written = cards().map((card) => card.querySelector('textarea')?.value ?? '');

    const before = calls();
    await press('Preview');
    expect(calls()).toBe(before);
    // the words as written, the video's link as X shows it
    expect(shown().map((post) => post.querySelector('.tp-text')?.textContent ?? ''))
      .toEqual(written.map((text) => text.replace('https://x.com/', 'x.com/')));
    const recap = shown()[0].querySelector('.tp-pic.later');
    expect(recap.querySelector('img').getAttribute('src')).toBe('blob:recap-preview');
    expect(shown()[0].querySelector('.tp-later').textContent).toBe('The map is made when you publish.');
    // the video on its poster, each place on its proof's thumbnail
    expect(shown()[1].querySelector('.tp-pic.video img').getAttribute('src')).toBe('/files/case-1/media/.thumbs/convoy.jpg');
    expect(shown().slice(2).map((post) => post.querySelector('.tp-pic img').getAttribute('src'))).toEqual([
      '/files/case-1/media/.thumbs/bridge.jpg', '/files/case-1/media/.thumbs/gate.jpg', '/files/case-1/media/.thumbs/village.jpg',
    ]);
    expect(sheets.make).not.toHaveBeenCalled();
  });
});
