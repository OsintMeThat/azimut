// @vitest-environment happy-dom
/**
 * Post, actually mounted: the home that stands where an empty composer would, the New
 * post gallery and the kinds it starts, the window that says once why the extension is
 * worth having, and Reply under the source.
 *
 * And the rule above all of it: a geolocation is written, saved and handed over exactly
 * as Geo Report did. The first post a proof gives, the draft's shape and the message the
 * extension receives are pinned here.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('konva', () => ({ default: {} }));

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(async () => ({})), post: vi.fn(), del: vi.fn(async () => ({})) },
}));
vi.mock('../lib/api.js', () => ({ api }));

// The bridge's own listeners are tested on forged window messages (lib/extBridge.test.js);
// here the composer is handed what they pass on.
const bridge = vi.hoisted(() => ({ installed: null, handOffPost: null, caught: null, reported: null }));
vi.mock('../lib/extBridge.js', () => ({
  extensionVersion: () => bridge.installed,
  extensionOutdated: (installed, bundled) => Boolean(installed && bundled && installed < bundled),
  handOffPost: (...args) => bridge.handOffPost(...args),
  onPostLinkCaught: (cb) => {
    bridge.caught = cb;
    return () => { if (bridge.caught === cb) bridge.caught = null; };
  },
  onPostHandoffReport: (cb) => {
    bridge.reported = cb;
    return () => { if (bridge.reported === cb) bridge.reported = null; };
  },
}));

const { caseState, prefs, templatesState, uiState, updatesState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');
const { startPost } = await import('./post/start.js');
const { EXTENSION_WINDOW_KEY } = await import('./post/extensionWindow.js');

const CASE = { id: 'case-1', folders: [], entities: [] };
const SOURCE_X = 'https://x.com/someone/status/1850000000000000000';

// a proof as Geo Proof's To Post hands it over
const PROOF = {
  title: 'Proof 3',
  description: 'A formation of 13 helicopters was spotted heading East',
  when: null,
  coordsText: '10.303315, -66.874095',
  source: SOURCE_X,
  png: 'proofs/helicopters.png',
};
const GEO = { lat: 10.303315, lon: -66.874095, dms: '10°18′11.9″N 66°52′26.7″W', plus_code: '76XH+8F5' };
const CLASSIC_FIRST_POST = [
  'Los Anacuos, Miranda, Venezuela - 76XH+8F5',
  '',
  'A formation of 13 helicopters was spotted heading East',
  '',
  '10.303315, -66.874095',
  '',
  '@GeoConfirmed',
  '',
  `Source: ${SOURCE_X}`,
].join('\n');

let target;
let app;
let lists;
let opened;

function answer(path) {
  // the case read again after a first save is the same case
  if (path === `/api/cases/${CASE.id}`) return CASE;
  if (path.endsWith('/drafts')) return lists.drafts;
  if (path.endsWith('/proofs')) return lists.proofs;
  if (path.endsWith('/media')) return lists.media;
  if (path.startsWith('/api/geo/reverse')) return { address: { village: 'Los Anacuos', state: 'Miranda', country: 'Venezuela' } };
  const draft = /\/drafts\/(.+)$/.exec(path);
  if (draft) return lists.saved[decodeURIComponent(draft[1])];
  const spec = /\/proofs\/(.+)$/.exec(path);
  if (spec) return lists.specs[decodeURIComponent(spec[1])];
  // every file the case holds is found again, so nothing reads as deleted
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
  if (path.includes('/derivation')) return { entities: [], links: [] };
  if (path.includes('/entities')) return { items: lists.entities, next: null };
  return [];
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
// past the autosave's pause, so what was typed is written
const saved = async () => {
  await new Promise((resolve) => setTimeout(resolve, 850));
  await settle();
};
const draftWrites = () => api.post.mock.calls.filter(([path]) => path.endsWith('/drafts'));
const type = (node, value) => {
  node.value = value;
  node.dispatchEvent(new Event('input', { bubbles: true }));
  node.dispatchEvent(new Event('change', { bubbles: true }));
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
const firstPost = () => target.querySelector('.tweet-block textarea');
const header = () => target.querySelector('.tool-header');
const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const dialog = (name) => document.querySelector(`[role="dialog"][aria-label="${name}"]`);
const toasts = () => uiState.toasts.map((t) => t.message);

beforeEach(() => {
  vi.clearAllMocks();
  lists = { drafts: [], proofs: [], media: [], saved: {}, specs: {}, entities: [] };
  api.get.mockImplementation(async (path) => answer(path));
  api.put.mockImplementation(async () => ({}));
  api.post.mockImplementation(async (path, body) => {
    if (path === '/api/geo/parse') return GEO;
    if (path.endsWith('/drafts')) return { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` };
    return {};
  });
  bridge.installed = null;
  bridge.handOffPost = vi.fn(async () => true);
  updatesState.extensionBundled = null;
  prefs.postTemplate = '';
  prefs.postKindTemplates = {};
  prefs.postMention = '@GeoConfirmed';
  prefs.postTarget = 'x';
  prefs.postPrefill = true;
  templatesState.post = [];
  uiState.toasts.splice(0);
  uiState.tool = 'post';
  uiState.postProof = null;
  uiState.postStart = null;
  caseState.current = CASE;
  // the window is the subject of its own tests; elsewhere it has been put away
  localStorage.setItem(EXTENSION_WINDOW_KEY, 'not-now');
  opened = vi.fn();
  vi.stubGlobal('open', opened);
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
  uiState.guide = null;
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('the home', () => {
  const draft = (name, extra = {}) => ({
    name, title: name, updated_at: '2026-11-09T10:00:00Z', target: 'x', kind: 'geolocation', posts: 1, proof: null, video: null, ...extra,
  });
  const proof = (name, extra = {}) => ({
    name, title: name, updated_at: '2026-11-08T10:00:00Z', png: `proofs/${name}.png`, thumb: null, video: null, ...extra,
  });

  it('keeps the composer it always opened on for a case with nothing to list', async () => {
    await mountPost();
    expect(home()).toBeNull();
    expect(target.querySelector('#pc-desc')).not.toBeNull();
    expect(button(header(), 'Posts')).toBeUndefined();
  });

  it('lists the drafts, with their platform and posts, and what is ready to post', async () => {
    lists.drafts = [draft('Thread A', { target: 'bluesky', posts: 3, proof: 'proofs/posted.png' }), draft('Words', { kind: 'free', posts: 2 })];
    lists.proofs = [proof('posted'), proof('waiting'),
      proof('slide-1', { video: 'media/clip.mp4', video_title: 'Convoy', slide: 1, slides: 2, order: 0 }),
      proof('slide-2', { video: 'media/clip.mp4', video_title: 'Convoy', slide: 2, slides: 2, order: 1 })];
    await mountPost();

    expect(home()).not.toBeNull();
    const cards = [...home().querySelectorAll('.ph-card')].map((card) => card.textContent.replace(/\s+/g, ' ').trim());
    expect(cards[0]).toContain('Thread A');
    expect(cards[0]).toContain('Bluesky · 3 posts');
    expect(cards[1]).toContain('X · Free post · 2 posts');
    // a proof a draft names has its post; the other waits, and a video's slides wait under it
    expect(cards.some((text) => text.includes('waiting'))).toBe(true);
    expect(cards.some((text) => text.includes('posted'))).toBe(false);
    const series = home().querySelector('.ph-video');
    expect(series.textContent).toContain('Convoy');
    expect([...series.querySelectorAll('.ph-chip')].map((chip) => chip.querySelector('.ph-chip-name').textContent)).toEqual(['slide-1', 'slide-2']);
    expect(button(series, 'Video thread Coming next').disabled).toBe(true);
    // the header waits for a post: nothing to act on from here
    expect(button(header(), 'New post')).toBeTruthy();
    expect(header().querySelector('.post-more')).toBeNull();
  });

  it('finds a draft by name, and Enter opens the first', async () => {
    lists.drafts = [draft('Convoy east'), draft('Depot')];
    lists.saved = { Depot: { title: 'Depot', state: { description: 'Depot fire', tweet1: 'Depot fire' } } };
    await mountPost();
    const find = home().querySelector('input[aria-label="Find a draft by name"]');
    find.value = 'dep';
    find.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...home().querySelectorAll('.ph-hit-title')].map((t) => t.textContent)).toEqual(['Depot']);
    find.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await settle();
    expect(home()).toBeNull();
    expect(target.querySelector('#pc-desc').value).toBe('Depot fire');
  });

  it('writes a waiting proof\'s geolocation in one press, and Posts goes back', async () => {
    lists.proofs = [proof('waiting')];
    lists.specs = { waiting: { description: PROOF.description, points: [{ lat: GEO.lat, lon: GEO.lon }], source: SOURCE_X } };
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await settle();

    expect(home()).toBeNull();
    expect(target.querySelector('#pc-desc').value).toBe(PROOF.description);
    expect(target.querySelector('.attach-chip').textContent).toContain('waiting.png');
    button(header(), 'Posts').click();
    await settle();
    // nothing to ask: the post is written on the way, its proof attached
    expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    expect(draftWrites().at(-1)[1].state.proofPng).toBe('proofs/waiting.png');
    expect(home()).not.toBeNull();
  });
});

describe('the home in three parts', () => {
  const row = (name, state, extra = {}) => ({
    name, title: name, updated_at: '2026-11-09T10:00:00Z', target: 'x', kind: 'geolocation', posts: 1, proof: null, video: null,
    state, posted: null, picture: null, ...extra,
  });
  const part = (name) => home().querySelector(`[data-part="${name}"]`);
  const titles = (root) => [...(root?.querySelectorAll('.ph-title') ?? [])].map((t) => t.textContent);
  const pills = (root) => [...(root?.querySelectorAll('.ph-pill') ?? [])].map((t) => t.textContent);

  it('splits the drafts from what went out, each card wearing its state', async () => {
    const early = `https://x.com/desk/status/${snowflake('2025-03-09T12:00:00Z')}`;
    lists.drafts = [
      row('Fresh', 'draft'),
      // what an earlier build listed as opened reads as a draft: no Opened pill anywhere
      row('Sent', 'opened'),
      // marked lately, but its link says it went out in March: the latest first is by the post's own day
      row('Out', 'posted', { posted: { url: early, site: 'x', at: '2026-11-10T08:00:00Z' } }),
      row('Quiet', 'posted', { posted: { url: null, site: 'bluesky', at: '2025-06-01T12:00:00Z' } }),
      row('Edited', 'changed', { posted: { url: 'https://x.com/desk/status/2', site: 'x', at: '2026-11-08T08:00:00Z' } }),
    ];
    lists.proofs = [{ name: 'waiting', title: 'waiting', png: 'proofs/waiting.png', thumb: null, video: null, updated_at: '2026-11-08T10:00:00Z' }];
    await mountPost();
    expect([...home().querySelectorAll('h4')].map((h) => h.textContent)).toEqual(['In progress', 'Ready to post', 'Posted']);
    expect(home().querySelector('.ph-sub').textContent).toBe('Proofs with no post yet');
    expect(home().textContent).not.toContain('No post yet');
    expect(titles(part('progress'))).toEqual(['Fresh', 'Sent', 'Edited']);
    expect(pills(part('progress'))).toEqual(['Draft', 'Draft', 'Changed since posted']);
    expect(titles(part('posted'))).toEqual(['Quiet', 'Out']);
    expect(pills(part('posted'))).toEqual(['Posted', 'Posted']);
    expect([...part('posted').querySelectorAll('.ph-when')].map((t) => t.textContent)).toEqual(['1 Jun 2025', '9 Mar 2025']);
    expect(home().textContent).not.toContain('Opened');
    const links = part('posted').querySelectorAll('a.ph-out');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe(early);
    expect(links[0].textContent.trim()).toBe(early.replace('https://', ''));
    // New post stays at the top
    expect(home().querySelector('.ph-start .ph-new').textContent.trim()).toBe('New post');
  });

  it('deletes a post from its card\'s ⋯ or a right-click, with Undo', async () => {
    lists.drafts = [row('Fresh', 'draft'), row('Other', 'draft')];
    api.del.mockImplementation(async () => ({ status: 'deleted', deleted: ['d1'], trash: 'trash-1' }));
    await mountPost();
    home().querySelector('button[aria-label="More for Fresh"]').click();
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="Fresh"]');
    expect([...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Open', 'Mark as posted…', 'Delete…']);
    button(menu, 'Delete…').click();
    await settle();
    button(document.querySelector('[role="alertdialog"]'), 'Delete').click();
    await settle();
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/drafts/Fresh');
    expect(uiState.toasts.at(-1)).toMatchObject({ message: 'Deleted “Fresh”', action: { label: 'Undo' } });

    const card = [...home().querySelectorAll('.post-card')].find((c) => c.textContent.includes('Other'));
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    flushSync();
    expect(document.querySelector('.float-menu[aria-label="Other"]')).not.toBeNull();
  });
});

describe('deleting a post with a proof', () => {
  const row = (name, extra = {}) => ({
    name, title: name, updated_at: '2026-11-09T10:00:00Z', target: 'x', kind: 'geolocation', posts: 1, proof: null, video: null,
    state: 'draft', posted: null, picture: null, ...extra,
  });
  const ask = async (name) => {
    home().querySelector(`button[aria-label="More for ${name}"]`).click();
    flushSync();
    button(document.querySelector(`.float-menu[aria-label="${name}"]`), 'Delete…').click();
    await settle();
    return document.querySelector('[role="alertdialog"]');
  };

  it('says its proof goes back to Ready to post, unless another post names it', async () => {
    lists.drafts = [
      row('Bridge', { proof: 'proofs/bridge.png' }), row('Words', { kind: 'free' }),
      row('Port', { proof: 'proofs/port.png' }), row('Port again', { proof: 'proofs/port.png' }),
    ];
    await mountPost();
    const LINE = 'Its proof goes back to Ready to post.';
    expect((await ask('Bridge')).textContent).toContain(LINE);
    button(document.querySelector('[role="alertdialog"]'), 'Cancel').click();
    await settle();
    expect((await ask('Words')).textContent).not.toContain(LINE);
    button(document.querySelector('[role="alertdialog"]'), 'Cancel').click();
    await settle();
    expect((await ask('Port')).textContent).not.toContain(LINE);
  });
});

describe('Open', () => {
  const row = (name, extra = {}) => ({
    name, title: name, updated_at: '2026-11-09T10:00:00Z', target: 'x', kind: 'geolocation', posts: 1, proof: null, video: null,
    state: 'draft', posted: null, picture: null, ...extra,
  });
  const list = () => dialog('Open a post');
  const rows = () => [...list().querySelectorAll('.ol-title')].map((t) => t.textContent);
  const pick = (label, value) => {
    const select = list().querySelector(`select[aria-label="${label}"]`);
    select.value = value;
    select.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  };

  beforeEach(() => {
    lists.drafts = [
      row('Convoy east', { state: 'posted', posted: { url: 'https://x.com/a/status/1', site: 'x', at: '2026-11-10T08:00:00Z' }, picture: 'proofs/east.png' }),
      row('Depot words', { kind: 'free', target: 'bluesky', picture: 'media/depot.png' }),
      row('Convoy west', { state: 'changed', posted: { url: null, site: 'x', at: '2026-11-10T08:00:00Z' } }),
    ];
    lists.proofs = [{ name: 'east', title: 'east', png: 'proofs/east.png', thumb: 'proofs/.thumbs/east.webp', video: null }];
    lists.media = [{ path: 'media/depot.png', kind: 'image', thumbnail: 'media/.thumbs/depot.webp' }];
  });

  it('lists every post with its picture, kind, platform, state and date', async () => {
    await mountPost();
    button(header(), 'Open').click();
    await settle();
    expect(rows()).toEqual(['Convoy east', 'Depot words', 'Convoy west']);
    const subs = [...list().querySelectorAll('.ol-sub')].map((t) => t.textContent.trim());
    expect(subs).toEqual(['Geolocation · X · 2026-11-09', 'Free post · Bluesky · 2026-11-09', 'Geolocation · X · 2026-11-09']);
    expect([...list().querySelectorAll('.ol-pill')].map((t) => t.textContent)).toEqual(['Posted', 'Draft', 'Changed since posted']);
    const pictures = [...list().querySelectorAll('.ol-pic img')].map((img) => img.getAttribute('src'));
    expect(pictures[0]).toContain('proofs/.thumbs/east.webp');
    expect(pictures[1]).toContain('media/.thumbs/depot.webp');
    expect(list().querySelectorAll('.ol-pic img')).toHaveLength(2);
  });

  it('narrows by words, by kind and by state', async () => {
    await mountPost();
    button(header(), 'Open').click();
    await settle();
    expect([...list().querySelectorAll('select[aria-label="Kind"] option')].map((o) => o.textContent))
      .toEqual(['Every kind', 'Geolocation · 2', 'Free post · 1']);
    expect([...list().querySelectorAll('select[aria-label="State"] option')].map((o) => o.textContent))
      .toEqual(['Every state', 'Draft · 1', 'Posted · 1', 'Changed since posted · 1']);
    pick('Kind', 'geolocation');
    expect(rows()).toEqual(['Convoy east', 'Convoy west']);
    pick('State', 'changed');
    expect(rows()).toEqual(['Convoy west']);
    pick('Kind', '');
    pick('State', '');
    const search = list().querySelector('input');
    search.value = 'depot';
    search.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(rows()).toEqual(['Depot words']);
  });

  it('opens the post pressed, and deletes one with the preview and Undo', async () => {
    lists.saved = { 'Depot words': { title: 'Depot words', state: { kind: 'free', description: 'Depot', tweet1: 'Depot', tweet1Edited: true } } };
    api.del.mockImplementation(async () => ({ status: 'deleted', deleted: ['d1'], trash: 'trash-1' }));
    await mountPost();
    button(header(), 'Open').click();
    await settle();
    list().querySelector('button[aria-label="Delete Convoy west"]').click();
    await settle();
    const ask = document.querySelector('[role="alertdialog"]');
    expect(ask.textContent).toContain('“Convoy west” will be removed from the case.');
    button(ask, 'Delete').click();
    await settle();
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/drafts/Convoy%20west');
    expect(uiState.toasts.at(-1)).toMatchObject({ message: 'Deleted “Convoy west”', action: { label: 'Undo' } });
    // the list stays open, read again
    expect(list()).not.toBeNull();

    [...list().querySelectorAll('.ol-open')].find((b) => b.textContent.includes('Depot words')).click();
    await settle();
    expect(list()).toBeNull();
    expect(header().querySelector('input[aria-label="Post name"]').value).toBe('Depot words');
  });
});

describe('New post', () => {
  beforeEach(() => {
    lists.drafts = [{ name: 'Old', title: 'Old', target: 'x', kind: 'geolocation', posts: 1 }];
  });

  it('offers four starts, Geolocation first, and the video thread comes next', async () => {
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    const gallery = dialog('New post');
    const cards = [...gallery.querySelectorAll('.np-card')];
    expect(cards.map((card) => card.querySelector('.np-name').textContent.replace(/\s+/g, ' ').trim()))
      .toEqual(['Geolocation Usual', 'Video thread Coming next', 'Map plate', 'Free post']);
    expect(cards.map((card) => card.disabled)).toEqual([false, true, false, false]);
  });

  it('opens Geolocation on the composer it always was', async () => {
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    dialog('New post').querySelector('.np-card').click();
    await settle();
    expect(home()).toBeNull();
    expect(target.querySelector('.kind-chip')).toBeNull();
    for (const id of ['#pc-desc', '#pc-coords', '#pc-place', '#pc-mention', '#pc-source']) {
      expect(target.querySelector(id), id).not.toBeNull();
    }
    expect(target.querySelector('.tweet-head .label').textContent).toBe('Geolocation post');
    expect(button(target, 'Attach a proof')).toBeTruthy();
  });

  it('opens a free post on its own layout, with only the fields it uses and its own media', async () => {
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    [...dialog('New post').querySelectorAll('.np-card')][3].click();
    await settle();
    expect(target.querySelector('.kind-chip').textContent.trim()).toBe('Free post');
    expect(target.querySelector('#pc-coords')).toBeNull();
    expect(target.querySelector('#pc-place')).toBeNull();
    expect(target.querySelector('#pc-source')).not.toBeNull();
    expect(target.querySelector('.tweet-head .label').textContent).toBe('First post');
    expect(button(target, 'Attach a proof')).toBeUndefined();
    expect(target.querySelector('.first-media')).not.toBeNull();
  });
});

describe('startPost — the entry every To Post shares', () => {
  it('opens the kind asked for with its media on the first post, and saves them with the kind', async () => {
    lists.media = [{ path: 'media/a.png', kind: 'image' }, { path: 'media/clip.mp4', kind: 'video', title: 'Convoy' }];
    await mountPost();
    startPost('free', ['media/a.png', 'media/clip.mp4']);
    await settle();

    expect(target.querySelector('.kind-chip').textContent.trim()).toBe('Free post');
    expect([...target.querySelectorAll('.first-media .attach-chip a')].map((a) => a.textContent)).toEqual(['a.png']);
    const thread = [...target.querySelectorAll('.tweet-block')];
    expect(thread[1].textContent).toContain('clip.mp4');

    type(target.querySelector('.tweet-block textarea'), 'Smoke over the port');
    await saved();
    const state = draftWrites().at(-1)[1].state;
    expect(state).toMatchObject({ kind: 'free', firstMedia: ['media/a.png'], firstMediaType: 'images', mediaPaths: ['media/clip.mp4'] });
  });

  it('fills the name, description and date the sending tool gave', async () => {
    lists.media = [{ path: 'media/Front, October.png', kind: 'image' }];
    await mountPost();
    startPost('plate', ['media/Front, October.png'], {
      title: 'Front, October', description: 'Shelling along the river', dates: ['2026-10-14', '2026-10-01'],
    });
    await settle();

    expect(header().querySelector('.title-input').value).toBe('Front, October');
    expect(target.querySelector('#pc-desc').value).toBe('Shelling along the river');
    await saved();
    const write = draftWrites().at(-1)[1];
    expect(write.title).toBe('Front, October');
    expect(write.state).toMatchObject({ kind: 'plate', description: 'Shelling along the river', date: '2026-10-01 to 2026-10-14' });
  });

  it('keeps a fresh number when another post already holds the name given', async () => {
    lists.entities = [{ id: 'd1', type: 'post', label: 'Front, October', attrs: { draft: '.drafts/Front, October.json' } }];
    await mountPost();
    startPost('plate', [], { title: 'Front, October', description: 'Shelling along the river' });
    await settle();
    expect(header().querySelector('.title-input').value).not.toBe('Front, October');
    expect(target.querySelector('#pc-desc').value).toBe('Shelling along the river');
  });

  it('files the post on screen first, as a proof sent over does', async () => {
    await mountPost();
    target.querySelector('#pc-desc').value = 'Work in progress';
    target.querySelector('#pc-desc').dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    startPost('plate', []);
    await settle();
    expect(api.post.mock.calls.some(([path]) => path.endsWith('/drafts'))).toBe(true);
    expect(target.querySelector('.kind-chip').textContent.trim()).toBe('Map plate');
    expect(target.querySelector('#pc-desc').value).toBe('');
  });
});

describe('a post saves itself', () => {
  it('never files an untouched blank post, and files one once something is typed', async () => {
    await mountPost();
    await saved();
    expect(draftWrites()).toEqual([]);
    expect(header().querySelector('.save-status')).toBeNull();

    type(target.querySelector('#pc-desc'), 'Smoke over the depot');
    await settle();
    expect(header().querySelector('.save-status').textContent.trim()).toBe('Saving…');
    await saved();
    expect(draftWrites()).toHaveLength(1);
    const [, sent] = draftWrites()[0];
    expect(sent).toMatchObject({ rename_from: null, title: 'Post 1' });
    expect(sent.state.description).toBe('Smoke over the depot');
    expect(header().querySelector('.save-status').textContent.trim()).toBe('Saved');

    // the next edit writes back over the same draft
    type(target.querySelector('#pc-desc'), 'Smoke over the depot, east side');
    await saved();
    expect(draftWrites()).toHaveLength(2);
    expect(draftWrites()[1][1].rename_from).toBe('Post 1');
  });

  it('opens a saved draft without writing it, and writes it once it changes', async () => {
    lists.drafts = [{ name: 'Depot', title: 'Depot', target: 'x', posts: 1 }];
    lists.saved = { Depot: { title: 'Depot', state: { description: 'Depot fire', tweet1: 'Depot fire', tweet1Edited: true } } };
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await saved();
    expect(draftWrites()).toEqual([]);
    expect(header().querySelector('.save-status').textContent.trim()).toBe('Saved');
    type(firstPost(), 'Depot fire at night');
    await saved();
    expect(draftWrites()).toHaveLength(1);
    expect(draftWrites()[0][1]).toMatchObject({ rename_from: 'Depot', title: 'Depot' });
  });

  it('takes the name when the field is left, and refuses one another post holds', async () => {
    api.get.mockImplementation(async (path, opts) => {
      if (path.includes('/entities') && !path.includes('lookup') && !path.includes('derivation')) {
        return { items: [{ id: 'p9', type: 'post', label: 'Harbour', attrs: { draft: '.drafts/Harbour.json' } }], next: null };
      }
      return answer(path, opts);
    });
    await mountPost();
    type(target.querySelector('#pc-desc'), 'Smoke');
    await saved();
    const name = header().querySelector('input[aria-label="Post name"]');
    name.value = 'Harbour';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    name.dispatchEvent(new FocusEvent('blur'));
    await settle();
    expect(name.value).toBe('Post 1');
    expect(toasts()).toContain('Another post is already named “Harbour”');

    name.value = 'Smoke at the port';
    name.dispatchEvent(new Event('input', { bubbles: true }));
    await saved();
    // typing alone renames nothing
    expect(draftWrites().at(-1)[1].title).toBe('Post 1');
    name.dispatchEvent(new FocusEvent('blur'));
    await saved();
    expect(draftWrites().at(-1)[1]).toMatchObject({ rename_from: 'Post 1', title: 'Smoke at the port' });
  });

  it('says when a save failed, keeps the post open, and Retry writes it', async () => {
    lists.drafts = [{ name: 'Old', title: 'Old', target: 'x', posts: 1 }];
    let fail = true;
    api.post.mockImplementation(async (path, body) => {
      if (path === '/api/geo/parse') return GEO;
      if (path.endsWith('/drafts')) {
        if (fail) throw new Error('disk full');
        return { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` };
      }
      return {};
    });
    await mountPost();
    button(home(), 'New post').click();
    await settle();
    dialog('New post').querySelector('.np-card').click();
    await settle();
    type(target.querySelector('#pc-desc'), 'Smoke');
    await saved();
    expect(header().querySelector('.save-status.error').textContent.trim()).toBe('Not saved');
    button(header(), 'Posts').click();
    await settle();
    expect(home()).toBeNull();
    expect(toasts()).toContain('The post could not be saved, so it stays open');
    fail = false;
    button(header(), 'Retry').click();
    await settle();
    expect(header().querySelector('.save-status').textContent.trim()).toBe('Saved');
  });
});

describe('the header', () => {
  const more = () => header().querySelector('button[aria-label="More for this post"]');
  const menu = () => document.querySelector('.float-menu[aria-label="This post"]');
  const notes = () => header().querySelector('button[aria-label="Add to notes"]');

  it('adds the post to the notes from its own button beside Open, and says so plainly', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    expect(notes().getAttribute('title')).toBe('Add to notes');
    expect(notes().nextElementSibling.textContent.trim()).toBe('Open');
    notes().click();
    flushSync();
    const ask = dialog('Add to notes');
    expect(ask.textContent).toContain('Writes this post into a new case note');
    button(ask, 'Add to notes').click();
    await settle();
    const [, note] = api.post.mock.calls.find(([path]) => path.endsWith('/notes'));
    expect(note.content).toContain('## Location');
    expect(note.sources).toContain(PROOF.png);
    expect(toasts()).toContain('Added to notes');
  });

  it('deletes the post open to the Trash, with Undo, and goes back home', async () => {
    lists.drafts = [{ name: 'Depot', title: 'Depot', target: 'x', posts: 1 }];
    lists.saved = { Depot: { title: 'Depot', state: { description: 'Depot fire', tweet1: 'Depot fire', tweet1Edited: true } } };
    api.del.mockImplementation(async () => ({ status: 'deleted', deleted: ['d1'], trash: 'trash-1' }));
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await settle();
    more().click();
    flushSync();
    // the ⋯ keeps Delete, and Delete only
    expect([...menu().querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Delete…']);
    button(menu(), 'Delete…').click();
    await settle(); // the dialog reads what the delete touches first
    const ask = document.querySelector('[role="alertdialog"]');
    expect(ask.textContent).toContain('Delete this post?');
    button(ask, 'Delete').click();
    await settle();
    expect(api.del).toHaveBeenCalledWith('/api/cases/case-1/drafts/Depot');
    expect(uiState.toasts.at(-1)).toMatchObject({ message: 'Deleted “Depot”', action: { label: 'Undo' } });
    expect(home()).not.toBeNull();
  });

  it('offers no ⋯ before the post was ever saved, and no note of a post that holds nothing', async () => {
    await mountPost();
    expect(more()).toBeNull();
    expect(notes().disabled).toBe(true);
  });
});

// An X status id for a known moment, as X makes them: its top bits count milliseconds
// from X's epoch. The post's day is read off it.
const snowflake = (iso) => (((BigInt(Date.parse(iso)) - 1288834974657n) << 22n) | 77n).toString();
const NINTH_MARCH = 'https://x.com/desk/status/' + snowflake('2025-03-09T12:00:00Z');

describe('Mark as posted, in the header', () => {
  const markButton = () => header().querySelector('button[aria-label="Mark as posted"]');
  const popover = () => document.querySelector('.float-menu[role="dialog"][aria-label="Mark as posted"]');
  const pill = () => header().querySelector('.pc-pill');
  const stateMenu = () => document.querySelector('.float-menu[aria-label="Where this post stands"]');
  const writeText = vi.fn(async () => {});
  const sendProof = async () => {
    uiState.postProof = { ...PROOF };
    await settle();
  };
  /** Mark as posted pressed, the field filled, and its own Mark as posted pressed. */
  const mark = async (link = '') => {
    markButton().click();
    flushSync();
    const field = popover().querySelector('input');
    type(field, link);
    button(popover(), 'Mark as posted').click();
    await settle();
  };

  beforeEach(() => {
    writeText.mockClear();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
  });

  it('stands beside Saved on every kind of post, and the link field is gone', async () => {
    await mountPost();
    for (const kind of ['geolocation', 'plate', 'free']) {
      startPost(kind);
      await settle();
      expect(markButton().textContent.trim()).toBe('Mark as posted');
      expect(target.querySelector('#pc-link')).toBeNull();
      expect(target.textContent).not.toContain('Link to your post');
    }
  });

  it('asks for the link in a popover, and marks the post posted with it', async () => {
    await mountPost();
    await sendProof();
    markButton().click();
    flushSync();
    const ask = popover();
    expect(ask.querySelector('label').textContent).toBe('Link to the post (optional)');
    expect(ask.querySelector('input').getAttribute('placeholder')).toBe('https://x.com/…');
    expect(ask.textContent).toContain('Keeps it with the proof and dates it.');
    expect(document.activeElement).toBe(ask.querySelector('input'));
    type(ask.querySelector('input'), `${NINTH_MARCH.replace('https://', '')}?s=20`);
    button(ask, 'Mark as posted').click();
    await settle();

    expect(popover()).toBeNull();
    expect(toasts()).toContain('Marked as posted');
    expect(markButton()).toBeNull();
    // the day is the post's own, read off its link
    expect(pill().textContent.trim()).toBe('Posted · 9 Mar 2025');
    expect(pill().classList.contains('posted')).toBe(true);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toEqual({
      site: 'x', url: NINTH_MARCH, posted_at: expect.any(String), mark: expect.any(String), changed: false,
    });
  });

  it('marks it posted with no link, on the platform it was written for', async () => {
    await mountPost();
    await sendProof();
    target.querySelectorAll('.target-tabs button')[1].click(); // Bluesky
    flushSync();
    await mark('');
    expect(pill().textContent.trim()).toMatch(/^Posted · \d{1,2} [A-Z][a-z]{2}$/);
    await saved();
    const publish = draftWrites().at(-1)[1].state.publish;
    expect(publish).toEqual({ site: 'bluesky', posted_at: expect.any(String), mark: expect.any(String), changed: false });
    // with no link, its menu has none to open or copy
    pill().click();
    flushSync();
    expect([...stateMenu().querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Add the link…', 'Not posted']);
  });

  it('refuses a link that is no X or Bluesky post, and marks nothing', async () => {
    await mountPost();
    await sendProof();
    await saved();
    const before = draftWrites().length;
    markButton().click();
    flushSync();
    type(popover().querySelector('input'), 'https://example.com/not-a-post');
    button(popover(), 'Mark as posted').click();
    await settle();
    expect(popover().querySelector('[role="alert"]').textContent).toBe('That is not the link of an X or Bluesky post.');
    expect(popover().querySelector('input').getAttribute('aria-invalid')).toBe('true');
    expect(markButton()).not.toBeNull();
    await saved();
    expect(draftWrites()).toHaveLength(before);
    // typing again clears the sentence, and Cancel leaves it a draft
    type(popover().querySelector('input'), 'https://x.com/desk');
    expect(popover().querySelector('[role="alert"]')).toBeNull();
    button(popover(), 'Cancel').click();
    flushSync();
    expect(popover()).toBeNull();
    expect(markButton()).not.toBeNull();
  });

  it('opens, copies and changes the link from the pill\'s menu, and Not posted takes it back', async () => {
    await mountPost();
    await sendProof();
    await mark(NINTH_MARCH);
    pill().click();
    flushSync();
    expect([...stateMenu().querySelectorAll('.fm-item')].map((b) => b.textContent.trim()))
      .toEqual(['Open the post', 'Copy link', 'Change link…', 'Not posted']);
    const open = stateMenu().querySelector('a.fm-item');
    expect(open.getAttribute('href')).toBe(NINTH_MARCH);
    expect(open.getAttribute('target')).toBe('_blank');
    button(stateMenu(), 'Copy link').click();
    await settle();
    expect(writeText).toHaveBeenCalledWith(NINTH_MARCH);
    expect(toasts()).toContain('Link copied');

    // Change link…: the popover holds the link, and another replaces it, the day kept
    pill().click();
    flushSync();
    button(stateMenu(), 'Change link…').click();
    flushSync();
    expect(popover().querySelector('input').value).toBe(NINTH_MARCH);
    const other = 'https://bsky.app/profile/desk.bsky.social/post/3kabc';
    type(popover().querySelector('input'), other);
    button(popover(), 'Save link').click();
    await saved();
    const publish = draftWrites().at(-1)[1].state.publish;
    expect(publish).toMatchObject({ site: 'bluesky', url: other, changed: false });
    expect(toasts()).toContain('Link saved');

    pill().click();
    flushSync();
    button(stateMenu(), 'Not posted').click();
    await settle();
    expect(markButton()).not.toBeNull();
    expect(pill()).toBeNull();
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toBeUndefined();
  });

  it('reads as changed since posted after an edit, the same menu on an amber pill, and as posted once undone', async () => {
    await mountPost();
    await sendProof();
    await mark(NINTH_MARCH);
    type(target.querySelector('#pc-desc'), 'Twelve helicopters, not thirteen');
    await settle();
    expect(pill().textContent.trim()).toBe('Changed since posted');
    expect(pill().classList.contains('changed')).toBe(true);
    pill().click();
    flushSync();
    expect([...stateMenu().querySelectorAll('.fm-item')].map((b) => b.textContent.trim()))
      .toEqual(['Open the post', 'Copy link', 'Change link…', 'Not posted']);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish.changed).toBe(true);
    type(target.querySelector('#pc-desc'), PROOF.description);
    await settle();
    expect(pill().textContent.trim()).toBe('Posted · 9 Mar 2025');
  });

  it('wears a soft accent after Publish until it is marked, and nothing of it is saved', async () => {
    await mountPost();
    await sendProof();
    expect(markButton().classList.contains('accent')).toBe(false);
    button(header(), 'Publish on X').click();
    await settle();
    expect(markButton().classList.contains('accent')).toBe(true);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toBeUndefined();
    await mark('');
    expect(markButton()).toBeNull();
    pill().click();
    flushSync();
    button(stateMenu(), 'Not posted').click();
    await settle();
    expect(markButton().classList.contains('accent')).toBe(false);
  });

  it('wears it after the extension\'s hand-off too, and loses it once the post is closed', async () => {
    bridge.installed = '0.3.3';
    lists.proofs = [{ name: 'waiting', title: 'waiting', png: 'proofs/waiting.png', thumb: null, video: null }];
    await mountPost();
    await sendProof();
    button(header(), 'Publish on X').click();
    await settle();
    expect(bridge.handOffPost).toHaveBeenCalledTimes(1);
    expect(markButton().classList.contains('accent')).toBe(true);
    button(header(), 'Posts').click();
    await settle();
    lists.saved = { [draftWrites().at(-1)[1].title]: { title: draftWrites().at(-1)[1].title, state: draftWrites().at(-1)[1].state } };
    uiState.openDraft = draftWrites().at(-1)[1].title;
    await settle();
    expect(markButton().classList.contains('accent')).toBe(false);
  });

  it('opens a posted post with its pill, a changed one amber, and an earlier build\'s opened one as a draft', async () => {
    lists.drafts = [{ name: 'Sent', title: 'Sent', target: 'x', posts: 1, state: 'draft' }, { name: 'Out', title: 'Out', target: 'x', posts: 1, state: 'posted' }];
    lists.saved = {
      Sent: { title: 'Sent', state: { description: 'D', tweet1: 'D', tweet1Edited: true, publish: { opened_at: '2026-11-10T10:00:00Z', site: 'bluesky' } } },
      Out: { title: 'Out', state: { description: 'D', tweet1: 'D', tweet1Edited: true, publish: { site: 'x', url: NINTH_MARCH, posted_at: '2026-11-10T10:05:00Z', mark: 'x', changed: true } } },
    };
    await mountPost();
    [...home().querySelectorAll('.ph-open')].find((b) => b.textContent.includes('Sent')).click();
    await settle();
    expect(markButton()).not.toBeNull();
    expect(markButton().classList.contains('accent')).toBe(false);
    button(header(), 'Posts').click();
    await settle();
    [...home().querySelectorAll('.ph-open')].find((b) => b.textContent.includes('Out')).click();
    await settle();
    // its print is recomputed on opening: a mark that is not this post's reads as changed
    expect(pill().textContent.trim()).toBe('Changed since posted');
  });

  it('takes a post marked from its card before it was opened as it stands, and opening it writes nothing', async () => {
    lists.drafts = [{ name: 'Out', title: 'Out', target: 'x', posts: 1, state: 'posted' }];
    lists.saved = { Out: { title: 'Out', state: { description: 'D', tweet1: 'D', tweet1Edited: true, publish: { site: 'x', posted_at: '2025-03-09T12:00:00Z', changed: false } } } };
    await mountPost();
    home().querySelector('.ph-open').click();
    await settle();
    expect(pill().textContent.trim()).toBe('Posted · 9 Mar 2025');
    await saved();
    expect(draftWrites()).toEqual([]);
    type(target.querySelector('#pc-desc'), 'Another word');
    await settle();
    expect(pill().textContent.trim()).toBe('Changed since posted');
  });

  it('marks a draft Geo Report saved, with no kind and no publish', async () => {
    lists.drafts = [{ name: 'Old', title: 'Old', target: 'x', posts: 1 }];
    lists.saved = { Old: { title: 'Old', state: {
      description: PROOF.description, coordsText: PROOF.coordsText, place: 'Los Anacuos, Miranda, Venezuela',
      mention: '@GeoConfirmed', source: SOURCE_X, proofPng: PROOF.png, tweet1: CLASSIC_FIRST_POST, tweet1Edited: false,
      target: 'x', mediaEnabled: true, mediaType: 'none', mediaText: '', mediaPath: null, extraTweets: [],
    } } };
    await mountPost();
    home().querySelector('.ph-open').click();
    await settle();
    await mark(NINTH_MARCH);
    await saved();
    const write = draftWrites().at(-1)[1];
    expect(write).toMatchObject({ rename_from: 'Old', title: 'Old' });
    expect(write.state.publish).toMatchObject({ url: NINTH_MARCH, site: 'x', changed: false });
    expect(write.state.kind).toBeUndefined();
  });

  it('files a blank post once it is marked posted, and nothing before', async () => {
    await mountPost();
    markButton().click();
    flushSync();
    button(popover(), 'Cancel').click();
    await saved();
    expect(draftWrites()).toEqual([]);
    await mark(NINTH_MARCH);
    await saved();
    expect(draftWrites()).toHaveLength(1);
    expect(draftWrites()[0][1].state.publish).toMatchObject({ url: NINTH_MARCH, site: 'x' });
  });

  it('writes where it went out into the note Add to notes makes', async () => {
    await mountPost();
    await sendProof();
    await mark(NINTH_MARCH);
    header().querySelector('button[aria-label="Add to notes"]').click();
    flushSync();
    button(dialog('Add to notes'), 'Add to notes').click();
    await settle();
    const [, note] = api.post.mock.calls.find(([path]) => path.endsWith('/notes'));
    expect(note.content).toContain('## Posted\n\n[On X, 2025-03-09](' + NINTH_MARCH + ')');
  });

  it('shows its icon alone at the header\'s narrowest step, its words in the hover', async () => {
    await mountPost();
    await sendProof();
    // a header too narrow for anything: every step folds
    const box = header();
    Object.defineProperty(box, 'clientWidth', { configurable: true, get: () => 300 });
    Object.defineProperty(box, 'scrollWidth', { configurable: true, get: () => 2000 });
    // the header is laid out again when what it holds changes: here, the post saved
    await saved();
    for (let i = 0; i < 4; i += 1) await settle();
    expect(box.classList.contains('tight')).toBe(true);
    expect(markButton().textContent.trim()).toBe('');
    expect(markButton().getAttribute('title')).toBe('Mark as posted');
  });
});

