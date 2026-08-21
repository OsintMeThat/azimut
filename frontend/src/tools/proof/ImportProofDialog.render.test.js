// @vitest-environment happy-dom
/**
 * The import dialog, actually mounted.
 *
 * The engine suite next door proves what gets written; this one drives the
 * screen, because the two promises that matter here are about the screen:
 *
 * - **the prefill never decides.** A position read out of a post lands in the
 *   field with a note saying where it came from, and the analyst's approval is
 *   what confirms it;
 * - **nothing is created without the preview.** Create appears only once the
 *   preview has come back ready, and closing the dialog discards what was held.
 */
import { describe, expect, it, vi, afterEach, beforeEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock('../../lib/api.js', () => ({ api: { get, post, put, del } }));
vi.mock('../../lib/state.svelte.js', () => ({ toast: vi.fn() }));

const { default: ImportProofDialog } = await import('./ImportProofDialog.svelte');

const POST_TEXT = {
  url: 'https://x.com/a/1',
  title: 'Hoyo de la Puerta',
  text: 'Point of view — 10.393313, -66.892504 — Source: https://instagram.com/reels/D1',
  coords: [
    { lat: 10.393313, lon: -66.892504, text: '10.393313, -66.892504', format: 'decimal' },
    { lat: 48.8584, lon: 2.2945, text: '48.8584, 2.2945', format: 'decimal' },
  ],
  urls: ['https://instagram.com/reels/D1'],
};

const STAGED = { filename: 'panel.png', kind: 'image', size: 12345, sha256: 'a'.repeat(64) };

const READY_PREVIEW = {
  ready: true,
  blocking: [],
  entities: [
    { slot: 'place', type: 'place', label: '10°23′N', state: 'new', detail: '' },
    { slot: 'source', type: 'media', label: 'reel.mp4', state: 'new', detail: 'video · 2.4 MB' },
    { slot: 'panel', type: 'media', label: 'panel.png', state: 'new', detail: 'image · 0.4 MB' },
    { slot: 'proof', type: 'proof', label: 'Hoyo de la Puerta', state: 'new', detail: '' },
  ],
  links: [
    { from: 'source', to: 'place', type: 'located-at', label: 'was recorded at' },
    { from: 'proof', to: 'place', type: 'depicts', label: 'shows' },
  ],
  warnings: [],
};

let live = null;

/** The modal portals itself out of the mount point, so the screen under test is
 *  the document, not the element it was mounted into. */
function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(ImportProofDialog, {
    target,
    props: { caseId: 'c1', onclose: vi.fn(), oncreated: vi.fn(), ...props },
  });
  flushSync();
  return document.body;
}

async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
}

function buttons(target) {
  return [...target.querySelectorAll('button')].map((node) => node.textContent.trim());
}

function press(target, label) {
  const node = [...target.querySelectorAll('button')].find(
    (button) => button.textContent.trim() === label,
  );
  if (!node) throw new Error(`no button labelled '${label}' (have: ${buttons(target)})`);
  node.click();
  flushSync();
}

function field(target, label) {
  // Source is a set of boxes rather than one, so its wrapper is a div; the rest are
  // still labels around a single input.
  const wrapper = [...target.querySelectorAll('label, .import-field')].find((node) =>
    node.querySelector('span')?.textContent.trim().startsWith(label),
  );
  return wrapper?.querySelector('input');
}

