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

const bridge = vi.hoisted(() => ({ installed: null, handOffPost: null }));
vi.mock('../lib/extBridge.js', () => ({
  extensionVersion: () => bridge.installed,
  extensionOutdated: (installed, bundled) => Boolean(installed && bundled && installed < bundled),
  handOffPost: (...args) => bridge.handOffPost(...args),
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
  if (path.includes('/entities')) return { items: [], next: null };
  return [];
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
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
  lists = { drafts: [], proofs: [], media: [], saved: {}, specs: {} };
  api.get.mockImplementation(async (path) => answer(path));
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
    // the header waits for a post: nothing to save or publish from here
    expect(button(header(), 'New post')).toBeTruthy();
    expect(button(header(), 'Save as draft')).toBeUndefined();
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
    home().querySelector('.ph-card').click();
    await settle();

    expect(home()).toBeNull();
    expect(target.querySelector('#pc-desc').value).toBe(PROOF.description);
    expect(target.querySelector('.attach-chip').textContent).toContain('waiting.png');
    button(header(), 'Posts').click();
    await settle();
    // it asks first, since the post is not saved
    button(document.querySelector('[role="alertdialog"]'), 'Leave without saving').click();
    await settle();
    expect(home()).not.toBeNull();
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

    target.querySelector('.tweet-block textarea').value = 'Smoke over the port';
    target.querySelector('.tweet-block textarea').dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    button(header(), 'Save as draft').click();
    await settle();
    const saved = api.post.mock.calls.find(([path]) => path.endsWith('/drafts'))[1].state;
    expect(saved).toMatchObject({ kind: 'free', firstMedia: ['media/a.png'], firstMediaType: 'images', mediaPaths: ['media/clip.mp4'] });
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
    await settle();
    button(header(), 'Save as draft').click();
    await settle();
    const state = api.post.mock.calls.find(([path]) => path.endsWith('/drafts'))[1].state;
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
    home().querySelector('.ph-card').click();
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
    expect(Object.keys(message)).toEqual(['url', 'caseId', 'posts']);
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
  const sendProof = async () => {
    uiState.postProof = { ...PROOF };
    await settle();
  };
  const reply = () => button(header(), 'Reply under the source');

  it('is offered only when the source is an X or Bluesky post', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF, source: 'https://instagram.com/p/abc' };
    await settle();
    expect(reply()).toBeUndefined();
    const source = target.querySelector('#pc-source');
    source.value = SOURCE_X;
    source.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(reply()).toBeTruthy();
  });

  it('opens X\'s reply page without the source line, the proof on the clipboard', async () => {
    const write = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, platform: 'Linux x86_64', clipboard: { write, writeText: vi.fn(async () => {}) } });
    vi.stubGlobal('ClipboardItem', class { constructor(items) { this.items = items; } });
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }) })));
    await mountPost();
    await sendProof();
    reply().click();
    await settle();

    const text = CLASSIC_FIRST_POST.replace(`\n\nSource: ${SOURCE_X}`, '');
    expect(opened).toHaveBeenCalledWith(
      `https://x.com/intent/post?in_reply_to=1850000000000000000&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer',
    );
    expect(write).toHaveBeenCalledTimes(1);
    expect(write.mock.invocationCallOrder[0]).toBeLessThan(opened.mock.invocationCallOrder[0]);
    expect(toasts()).toContain('Picture copied: paste it with Ctrl+V.');
  });

  it('keeps the source line when the template says so', async () => {
    templatesState.post = [{ id: 'po_k', name: 'Keep', data: { body: '#place - #pluscode\n\n#description\n\n#coordinates\n\n#mention\n\nSource: #source', reply: 'keep-source' } }];
    prefs.postTemplate = 'po_k';
    vi.stubGlobal('navigator', { ...navigator, clipboard: { write: vi.fn(async () => {}), writeText: vi.fn(async () => {}) } });
    vi.stubGlobal('ClipboardItem', class {});
    vi.stubGlobal('fetch', vi.fn(async () => ({ blob: async () => new Blob(['png'], { type: 'image/png' }) })));
    await mountPost();
    await sendProof();
    reply().click();
    await settle();
    expect(decodeURIComponent(opened.mock.calls[0][0])).toContain(`Source: ${SOURCE_X}`);
  });

  it('hands the reply to the extension, which opens the source post', async () => {
    bridge.installed = '0.3.4';
    updatesState.extensionBundled = '0.3.4';
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    await mountPost();
    await sendProof();
    reply().click();
    await settle();
    const [message] = bridge.handOffPost.mock.calls[0];
    expect(message.reply_to).toBe(SOURCE_X);
    expect(message.url).toBe(SOURCE_X);
    expect(message.posts[0].text).not.toContain('Source:');
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
    reply().click();
    await settle();
    expect(bridge.handOffPost).not.toHaveBeenCalled();
    expect(opened.mock.calls[0][0]).toContain('in_reply_to=1850000000000000000');
  });

  it('says plainly that Bluesky replies through the extension, and copies the post', async () => {
    const writeText = vi.fn(async () => {});
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText } });
    await mountPost();
    uiState.postProof = { ...PROOF, source: 'https://bsky.app/profile/someone.bsky.social/post/3kabc' };
    await settle();
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
    expect([...target.querySelectorAll('#pc-tpl option')].map((o) => o.textContent)).toEqual(['Apply a template…', 'Free house']);
    target.querySelector('#pc-desc').value = 'Smoke';
    target.querySelector('#pc-desc').dispatchEvent(new Event('input', { bubbles: true }));
    target.querySelector('#pc-desc').dispatchEvent(new Event('change', { bubbles: true }));
    await settle();
    expect(firstPost().value).toBe('Smoke\n\n@GeoConfirmed');
  });
});