describe('a link the extension caught', () => {
  const caught = (extra = {}) => ({
    caseId: CASE.id, draft: 'Post 1', url: NINTH_MARCH, site: 'x', at: '2026-11-11T09:00:00Z', ...extra,
  });
  const proposal = () => header().querySelector('[role="group"][aria-label="Link caught"]');
  const pill = () => header().querySelector('.pc-pill');
  const writeOpen = async () => {
    uiState.postProof = { ...PROOF };
    await saved();
    return draftWrites().at(-1)[1].title;
  };

  it('is proposed on the post open, never kept by itself: Keep marks it posted at that link', async () => {
    await mountPost();
    const name = await writeOpen();
    bridge.caught(caught({ draft: name }));
    flushSync();
    expect(proposal().textContent.replace(/\s+/g, ' ').trim())
      .toBe(`Link caught: ${NINTH_MARCH.replace('https://', '')} Keep Not this one`);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toBeUndefined();
    button(proposal(), 'Keep').click();
    await settle();
    expect(proposal()).toBeNull();
    expect(pill().textContent.trim()).toBe('Posted · 9 Mar 2025');
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toMatchObject({ url: NINTH_MARCH, site: 'x', changed: false });
  });

  it('goes with Not this one, and the post stays as it stood', async () => {
    await mountPost();
    const name = await writeOpen();
    bridge.caught(caught({ draft: name }));
    flushSync();
    button(proposal(), 'Not this one').click();
    flushSync();
    expect(proposal()).toBeNull();
    expect(header().querySelector('button[aria-label="Mark as posted"]')).not.toBeNull();
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toBeUndefined();
  });

  it('asks in a toast for another post of the case, and Keep writes it through its own route', async () => {
    lists.entities = [{ id: 'p38', type: 'post', label: 'Post 38', attrs: { draft: '.drafts/Post 38.json' } }];
    lists.drafts = [{ name: 'Post 38', title: 'Post 38', target: 'x', posts: 1, state: 'draft' }];
    await mountPost();
    bridge.caught(caught({ draft: 'Post 38' }));
    flushSync();
    const ask = uiState.toasts.at(-1);
    expect(ask.message).toBe('Link caught for “Post 38”');
    expect(ask.action.map((one) => one.label)).toEqual(['Keep', 'Not this one']);
    expect(api.put).not.toHaveBeenCalled();
    ask.action[0].onClick();
    await settle();
    expect(api.put).toHaveBeenCalledWith('/api/cases/case-1/drafts/Post%2038/publish', { posted: true, url: NINTH_MARCH });
    expect(toasts()).toContain('Marked as posted');

    bridge.caught(caught({ draft: 'Post 38', url: 'https://x.com/desk/status/1850000000000000010' }));
    flushSync();
    api.put.mockClear();
    uiState.toasts.at(-1).action[1].onClick();
    await settle();
    expect(api.put).not.toHaveBeenCalled();
  });

  it('ignores a link for another case, and one for a post the case does not hold', async () => {
    await mountPost();
    const name = await writeOpen();
    const before = uiState.toasts.length;
    bridge.caught(caught({ caseId: 'case-2', draft: name }));
    bridge.caught(caught({ draft: 'Nowhere' }));
    flushSync();
    expect(proposal()).toBeNull();
    expect(uiState.toasts).toHaveLength(before);
  });

  it('says what went wrong in a hand-off, its report one press from the clipboard', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mountPost();
    bridge.reported({ caseId: CASE.id, draft: 'Post 1', error: 'The composer did not open.', report: 'tab 3: no composer after 20 s' });
    const said = uiState.toasts.at(-1);
    expect(said).toMatchObject({ message: 'The composer did not open.', kind: 'warn', action: { label: 'Copy report' } });
    said.action.onClick();
    await settle();
    expect(writeText).toHaveBeenCalledWith('tab 3: no composer after 20 s');
    const count = uiState.toasts.length;
    bridge.reported({ caseId: 'case-2', draft: 'Post 1', error: 'Elsewhere.', report: '' });
    expect(uiState.toasts).toHaveLength(count);
  });
});