function type(input, value) {
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

/** The fetch is a job: a token, a start, then polls until it is done. */
function fetchAnswers(result) {
  post.mockImplementation((path) => {
    if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
    if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
    if (path.endsWith('/preview')) return Promise.resolve(READY_PREVIEW);
    if (path.endsWith('/commit')) return Promise.resolve({ proof: { name: 'Hoyo de la Puerta' } });
    return Promise.resolve({});
  });
  get.mockResolvedValue({ status: 'done', progress: {}, result });
}

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('fetching a post', () => {
  it('opens on the address, and asks for nothing else first', () => {
    const target = open();
    expect(target.textContent).toContain('Post address');
    expect(buttons(target)).toContain('Fetch');
    expect(post).not.toHaveBeenCalled();
  });

  it('holds the picture in a staging directory rather than the case', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    expect(post).toHaveBeenCalledWith('/api/cases/c1/proof-imports/0123456789ab/fetch', {
      url: 'https://x.com/a/1',
      slot: 'panel',
      index: null,
      indexes: [],
      use_cookies: false,
    });
    const image = target.querySelector('img');
    expect(image.getAttribute('src')).toContain('media/.dl/0123456789ab/panel.png');
  });
});

describe('what the post prefilled', () => {
  async function fetched() {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    return target;
  }

  it('fills the position and says which words it was read from', async () => {
    const target = await fetched();
    expect(field(target, 'Coordinates').value).toBe('10.393313, -66.892504');
    expect(target.textContent).toContain('Read from the post: 10.393313, -66.892504');
  });

  it('offers the other positions it found instead of choosing between them', async () => {
    const target = await fetched();
    expect(buttons(target)).toContain('48.8584, 2.2945');
    press(target, '48.8584, 2.2945');
    expect(field(target, 'Coordinates').value).toBe('48.8584, 2.2945');
  });

  it('proposes the link the post points at as the source', async () => {
    const target = await fetched();
    expect(field(target, 'Source').value).toBe('https://instagram.com/reels/D1');
  });

  it('drops the note about where a position came from once it is edited', async () => {
    const target = await fetched();
    type(field(target, 'Coordinates'), '1.0, 2.0');
    expect(target.textContent).not.toContain('Read from the post');
  });
});

describe('a proof read from a thread', () => {
  async function fetched(urls = ['https://instagram.com/reels/D1']) {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: { ...POST_TEXT, urls } });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    return target;
  }

  function sourceBoxes(target) {
    return [...target.querySelectorAll('.import-source-row input')].map((one) => one.value);
  }

  it('offers a box for every address the post pointed at, not just the first', async () => {
    // A thread naming the photos and the clip names its material. Picking the first
    // would be the dialog choosing for the analyst.
    const target = await fetched([
      'https://x.com/a/2', 'https://x.com/a/3', 'https://x.com/a/4',
    ]);
    expect(sourceBoxes(target)).toEqual([
      'https://x.com/a/2', 'https://x.com/a/3', 'https://x.com/a/4',
    ]);
  });

  it('adds a box, and fetches each address on its own', async () => {
    const target = await fetched();
    press(target, 'Add a source');
    const boxes = [...target.querySelectorAll('.import-source-row input')];
    expect(boxes).toHaveLength(2);

    type(boxes[1], 'https://x.com/a/2');
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: { slot: 'source', staged: STAGED, held: [STAGED] },
    });
    press(target, 'Preview');
    await settle();

    const asked = post.mock.calls
      .filter(([path, body]) => path.endsWith('/fetch') && body.slot === 'source')
      .map(([, body]) => body.url);
    expect(asked).toEqual(['https://instagram.com/reels/D1', 'https://x.com/a/2']);
    // And the form states both, in the order the boxes hold them.
    const asked_preview = post.mock.calls.find(([path]) => path.endsWith('/preview'))[1];
    expect(asked_preview.source_urls).toEqual([
      'https://instagram.com/reels/D1', 'https://x.com/a/2',
    ]);
  });

  it('drops a box without touching what the others hold', async () => {
    const target = await fetched(['https://x.com/a/2', 'https://x.com/a/3']);
    const drops = [...target.querySelectorAll('.import-source-drop')];
    expect(drops).toHaveLength(2);
    drops[0].click();
    flushSync();
    expect(sourceBoxes(target)).toEqual(['https://x.com/a/3']);
  });
});

