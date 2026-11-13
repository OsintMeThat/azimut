// @vitest-environment happy-dom
/**
 * A note handed to Post as pieces (`startPost`'s `pieces`, the Notebook's To Post),
 * actually mounted: the Free post it opens, its first post through the kind's template,
 * a proof in a post of its own, a long text cut under the platform's count, laid out
 * again for another platform while the analyst left it alone, and never once they
 * edited it; and what stayed out, said once.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

vi.mock('konva', () => ({ default: {} }));

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(async () => ({})), post: vi.fn(), del: vi.fn(async () => ({})) },
}));
vi.mock('../lib/api.js', () => ({ api }));
vi.mock('../lib/extBridge.js', () => ({
  extensionVersion: () => null,
  extensionOutdated: () => false,
  handOffPost: async () => true,
  onPostLinkCaught: () => () => {},
  onPostHandoffReport: () => () => {},
}));

const { caseState, prefs, templatesState, uiState } = await import('../lib/state.svelte.js');
const { default: PostComposer } = await import('./PostComposer.svelte');
const { startPost } = await import('./post/start.js');
const { EXTENSION_WINDOW_KEY } = await import('./post/extensionWindow.js');
const { postCharacterCount } = await import('../lib/post.js');

const CASE = { id: 'case-1', folders: [], entities: [] };
const PROOFS = [
  {
    name: 'depot-strike', title: 'depot-strike', png: 'proofs/depot-strike.png',
    points: [{ lat: 15.35, lon: 44.2, coords: '15.35, 44.2', label: '' }, { lat: 15.36, lon: 44.21, coords: '15.36, 44.21', label: 'Camera' }],
  },
];

let target;
let app;

function answer(path) {
  if (path === `/api/cases/${CASE.id}`) return CASE;
  if (path.endsWith('/proofs')) return PROOFS;
  if (path.endsWith('/media')) return [{ path: 'media/a.jpg', kind: 'image' }, { path: 'media/b.jpg', kind: 'image' }];
  if (path.includes('/entities/lookup')) return { entity: { id: 'e1', type: 'proof' } };
  if (path.includes('/entities')) return { items: [], next: null };
  return [];
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
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
const posts = () => [...target.querySelectorAll('.tweet-block textarea')].map((node) => node.value);
const pick = async (site) => {
  [...target.querySelector('.target-tabs').querySelectorAll('button')].find((b) => b.textContent.trim() === site).click();
  await settle();
};
const toasts = () => uiState.toasts.map((t) => t.message);

const NOTE = [
  { kind: 'text', text: 'Depot strike', heading: true },
  { kind: 'text', text: 'Smoke rose over the fuel depot on the morning of the 3rd.' },
  { kind: 'proof', name: 'depot-strike' },
  { kind: 'text', text: 'Two pictures from the ground.' },
  { kind: 'media', path: 'media/a.jpg', type: 'image' },
  { kind: 'media', path: 'media/b.jpg', type: 'image' },
  { kind: 'source', url: 'https://x.com/someone/status/1850000000000000000' },
];

beforeEach(() => {
  vi.clearAllMocks();
  api.get.mockImplementation(async (path) => answer(path));
  api.post.mockImplementation(async (path, body) => (
    path.endsWith('/drafts') ? { name: body.title, title: body.title, draft: `.drafts/${body.title}.json` } : {}
  ));
  prefs.postTemplate = '';
  prefs.postKindTemplates = {};
  prefs.postMention = '@GeoConfirmed';
  prefs.postMentionBluesky = null;
  prefs.postTarget = 'x';
  prefs.postAltText = false;
  templatesState.post = [];
  uiState.toasts.splice(0);
  uiState.tool = 'post';
  uiState.postStart = null;
  caseState.current = CASE;
  localStorage.setItem(EXTENSION_WINDOW_KEY, 'not-now');
});

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
  document.querySelectorAll('.overlay').forEach((node) => node.remove());
  caseState.current = null;
  uiState.tool = 'overview';
  uiState.postStart = null;
  localStorage.clear();
});

describe('a note handed to Post', () => {
  it('opens a Free post named after the note, laid out as a thread', async () => {
    await mountPost();
    startPost('free', [], { title: 'Depot report' }, NOTE);
    await settle();

    expect(target.querySelector('.kind-chip').textContent.trim()).toBe('Free post');
    expect(posts()).toEqual([
      'Depot strike\n\nSmoke rose over the fuel depot on the morning of the 3rd.\n\n@GeoConfirmed',
      '15.350000, 44.200000\nCamera — 15.36, 44.21',
      'Two pictures from the ground.\n\nhttps://x.com/someone/status/1850000000000000000',
    ]);
    expect([...target.querySelectorAll('.tweet-block')][2].textContent).toContain('a.jpg');
    expect(toasts()).toEqual([]);

    await saved();
    const write = draftWrites().at(-1)[1];
    expect(write.title).toBe('Depot report');
    expect(write.state).toMatchObject({ kind: 'free', firstMedia: [], firstMediaType: 'none' });
    expect(write.state.extraTweets.map((one) => [one.mediaType, one.mediaPaths])).toEqual([
      ['images', ['proofs/depot-strike.png']],
      ['images', ['media/a.jpg', 'media/b.jpg']],
    ]);
    // what laid it out stays in the composer, never in the draft
    expect(JSON.stringify(write.state)).not.toContain('fromNote');
  });

  it('cuts a long text under the platform\'s count, and lays it out again for another platform', async () => {
    const long = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
    await mountPost();
    startPost('free', [], { title: 'Long note' }, [{ kind: 'text', text: long }]);
    await settle();

    const onX = posts();
    expect(onX.length).toBeGreaterThan(4);
    for (const text of onX) expect(postCharacterCount('x', text)).toBeLessThanOrEqual(280);
    expect(onX.slice(1).join(' ')).toContain('word219');

    await pick('Bluesky');
    const onBluesky = posts();
    expect(onBluesky[0]).toContain('@geoconfirmed.org');
    expect(onBluesky[1].length).toBeGreaterThan(onX[1].length);
    for (const text of onBluesky) expect(postCharacterCount('bluesky', text)).toBeLessThanOrEqual(300);
    const words = [onBluesky[0].replace(/\n\n@geoconfirmed\.org$/, ''), ...onBluesky.slice(1)].join(' ');
    expect(words).toBe(long);
  });

  it('never lays out again a thread the analyst edited', async () => {
    const long = Array.from({ length: 220 }, (_, i) => `word${i}`).join(' ');
    await mountPost();
    startPost('free', [], { title: 'Long note' }, [{ kind: 'text', text: long }]);
    await settle();

    const second = target.querySelectorAll('.tweet-block textarea')[1];
    second.value = 'My own words.';
    second.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const before = posts();
    await pick('Bluesky');
    expect(posts().slice(1)).toEqual(before.slice(1));
  });

  it('says once what stayed out', async () => {
    await mountPost();
    startPost('free', [], { title: 'Gaps' }, [
      { kind: 'text', text: 'Words.' },
      { kind: 'proof', name: 'never-saved' },
    ]);
    await settle();
    expect(posts()).toEqual(['Words.\n\n@GeoConfirmed']);
    expect(toasts()).toEqual(['Left out of the thread: 1 file or proof not found in the case.']);
  });

  it('starts the note on the second post when the template has no #description', async () => {
    templatesState.post = [{ id: 'po_free', name: 'Desk', data: { body: 'From the desk #mention', kind: 'free', mediaEnabled: false } }];
    prefs.postKindTemplates = { free: 'po_free' };
    await mountPost();
    startPost('free', [], { title: 'Desk note' }, [{ kind: 'text', text: '- first\n- second' }]);
    await settle();
    expect(posts()).toEqual(['From the desk @GeoConfirmed', '- first\n- second']);
  });
});