describe('a post already out, from the home', () => {
  const row = (name, extra = {}) => ({
    name, title: name, updated_at: '2026-11-09T10:00:00Z', target: 'x', kind: 'geolocation', posts: 1, proof: null, video: null,
    state: 'draft', posted: null, picture: null, ...extra,
  });
  const popover = () => document.querySelector('.float-menu[role="dialog"][aria-label="Mark as posted"]');

  beforeEach(() => {
    lists.proofs = [{ name: 'waiting', title: 'waiting', png: 'proofs/waiting.png', thumb: null, video: null, updated_at: '2026-11-08T10:00:00Z' }];
    lists.specs = { waiting: { description: PROOF.description, points: [{ lat: GEO.lat, lon: GEO.lon }], source: SOURCE_X } };
  });

  it('starts a waiting proof\'s post from Mark as posted…, and the header\'s popover marks it', async () => {
    await mountPost();
    const card = home().querySelector('.post-card');
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="waiting"]');
    expect([...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Write its post', 'Open the proof', 'Mark as posted…']);
    button(menu, 'Mark as posted…').click();
    await settle();

    expect(home()).toBeNull();
    expect(target.querySelector('#pc-desc').value).toBe(PROOF.description);
    // the popover waits under the header's button, once the proof filled the post in
    expect(document.activeElement).toBe(popover().querySelector('input'));
    type(popover().querySelector('input'), NINTH_MARCH);
    button(popover(), 'Mark as posted').click();
    await saved();
    const write = draftWrites().at(-1)[1];
    expect(write.state.proofPng).toBe('proofs/waiting.png');
    expect(write.state.publish).toMatchObject({ url: NINTH_MARCH, site: 'x', changed: false });
  });

  it('offers it on a waiting slide\'s chip too, by a right-click', async () => {
    lists.proofs = [{ name: 'slide-1', title: 'slide-1', png: 'proofs/slide-1.png', thumb: null, video: 'media/clip.mp4', video_title: 'Convoy', slide: 1, slides: 1, order: 0 }];
    await mountPost();
    home().querySelector('.ph-chip').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="slide-1"]');
    expect([...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Write its post', 'Open the proof', 'Mark as posted…']);
  });

  it('opens the same menu from a waiting card\'s ⋯, Write its post doing what a press does', async () => {
    await mountPost();
    home().querySelector('button[aria-label="More for waiting"]').click();
    flushSync();
    button(document.querySelector('.float-menu[aria-label="waiting"]'), 'Write its post').click();
    await settle();
    expect(home()).toBeNull();
    expect(target.querySelector('.attach-chip').textContent).toContain('waiting.png');
    expect(popover()).toBeNull();
  });

  it('opens a card\'s proof in Geo Proof, on every card that has one the case still lists', async () => {
    lists.proofs = [
      { name: 'waiting', title: 'waiting', png: 'proofs/waiting.png', thumb: null, video: null },
      { name: 'bridge', title: 'Bridge', png: 'proofs/bridge.png', thumb: null, video: null },
      { name: 'slide-1', title: 'slide-1', png: 'proofs/slide-1.png', thumb: null, video: 'media/clip.mp4', video_title: 'Convoy', slide: 1, slides: 1, order: 0 },
    ];
    lists.drafts = [
      row('Bridge post', { proof: 'proofs/bridge.png' }),
      row('Out', { proof: 'proofs/bridge.png', state: 'posted', posted: { url: null, site: 'x', at: '2026-11-10T08:00:00Z' } }),
      row('Gone', { proof: 'proofs/deleted.png' }),
      row('Words', { kind: 'free' }),
    ];
    await mountPost();
    const items = (name) => {
      home().querySelector(`button[aria-label="More for ${name}"]`).click();
      flushSync();
      const menu = document.querySelector(`.float-menu[aria-label="${name}"]`);
      const said = [...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim());
      home().querySelector(`button[aria-label="More for ${name}"]`).click();
      flushSync();
      return said;
    };
    expect(items('Bridge post')).toEqual(['Open', 'Open the proof', 'Mark as posted…', 'Delete…']);
    expect(items('Out')).toEqual(['Open', 'Open the proof', 'Not posted', 'Delete…']);
    // a post whose proof is gone, and a free post, have none to open
    expect(items('Gone')).not.toContain('Open the proof');
    expect(items('Words')).not.toContain('Open the proof');
    expect(items('waiting')).toEqual(['Write its post', 'Open the proof', 'Mark as posted…']);
    home().querySelector('.ph-chip').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    flushSync();
    expect([...document.querySelector('.float-menu[aria-label="slide-1"]').querySelectorAll('.fm-item')].map((b) => b.textContent.trim()))
      .toContain('Open the proof');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    flushSync();

    home().querySelector('button[aria-label="More for Bridge post"]').click();
    flushSync();
    button(document.querySelector('.float-menu[aria-label="Bridge post"]'), 'Open the proof').click();
    flushSync();
    expect(uiState.openProof).toBe('bridge');
    expect(uiState.tool).toBe('proof');
    uiState.openProof = null;
  });

  it('marks a post in progress from its card, in a popover on the card, and the home reads it again', async () => {
    lists.proofs = [];
    lists.drafts = [row('Fresh'), row('Other')];
    await mountPost();
    home().querySelector('button[aria-label="More for Fresh"]').click();
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="Fresh"]');
    expect([...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Open', 'Mark as posted…', 'Delete…']);
    button(menu, 'Mark as posted…').click();
    flushSync();
    // marked on the home: the post is not opened
    expect(home()).not.toBeNull();
    expect(popover()).not.toBeNull();
    api.put.mockImplementation(async () => {
      lists.drafts = [row('Fresh', { state: 'posted', posted: { url: null, site: 'x', at: '2026-11-11T09:00:00Z' } }), row('Other')];
      return {};
    });
    const reads = () => api.get.mock.calls.filter(([path]) => path.endsWith('/drafts')).length;
    const before = reads();
    type(popover().querySelector('input'), '');
    button(popover(), 'Mark as posted').click();
    await settle();
    expect(api.put).toHaveBeenCalledWith('/api/cases/case-1/drafts/Fresh/publish', { posted: true, url: null });
    expect(reads()).toBe(before + 1);
    expect(toasts()).toContain('Marked as posted');
    expect([...home().querySelectorAll('[data-part="posted"] .ph-title')].map((t) => t.textContent)).toEqual(['Fresh']);
  });

  it('refuses a link that is no post on a card, and marks nothing', async () => {
    lists.proofs = [];
    lists.drafts = [row('Fresh')];
    await mountPost();
    home().querySelector('.post-card').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40 }));
    flushSync();
    button(document.querySelector('.float-menu[aria-label="Fresh"]'), 'Mark as posted…').click();
    flushSync();
    type(popover().querySelector('input'), 'https://example.com/post');
    button(popover(), 'Mark as posted').click();
    await settle();
    expect(popover().querySelector('[role="alert"]').textContent).toBe('That is not the link of an X or Bluesky post.');
    expect(api.put).not.toHaveBeenCalled();
  });

  it('offers a posted post\'s link, its copy and Not posted from its card\'s menu, and its link from Open', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    lists.drafts = [row('Out', { state: 'posted', posted: { url: NINTH_MARCH, site: 'x', at: '2026-11-10T08:00:00Z' } }), row('Fresh')];
    await mountPost();
    home().querySelector('button[aria-label="More for Out"]').click();
    flushSync();
    const menu = document.querySelector('.float-menu[aria-label="Out"]');
    expect([...menu.querySelectorAll('.fm-item')].map((b) => b.textContent.trim())).toEqual(['Open', 'See the post', 'Copy link', 'Not posted', 'Delete…']);
    button(menu, 'Copy link').click();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(NINTH_MARCH);
    expect(toasts()).toContain('Link copied');

    home().querySelector('button[aria-label="More for Out"]').click();
    flushSync();
    button(document.querySelector('.float-menu[aria-label="Out"]'), 'Not posted').click();
    await settle();
    expect(api.put).toHaveBeenCalledWith('/api/cases/case-1/drafts/Out/publish', { posted: false });

    button(header(), 'Open').click();
    await settle();
    const list = dialog('Open a post');
    const copies = list.querySelectorAll('button[title="Copy the post\'s link"]');
    expect(copies).toHaveLength(1);
    expect(copies[0].getAttribute('aria-label')).toBe('Copy the link of Out');
    copies[0].click();
    await settle();
    expect(writeText).toHaveBeenLastCalledWith(NINTH_MARCH);
    const open = list.querySelector('a[title="Open the post"]');
    expect(open.getAttribute('href')).toBe(NINTH_MARCH);
    expect(open.getAttribute('aria-label')).toBe('Open the post of Out');
    // the row with no link keeps the slots, so the pills line up
    const fresh = [...list.querySelectorAll('.ol-row')].find((r) => r.textContent.includes('Fresh'));
    expect(fresh.querySelectorAll('span.ol-act[aria-hidden="true"]')).toHaveLength(2);
  });
});