describe('a post that states nothing', () => {
  it('leaves every field empty and offers no chips', async () => {
    fetchAnswers({
      slot: 'panel',
      staged: STAGED,
      post: { url: 'https://x.com/a/1', title: '', text: 'Look at this', coords: [], urls: [] },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    expect(field(target, 'Coordinates').value).toBe('');
    expect(field(target, 'Source').value).toBe('');
    expect(target.textContent).not.toContain('Read from the post');
  });
});

describe('the preview gate', () => {
  async function filled() {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    return target;
  }

  it('offers a preview, never a create, before anything has been checked', async () => {
    const target = await filled();
    expect(buttons(target)).toContain('Preview');
    expect(buttons(target)).not.toContain('Create');
  });

  it('will not preview without a name and a position', async () => {
    const target = await filled();
    type(field(target, 'Coordinates'), '');
    const preview = [...target.querySelectorAll('button')].find(
      (node) => node.textContent.trim() === 'Preview',
    );
    expect(preview.disabled).toBe(true);
  });

  it('downloads the source before previewing, so the preview reads real bytes', async () => {
    const target = await filled();
    press(target, 'Preview');
    await settle();

    const fetches = post.mock.calls.filter(([path]) => path.endsWith('/fetch'));
    expect(fetches.map(([, body]) => body.slot)).toEqual(['panel', 'source']);
    expect(fetches[1][1].url).toBe('https://instagram.com/reels/D1');
  });

  it('lists the entities and the edges, then offers Create', async () => {
    const target = await filled();
    press(target, 'Preview');
    await settle();

    expect(target.textContent).toContain('To be created');
    expect(target.textContent).toContain('was recorded at');
    expect(target.textContent).toContain('Hoyo de la Puerta');
    expect(buttons(target)).toContain('Create');
  });

  it('does not claim the camera was on site until it is ticked', async () => {
    const target = await filled();
    press(target, 'Preview');
    await settle();
    const [, body] = post.mock.calls.find(([path]) => path.endsWith('/preview'));
    expect(body.pov).toBe(false);
  });

  it('sends the camera answer once it is given', async () => {
    const target = await filled();
    const box = target.querySelector('input[type="checkbox"]');
    box.click();
    flushSync();
    press(target, 'Preview');
    await settle();
    const [, body] = post.mock.calls.find(([path]) => path.endsWith('/preview'));
    expect(body.pov).toBe(true);
  });

  it('withdraws Create the moment a field changes again', async () => {
    const target = await filled();
    press(target, 'Preview');
    await settle();
    type(field(target, 'Name'), 'Another name');
    expect(buttons(target)).not.toContain('Create');
    expect(buttons(target)).toContain('Preview');
  });

  it('refuses to create and says why when the preview is not ready', async () => {
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      if (path.endsWith('/preview')) {
        return Promise.resolve({
          ready: false,
          blocking: ['A source is required.'],
          entities: [],
          links: [],
          warnings: [],
        });
      }
      return Promise.resolve({});
    });
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: { slot: 'panel', staged: STAGED, post: { ...POST_TEXT, urls: [] } },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    press(target, 'Preview');
    await settle();

    expect(target.textContent).toContain('A source is required.');
    expect(buttons(target)).not.toContain('Create');
  });

  it('shows a warning without blocking the create', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      if (path.endsWith('/preview')) {
        return Promise.resolve({
          ...READY_PREVIEW,
          warnings: [{ code: 'gps-conflict', text: 'The file states 10.4, -66.9 — 800 m away.' }],
        });
      }
      return Promise.resolve({});
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    press(target, 'Preview');
    await settle();

    expect(target.textContent).toContain('800 m away');
    expect(buttons(target)).toContain('Create');
  });
});

