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
  if (path.includes('/entities')) return { items: [], next: null };
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

describe('the header ⋯', () => {
  const more = () => header().querySelector('button[aria-label="More for this post"]');
  const menu = () => document.querySelector('.float-menu[aria-label="This post"]');

  it('adds the post to the notes, and says so plainly', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    more().click();
    flushSync();
    button(menu(), 'Add to notes…').click();
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

  it('offers no Delete before the post was ever saved', async () => {
    await mountPost();
    more().click();
    flushSync();
    expect(button(menu(), 'Delete…')).toBeUndefined();
    expect(button(menu(), 'Add to notes…').disabled).toBe(true);
  });
});

describe('whether a post went out', () => {
  const went = () => target.querySelector('.went');
  const words = () => went()?.textContent.replace(/\s+/g, ' ').trim() ?? '';
  const POSTED = 'https://x.com/desk/status/1850000000000000009';
  const publishNow = async () => {
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn(async () => {}) } });
    button(header(), 'Publish on X').click();
    await settle();
  };
  const paste = async (link) => {
    button(went(), 'Yes, paste its link').click();
    flushSync();
    const field = went().querySelector('input[aria-label="The post\'s address"]');
    field.value = link;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    button(went(), 'Mark as posted').click();
    await settle();
  };

  it('asks quietly once Publish opened the site, and the draft says it was opened', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    expect(went()).toBeNull();
    await publishNow();
    expect(words()).toBe('It went out? Yes, paste its link Not yet');
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toMatchObject({ site: 'x', opened_at: expect.any(String) });
    button(went(), 'Not yet').click();
    flushSync();
    expect(went()).toBeNull();
  });

  it('takes the post\'s link, refusing one that is no X or Bluesky post, and says it is posted', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await publishNow();
    await paste('https://example.com/not-a-post');
    expect(words()).toContain('That is not the address of an X or Bluesky post.');
    const field = went().querySelector('input');
    field.value = `${POSTED}?s=20`;
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    button(went(), 'Mark as posted').click();
    await settle();
    expect(words()).toMatch(/^Posted on X · \d{4}-\d{2}-\d{2} x\.com\/desk\/status\/1850000000000000009 Change link$/);
    expect(went().querySelector('a').getAttribute('href')).toBe(POSTED);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish).toMatchObject({ url: POSTED, site: 'x', changed: false, mark: expect.any(String) });
  });

  it('reads as changed since posted after an edit, and as posted again once it is undone', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await publishNow();
    await paste(POSTED);
    type(target.querySelector('#pc-desc'), 'Twelve helicopters, not thirteen');
    await settle();
    expect(words()).toMatch(/^Changed since posted on X/);
    await saved();
    expect(draftWrites().at(-1)[1].state.publish.changed).toBe(true);
    type(target.querySelector('#pc-desc'), PROOF.description);
    await settle();
    expect(words()).toMatch(/^Posted on X/);
  });

  it('asks again on opening a post that was opened and never said to have gone out', async () => {
    lists.drafts = [{ name: 'Out', title: 'Out', target: 'x', posts: 1, state: 'opened' }];
    lists.saved = { Out: { title: 'Out', state: { description: 'D', tweet1: 'D', tweet1Edited: true, publish: { opened_at: '2026-11-10T10:00:00Z', site: 'x' } } } };
    await mountPost();
    home().querySelector('.ph-open, button.ph-card').click();
    await settle();
    expect(words()).toContain('It went out?');
  });

  it('marks a hand-off to the extension as opened too', async () => {
    bridge.installed = '0.3.3';
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await publishNow();
    expect(bridge.handOffPost).toHaveBeenCalledTimes(1);
    expect(words()).toContain('It went out?');
  });

  it('writes where it went out into the note Add to notes makes', async () => {
    await mountPost();
    uiState.postProof = { ...PROOF };
    await settle();
    await publishNow();
    await paste(POSTED);
    header().querySelector('button[aria-label="More for this post"]').click();
    flushSync();
    button(document.querySelector('.float-menu'), 'Add to notes…').click();
    flushSync();
    button(dialog('Add to notes'), 'Add to notes').click();
    await settle();
    const [, note] = api.post.mock.calls.find(([path]) => path.endsWith('/notes'));
    expect(note.content).toContain(`## Posted\n\n[On X, `);
    expect(note.content).toContain(`](${POSTED})`);
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