describe('the geolocation road, unchanged', () => {
  it('writes the same first post from a proof sent with To Post', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    expect(firstPost().value).toBe(CLASSIC_FIRST_POST);
  });

  it('saves a draft in the shape Geo Report saved, with no kind', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await saved();
    const state = draftWrites().at(-1)[1].state;
    expect(Object.keys(state)).toEqual([
      'description', 'coordsText', 'place', 'mention', 'source', 'date', 'proofPng', 'tweet1', 'tweet1Edited',
      'target', 'body', 'mediaEnabled', 'mediaType', 'mediaText', 'mediaTextIncludesPrefix', 'mediaPaths',
      'mediaPath', 'extraTweets',
    ]);
    expect(state.tweet1).toBe(CLASSIC_FIRST_POST);
  });

  it('opens a draft Geo Report saved, with the thread it held', async () => {
    lists.drafts = [{ name: 'Old', title: 'Old', target: 'x', posts: 1 }];
    lists.saved = { Old: { title: 'Old', state: {
      description: PROOF.description, coordsText: PROOF.coordsText, place: 'Los Anacuos, Miranda, Venezuela',
      mention: '@GeoConfirmed', source: SOURCE_X, proofPng: PROOF.png, tweet1: CLASSIC_FIRST_POST, tweet1Edited: false,
      target: 'x', mediaEnabled: true, mediaType: 'none', mediaText: '', mediaPath: null, extraTweets: [],
    } } };
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await settle();
    expect(target.querySelector('.kind-chip')).toBeNull();
    expect(firstPost().value).toBe(CLASSIC_FIRST_POST);
    expect(target.querySelector('.tweet-head .label').textContent).toBe('Geolocation post');
  });

  it('hands the extension the message it always took', async () => {
    bridge.installed = '0.3.3';
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    target.querySelector('[data-guide="post.publish"]').click();
    await settle();
    expect(bridge.handOffPost).toHaveBeenCalledTimes(1);
    const [message] = bridge.handOffPost.mock.calls[0];
    // the draft it names was written first, so the extension's reports name a post that exists
    expect(Object.keys(message)).toEqual(['url', 'caseId', 'posts', 'draft']);
    expect(draftWrites()).toHaveLength(1);
    expect(message.draft).toBe(draftWrites()[0][1].title);
    expect(message.url).toBe(`https://x.com/compose/post?text=${encodeURIComponent(CLASSIC_FIRST_POST)}`);
    expect(message.posts).toEqual([{ text: CLASSIC_FIRST_POST, files: [PROOF.png] }]);
    expect(opened).not.toHaveBeenCalled();
  });
});