describe('the two files the import is holding', () => {
  async function withBoth() {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    // pressing Preview is what downloads the footage, so the viewer gains it there
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        slot: 'source',
        staged: { filename: 'reel.mp4', kind: 'video', size: 2400000, sha256: 'b'.repeat(64) },
      },
    });
    press(target, 'Preview');
    await settle();
    return target;
  }

  it('shows the proof picture on its own until the footage lands', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    expect(target.textContent).toContain('Proof:');
    expect(target.querySelector('[aria-label="Next file"]')).toBeNull();
  });

  it('offers both files once the footage has been downloaded', async () => {
    const target = await withBoth();
    expect(target.textContent).toContain('Proof:');
    expect(target.textContent).toContain('1/2');
    expect(target.querySelector('[aria-label="Next file"]')).not.toBeNull();
  });

  it('steps to the footage and plays it from the staging directory', async () => {
    const target = await withBoth();
    target.querySelector('[aria-label="Next file"]').click();
    flushSync();

    expect(target.textContent).toContain('Source media:');
    expect(target.textContent).toContain('reel.mp4');
    const video = target.querySelector('video');
    expect(video.getAttribute('src')).toContain('media/.dl/0123456789ab/reel.mp4');
    expect(target.querySelector('img')).toBeNull();
  });

  it('wraps back round to the proof', async () => {
    const target = await withBoth();
    target.querySelector('[aria-label="Next file"]').click();
    flushSync();
    target.querySelector('[aria-label="Next file"]').click();
    flushSync();
    expect(target.textContent).toContain('Proof:');
  });
});

describe('what a slot can hold', () => {
  it('refuses a clip for the picture slot where it is chosen, not two screens later', async () => {
    // A proof is composed of pictures: the composer lays panels out on a canvas and a
    // video has nothing to lay out. Ticking one used to download it, fill the picture
    // slot with it, and say so only at the preview.
    fetchAnswers({
      multi: true,
      items: [
        { index: 1, title: 'the published picture', thumbnail: null, kind: 'image', own: true },
        { index: 2, title: 'the clip', thumbnail: null, kind: 'video', own: true },
      ],
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    const rows = [...target.querySelectorAll('.import-pick')];
    expect(rows[0].disabled).toBe(false);
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    // Shown, so "this post also carries a clip" is legible, and refused.
    expect(rows[1].disabled).toBe(true);
    expect(rows[1].getAttribute('aria-pressed')).toBe('false');

    rows[1].click();
    flushSync();
    expect(
      [...target.querySelectorAll('.import-pick')][1].getAttribute('aria-pressed'),
    ).toBe('false');
  });
});

describe('a question nobody has answered yet', () => {
  it('reports nothing while a picker is open, and nothing once it is cancelled', async () => {
    // Preview downloads the material first, so an address holding several files raises
    // the picker mid-press. Reading the case behind that question reported on a state
    // nobody had agreed to: the picker cancelled, the preview still said "ready", and
    // Create filed a proof whose source had never been downloaded.
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        multi: true,
        items: [
          { index: 1, title: 'the clip', thumbnail: null, kind: 'video', own: true },
          { index: 2, title: 'the quoted clip', thumbnail: null, kind: 'video', own: false },
        ],
      },
    });
    press(target, 'Preview');
    await settle();

    expect(post.mock.calls.some(([path]) => path.endsWith('/preview'))).toBe(false);
    expect(target.textContent).toContain('Choose the footage');
    expect(buttons(target)).not.toContain('Create');

    // the picker's own Cancel, not the dialog's
    [...target.querySelectorAll('button')].filter((one) => one.textContent.trim() === 'Cancel')
      .at(-1).click();
    flushSync();
    expect(target.textContent).not.toContain('Choose the footage');
    expect(buttons(target)).not.toContain('Create');
  });
});