describe('the extension window', () => {
  beforeEach(() => localStorage.removeItem(EXTENSION_WINDOW_KEY));

  it('says once why the extension is worth having, and Not now keeps a quiet line', async () => {
    await mountPost();
    const window = dialog('Post works best with the extension');
    expect(window.textContent).toContain('fills the whole thread in X or Bluesky, pictures included');
    button(window, 'Not now').click();
    flushSync();
    expect(dialog('Post works best with the extension')).toBeNull();
    expect(localStorage.getItem(EXTENSION_WINDOW_KEY)).toBe('not-now');
    expect(header().querySelector('.ext-quiet').textContent.replace(/\s+/g, ' ').trim()).toBe('Extension not connected · Install');
    // Copy and Publish are still there without it
    expect(target.querySelector('[data-guide="post.publish"]')).not.toBeNull();

    unmount(app);
    target.remove();
    await mountPost();
    expect(dialog('Post works best with the extension')).toBeNull();
    expect(header().querySelector('.ext-quiet')).not.toBeNull();
  });

  it('opens the guide on the extension\'s install page', async () => {
    await mountPost();
    button(dialog('Post works best with the extension'), 'How to install').click();
    flushSync();
    expect(uiState.guide).toEqual({ at: 'extension' });
    expect(dialog('Post works best with the extension')).toBeNull();
  });

  it('never shows, nor its line, where the extension is installed', async () => {
    bridge.installed = '0.3.3';
    await mountPost();
    expect(dialog('Post works best with the extension')).toBeNull();
    expect(header().querySelector('.ext-quiet')).toBeNull();
  });

  it('waits while Post is not the tool in front, and still works where storage is refused', async () => {
    uiState.tool = 'proof';
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    await mountPost();
    expect(dialog('Post works best with the extension')).toBeNull();
    uiState.tool = 'post';
    await settle();
    button(dialog('Post works best with the extension'), 'Not now').click();
    flushSync();
    expect(dialog('Post works best with the extension')).toBeNull();
  });
});

describe('Reply under the source', () => {
  const sendProof = async (extra = {}) => {
    uiState.postProof = { ...PROOF, ...extra };
    await settle();
  };
  const reply = () => button(header(), 'Reply under the source');
  const publishButton = () => button(header(), 'Publish on X');
  const replyBox = () => target.querySelector('.reply-check input[type="checkbox"]');
  const check = async (on = true) => {
    if (replyBox().checked !== on) replyBox().click();
    await settle();
  };
  const REPLY_POST = CLASSIC_FIRST_POST.replace(`\n\nSource: ${SOURCE_X}`, '');

  it('is a box under the source, offered only when the source is an X or Bluesky post', async () => {
    await mountPost();
    await sendProof({ source: 'https://instagram.com/p/abc' });
    expect(replyBox()).toBeNull();
    const source = target.querySelector('#pc-source');
    source.value = SOURCE_X;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(replyBox().closest('label').textContent.trim()).toBe('Post as a reply under the source');
    expect(replyBox().checked).toBe(false);
    // unchecked, Publish is the main action as it always was
    expect(publishButton()).toBeTruthy();
    expect(reply()).toBeUndefined();
  });

  it('checked, makes Reply the main action and takes the source line out of the post', async () => {
    await mountPost();
    await sendProof();
    expect(firstPost().value).toBe(CLASSIC_FIRST_POST);
    await check();
    expect(reply()).toBeTruthy();
    expect(publishButton()).toBeUndefined();
    expect(firstPost().value).toBe(REPLY_POST);
    // unchecked, the post and Publish come back
    await check(false);
    expect(firstPost().value).toBe(CLASSIC_FIRST_POST);
    expect(publishButton()).toBeTruthy();
  });

  it('takes the source line out of a rewritten post, and puts it back while untouched', async () => {
    await mountPost();
    await sendProof();
    const rewritten = `My words\n\nSource: ${SOURCE_X}\n\n@GeoConfirmed`;
    firstPost().value = rewritten;
    firstPost().dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await check();
    expect(firstPost().value).toBe('My words\n\n@GeoConfirmed');
    await check(false);
    expect(firstPost().value).toBe(rewritten);
  });

  it('opens X\'s reply page with the post as shown, the proof on the clipboard', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, platform: 'Linux x86_64', clipboard: { write, writeText: vi.fn(async () => {}) } });
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items; } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }) })));
    await mountPost();
    await sendProof();
    await check();
    reply().click();
    await settle();

    expect(opened).toHaveBeenCalledWith(
      `https://x.com/intent/post?in_reply_to=1850000000000000000&text=${encodeURIComponent(REPLY_POST)}`, '_blank', 'noopener,noreferrer',
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(opened.mock.invocationCallOrder[0]);
    expect(toasts()).toContain('Picture copied: paste it with Ctrl+V.');
  });

  it('starts checked on a template that replies by default, and the draft keeps the choice', async () => {
    templatesState.post = [{ id: 'po_r', name: 'Replies', data: { body: '#place - #pluscode\n\n#description\n\n#coordinates\n\n#mention\n\nSource: #source', reply: true } }];
    prefs.postTemplate = 'po_r';
    await mountPost();
    await sendProof();
    expect(replyBox().checked).toBe(true);
    expect(firstPost().value).toBe(REPLY_POST);
    await saved();
    const state = draftWrites().at(-1)[1].state;
    expect(state.reply).toBe(true);
    expect(state.tweet1).toBe(REPLY_POST);
  });

  it('opens a draft that replies with its box checked', async () => {
    lists.drafts = [{ name: 'Under', title: 'Under', target: 'x', posts: 1 }];
    lists.saved = { Under: { title: 'Under', state: { source: SOURCE_X, description: 'D', tweet1: 'D', tweet1Edited: true, reply: true } } };
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await settle();
    expect(replyBox().checked).toBe(true);
    expect(reply()).toBeTruthy();
  });

  it('hands the reply to the extension, which opens the source post', async () => {
    bridge.installed = '0.3.4';
    updatesState.extensionBundled = '0.3.4';
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    await mountPost();
    await sendProof();
    await check();
    reply().click();
    await settle();
    const [message] = bridge.handOffPost.mock.calls[0];
    expect(message.reply_to).toBe(SOURCE_X);
    expect(message.url).toBe(SOURCE_X);
    expect(message.posts[0].text).toBe(REPLY_POST);
    expect(message.posts[0].files).toEqual([PROOF.png]);
    expect(opened).not.toHaveBeenCalled();
  });

  it('keeps the reply for itself when the extension is older than the app', async () => {
    bridge.installed = '0.3.3';
    updatesState.extensionBundled = '0.3.4';
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) } });
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }) })));
    await mountPost();
    await sendProof();
    await check();
    reply().click();
    await settle();
    expect(bridge.handOffPost).not.toHaveBeenCalled();
    expect(opened.mock.calls[0][0]).toContain('in_reply_to=1850000000000000000');
  });

  it('says plainly that Bluesky replies through the extension, and copies the post', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mountPost();
    await sendProof({ source: 'https://bsky.app/profile/someone.bsky.social/post/3kabc' });
    await check();
    reply().click();
    await settle();
    const ask = dialog('Reply on Bluesky');
    expect(ask.textContent).toContain('only through the capture extension');
    expect(opened).not.toHaveBeenCalled();
    button(ask, 'Copy and open the source').click();
    await settle();
    expect(writeText.mock.calls.at(-1)[0]).not.toContain('Source:');
    expect(opened).toHaveBeenCalledWith('https://bsky.app/profile/someone.bsky.social/post/3kabc', '_blank', 'noopener,noreferrer');
  });
});