describe('a post with several attachments', () => {
  async function picking() {
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      if (path.endsWith('/preview')) return Promise.resolve(READY_PREVIEW);
      return Promise.resolve({});
    });
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        multi: true,
        items: [
          { index: 1, title: 'first photo', thumbnail: 'https://cdn/a.jpg', kind: 'image' },
          { index: 2, title: 'the clip', thumbnail: null, kind: 'video' },
        ],
      },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    return target;
  }

  it('previews each attachment with the poster frame the extractor gave', async () => {
    const target = await picking();
    const thumbs = [...target.querySelectorAll('.import-pick-thumb img')];
    expect(thumbs.map((node) => node.getAttribute('src'))).toEqual(['https://cdn/a.jpg']);
    expect(target.textContent).toContain('first photo');
    expect(target.textContent).toContain('This link has 2 attachments');
  });

  it('falls back to the kind for an attachment with no poster frame', async () => {
    const target = await picking();
    const rows = [...target.querySelectorAll('.import-pick')];
    expect(rows[1].querySelector('img')).toBeNull();
    expect(rows[1].querySelector('svg')).not.toBeNull();
    expect(rows[1].textContent).toContain('video');
  });

  /** Answer the picker: tick what is wanted, then take it. The confirm button says how
   *  many panels it is composing, so it is found by its role rather than its words. */
  async function take(target, ...ticks) {
    for (const at of ticks) {
      [...target.querySelectorAll('.import-pick')][at].click();
      flushSync();
    }
    [...target.querySelectorAll('.modal-row .btn-primary')].at(-1).click();
    flushSync();
    await settle();
  }

  it('arrives with the pictures ticked, because that is what a post published', async () => {
    const target = await picking();
    const rows = [...target.querySelectorAll('.import-pick')];
    // The picture is the point of the post; the clip beside it is the footage, and which
    // clip is the source is not something a rule knows.
    expect(rows[0].getAttribute('aria-pressed')).toBe('true');
    expect(rows[1].getAttribute('aria-pressed')).toBe('false');
    expect(target.textContent).toContain('become the panels of one proof');
  });

  it('counts a picked source as tried, so the preview does not fetch it twice', async () => {
    const target = await picking();
    // the picker was opened for the picture; answer it, then drive to a preview
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: { slot: 'panel', staged: STAGED, post: { ...POST_TEXT, urls: [] } },
    });
    await take(target);
    type(field(target, 'Source'), 'https://instagram.com/reels/D1');
    press(target, 'Preview');
    await settle();

    const sources = post.mock.calls.filter(
      ([path, body]) => path.endsWith('/fetch') && body.slot === 'source',
    );
    expect(sources).toHaveLength(1);
  });

  it('downloads only what was ticked', async () => {
    // Two pictures, both of use to the slot: unticking the first and keeping the second
    // is a choice the analyst is allowed to make. (A clip is not — see the slot's own
    // kinds — so it cannot stand in for the second picture here.)
    fetchAnswers({
      multi: true,
      items: [
        { index: 1, title: 'the overhead', thumbnail: null, kind: 'image', own: true },
        { index: 2, title: 'the ground shot', thumbnail: null, kind: 'image', own: true },
      ],
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    await take(target, 0); // untick the first; the second stays

    const fetches = post.mock.calls.filter(([path]) => path.endsWith('/fetch'));
    expect(fetches.at(-1)[1].index).toBe(2);
    expect(fetches.at(-1)[1].indexes).toEqual([2]);
  });

  it('renders a report about several panels rather than blanking on it', async () => {
    // The report is keyed by slot. Three pictures all called `panel` are a duplicate key,
    // Svelte throws on those, and the whole reading disappears — the loudest failure for
    // the quietest fault, and indistinguishable from a preview that never answered.
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      if (path.endsWith('/preview'))
        return Promise.resolve({
          ready: true,
          blocking: [],
          warnings: [],
          entities: [
            { slot: 'panel', type: 'media', label: 'overhead', state: 'new', detail: '' },
            { slot: 'panel 2', type: 'media', label: 'ground', state: 'new', detail: '' },
            { slot: 'panel 3', type: 'media', label: 'match', state: 'new', detail: '' },
          ],
          links: [
            { from: 'proof', to: 'panel', type: 'derived-from', label: 'derived from' },
            { from: 'proof', to: 'panel 2', type: 'derived-from', label: 'derived from' },
            { from: 'proof', to: 'panel 3', type: 'derived-from', label: 'derived from' },
          ],
        });
      return Promise.resolve({});
    });
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        slot: 'panel',
        staged: STAGED,
        held: [STAGED, { ...STAGED, filename: 'p2.png' }, { ...STAGED, filename: 'p3.png' }],
        post: { ...POST_TEXT, urls: [] },
      },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    type(field(target, 'Source'), 'https://instagram.com/reels/D1');
    press(target, 'Preview');
    await settle();

    expect(target.querySelectorAll('.import-links li')).toHaveLength(3);
    expect(target.textContent).toContain('panel 3');
  });

  it('shows the set it will compose, not one picture of it', async () => {
    // "Where are my three images?" is the question the stepper alone could not answer:
    // it counted the footage as if it were part of the proof and showed one at a time.
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      return Promise.resolve({});
    });
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        slot: 'panel',
        staged: STAGED,
        held: [STAGED, { ...STAGED, filename: 'panel-2.png' }, { ...STAGED, filename: 'panel-3.png' }],
        post: POST_TEXT,
      },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    const strip = target.querySelector('.import-strip');
    expect(strip.querySelectorAll('.import-strip-one')).toHaveLength(3);
    expect(target.textContent).toContain('One proof of 3 panels');
    // And each is reachable on its own, which is what the stepper was for.
    expect(target.textContent).toContain('Panel 1');
  });

  it('composes several ticked pictures as the panels of one proof', async () => {
    // A published geolocation is often a set — the overhead, the ground shot, the match.
    // Keeping the first of three keeps a third of what was published.
    post.mockImplementation((path) => {
      if (path.endsWith('/proof-imports')) return Promise.resolve({ token: '0123456789ab' });
      if (path.endsWith('/fetch')) return Promise.resolve({ job_id: 'j1' });
      if (path.endsWith('/preview')) return Promise.resolve(READY_PREVIEW);
      return Promise.resolve({});
    });
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: {
        multi: true,
        items: [
          { index: 1, title: 'overhead', thumbnail: 'https://cdn/a.jpg', kind: 'image' },
          { index: 2, title: 'ground', thumbnail: 'https://cdn/b.jpg', kind: 'image' },
          { index: 3, title: 'the clip', thumbnail: null, kind: 'video' },
        ],
      },
    });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();

    expect(target.textContent).toContain('Compose 2 panels');
    get.mockResolvedValue({
      status: 'done',
      progress: {},
      result: { slot: 'panel', staged: STAGED, post: POST_TEXT },
    });
    await take(target);

    const fetches = post.mock.calls.filter(([path]) => path.endsWith('/fetch'));
    expect(fetches.at(-1)[1].indexes).toEqual([1, 2]);
  });
});