describe('Thread style', () => {
  const select = () => target.querySelector('#pc-tpl');
  const groups = () => [...select().querySelectorAll('optgroup')].map((g) => ({
    label: g.getAttribute('label'), options: [...g.querySelectorAll('option')].map((o) => o.textContent),
  }));
  const choose = (value) => {
    select().value = value;
    select().dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
  };

  it('offers the built-in layouts of the kind open with no template of the analyst\'s, and a way to Settings', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    expect(target.querySelector('.tpl-none')).toBeNull();
    expect(groups()).toEqual([{ label: 'Built-in', options: ['Classic', 'Coordinates only', 'Short', 'With date'] }]);
    expect(button(target, 'Settings templates')).toBeTruthy();
    startPost('plate');
    await settle();
    expect(groups()).toEqual([{ label: 'Built-in', options: ['Plate'] }]);
  });

  it('lists them under the analyst\'s own templates', async () => {
    templatesState.post = [{ id: 'po_geo', name: 'Geo house', data: { body: '#coordinates' } }];
    await mountPost();
    const options = [...select().children].map((node) => node.tagName === 'OPTGROUP' ? `[${node.getAttribute('label')}]` : node.textContent);
    expect(options).toEqual(['Apply a template…', 'Geo house', '[Built-in]']);
  });

  it('changes the body only, and Remove goes back to the layout it had', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    type(target.querySelector('#pc-mention'), '@desk');
    await settle();
    const mediaPost = () => [...target.querySelectorAll('.tweet-block .label')].some((l) => l.textContent === 'Media');
    expect(mediaPost()).toBe(true);
    choose('built-in:coordinates');
    expect(target.querySelector('.tpl-loaded-name').textContent.trim()).toBe('Coordinates only');
    expect(firstPost().value).toBe('10.303315, -66.874095\n\n@desk');
    expect(toasts()).toContain('Layout loaded: Coordinates only');
    // the mention and the media post stay as they were
    expect(target.querySelector('#pc-mention').value).toBe('@desk');
    expect(mediaPost()).toBe(true);
    await saved();
    expect(draftWrites().at(-1)[1].state.body).toBe('#coordinates\n\n#mention');
    target.querySelector('.tpl-remove').click();
    await settle();
    expect(firstPost().value).toContain('Los Anacuos, Miranda, Venezuela - 76XH+8F5');
    expect(firstPost().value).toContain('@desk');
  });

});