describe('creating and cancelling', () => {
  it('commits the form the preview approved, then hands the proof back', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const oncreated = vi.fn();
    const target = open({ oncreated });
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    press(target, 'Preview');
    await settle();
    press(target, 'Create');
    await settle();

    const [path, body] = post.mock.calls.find(([p]) => p.endsWith('/commit'));
    expect(path).toBe('/api/cases/c1/proof-imports/0123456789ab/commit');
    expect(body.coords).toBe('10.393313, -66.892504');
    expect(oncreated).toHaveBeenCalledWith({ proof: { name: 'Hoyo de la Puerta' } });
  });

  it('discards what it held when the dialog is closed', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const onclose = vi.fn();
    const target = open({ onclose });
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    press(target, 'Cancel');
    await settle();

    expect(del).toHaveBeenCalledWith('/api/cases/c1/proof-imports/0123456789ab');
    expect(onclose).toHaveBeenCalled();
  });

  it('does not discard after a commit, which already cleaned up', async () => {
    fetchAnswers({ slot: 'panel', staged: STAGED, post: POST_TEXT });
    const target = open();
    type(target.querySelector('input.input'), 'https://x.com/a/1');
    press(target, 'Fetch');
    await settle();
    press(target, 'Preview');
    await settle();
    press(target, 'Create');
    await settle();

    expect(del).not.toHaveBeenCalled();
  });
});