describe('a kind\'s default template', () => {
  it('starts that kind, and its Remove goes back to the kind\'s own layout', async () => {
    templatesState.post = [
      { id: 'po_geo', name: 'Geo house', data: { body: '#coordinates' } },
      { id: 'po_free', name: 'Free house', data: { body: '#description\n\nBy the desk', kind: 'free', mediaEnabled: false } },
    ];
    prefs.postTemplate = 'po_geo';
    prefs.postKindTemplates = { free: 'po_free' };
    await mountPost();
    expect(target.querySelector('.tpl-loaded-name').textContent.trim()).toBe('Geo house');

    startPost('free');
    await settle();
    expect(target.querySelector('.tpl-loaded-name').textContent.trim()).toBe('Free house');
    // a free post lists only the templates of its kind
    target.querySelector('.tpl-remove').click();
    await settle();
    expect([...target.querySelectorAll('#pc-tpl option')].map((o) => o.textContent)).toEqual(['Apply a template…', 'Free house', 'Text and source']);
    expect(target.querySelector('#pc-tpl optgroup').getAttribute('label')).toBe('Built-in');
    target.querySelector('#pc-desc').value = 'Smoke';
    target.querySelector('#pc-desc').dispatchEvent(new Event('input', { bubbles: true }));
    target.querySelector('#pc-desc').dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(firstPost().value).toBe('Smoke\n\n@GeoConfirmed');
  });
});
