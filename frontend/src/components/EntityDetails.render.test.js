// @vitest-environment happy-dom
/**
 * The panel mounted, for the one thing reading the source cannot answer: whether
 * the declared fields end up carrying the values the entity actually holds.
 *
 * Seeding is keyed on the entity id, and the vocabulary is fetched — so a registry
 * that landed after the panel opened used to leave a radius of 500 rendering as
 * "Unknown". Nothing was lost on Save (the backend merges `attrs`), but the panel
 * was telling the analyst the case held nothing there.
 *
 * The registry here is the real `entityTypes.svelte.js` with only its fetch stubbed,
 * and `caseState` is a real rune object: the bug is in dependency tracking, so an
 * inert stand-in would make the effect under test never re-run and the guard
 * meaningless.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const REGISTRY = [
  {
    type: 'place',
    family: 'place',
    label: 'Place',
    manual: true,
    icon: 'pin',
    identity_label: 'Title',
    identity_placeholder: 'What to call it',
    group: '',
    attrs: [
      { key: 'radius_m', label: 'Uncertainty radius (m)', kind: 'number', rungs: [], minimum: 1 },
      { key: 'method', label: 'How this point was found', kind: 'longtext', rungs: [] },
    ],
  },
];

// The vocabulary request, held open until the test lets it land.
let landRegistry;
const registryLanded = new Promise((resolve) => {
  landRegistry = resolve;
});

// Hoisted with the mock factory that closes over it, so the spy exists before the
// panel's first import pulls the mocked module in.
const { patch } = vi.hoisted(() => ({ patch: vi.fn() }));

vi.mock('../lib/api.js', async () => {
  // The panel reads its entity off the bounded chain endpoint, never off the case.
  const { entity, mediaItem } = await import('./details.fixture.svelte.js');
  const chain = { entity, sources: [], lost: [], dependents: [], relations: [], empty: true };
  return {
    api: {
      get: (url) => {
        if (url.includes('entity-types')) return registryLanded;
        if (url.includes('/media/item')) return Promise.resolve({ ...mediaItem });
        return Promise.resolve(chain);
      },
      patch,
      post: vi.fn(),
      del: vi.fn(),
    },
  };
});
vi.mock('../lib/state.svelte.js', async () => await import('./details.fixture.svelte.js'));
vi.mock('../lib/relations.svelte.js', () => ({
  loadRelationTypes: () => Promise.resolve(),
  relatableTypes: () => [],
  relationAction: () => 'relation',
  saveRelation: vi.fn(),
}));
vi.mock('../lib/navigate.js', () => ({
  openEntity: () => {},
  opensInFileManager: () => false,
  showInFolder: () => {},
  gotoCapture: () => {},
  gotoPoint: () => {},
  ENTITY_TOOL: {},
}));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'pin' }));
vi.mock('../lib/filing.js', () => ({ assignFolder: vi.fn() }));
vi.mock('../lib/poll.js', () => ({ pollWhile: () => () => {} }));
vi.mock('../lib/trash.js', () => ({
  deletedToast: () => {},
  FILE_BACKED: new Set(['media']),
  RESTORABLE: [],
}));

const { default: EntityDetails } = await import('./EntityDetails.svelte');
// The same module instance the mocks hand the panel, so a test can change what the
// entity and its file are between mounts.
const { entity, mediaItem } = await import('./details.fixture.svelte.js');

let live = null;

async function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(EntityDetails, {
    target,
    props: { entityId: 'e1', onclose: () => {}, ...props },
  });
  flushSync();
  for (let i = 0; i < 5; i += 1) await Promise.resolve(); // the chain read lands
  flushSync();
  return target;
}

/** Let the held-open vocabulary request resolve, with the panel already on screen. */
async function land() {
  landRegistry(REGISTRY);
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
  flushSync();
}

const valueOf = (target, key) => target.querySelector(`#attr-${key}`)?.value ?? null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
});

describe('EntityDetails coordinates', () => {
  it('says where a point is, from the pair rather than the string a tool wrote', async () => {
    // The fixture place holds `lat`/`lon` and no `coords`, which is what a sheet
    // promotion mints: the row used to be keyed on the string, so a promoted place
    // showed no coordinate anywhere in the panel.
    const target = await open();
    const row = [...target.querySelectorAll('.info-row')].find(
      (el) => el.querySelector('.info-k')?.textContent === 'Coords'
    );
    expect(row?.textContent).toContain('1.000000, 2.000000');
  });
});

describe('EntityDetails field seeding', () => {
  it('carries the stored values when the registry lands after the panel opened', async () => {
    let dirty = false;
    const target = await open({
      get dirty() {
        return dirty;
      },
      set dirty(value) {
        dirty = value;
      },
    });
    expect(target.querySelector('#attr-radius_m')).toBe(null); // nothing declared yet

    await land();

    expect(valueOf(target, 'radius_m')).toBe('500');
    expect(valueOf(target, 'method')).toBe('roofline match');
    // The values came off the entity, so nothing is unsaved. A panel that asked
    // "discard changes?" on close here would be inventing an edit.
    expect(dirty).toBe(false);
  });
});

describe('the source of a file the analyst brought in', () => {
  const PLACE = { ...entity, attrs: { ...entity.attrs } };

  function asMedia(id, source) {
    Object.assign(entity, {
      id,
      type: 'media',
      label: 'shot',
      attrs: { path: 'media/shot.png' },
    });
    mediaItem.source = source;
  }

  afterEach(() => {
    Object.assign(entity, PLACE, { attrs: { ...PLACE.attrs } });
    mediaItem.source = { type: 'upload', original_name: 'shot.png' };
    patch.mockClear();
  });

  it('is a field to type into, seeded with what the sidecar holds', async () => {
    asMedia('m1', { type: 'upload', original_name: 'shot.png', url: 'https://t.me/c/42' });
    const target = await open({ entityId: 'm1' });
    expect(target.querySelector('#ed-source')?.value).toBe('https://t.me/c/42');
    // and not repeated as a fact above: one Source on screen, the one that can be edited
    const rows = [...target.querySelectorAll('.info-row .info-k')].map((el) => el.textContent);
    expect(rows).not.toContain('Source');
  });

  it('is saved through the media route, beside the title and the notes', async () => {
    asMedia('m2', { type: 'upload', original_name: 'shot.png' });
    const target = await open({ entityId: 'm2' });
    const field = target.querySelector('#ed-source');
    field.value = 'https://example.org/post/7';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save').click();
    await Promise.resolve();
    expect(patch).toHaveBeenCalledWith(
      '/api/cases/c1/media',
      expect.objectContaining({ source_url: 'https://example.org/post/7' })
    );
  });

  it('refuses to save an origin that is not an address', async () => {
    asMedia('m3', { type: 'upload', original_name: 'shot.png' });
    const target = await open({ entityId: 'm3' });
    const field = target.querySelector('#ed-source');
    field.value = 'a friend sent it';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    const save = [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Save');
    expect(save.disabled).toBe(true);
    expect(target.textContent).toContain('The source must be an http(s) address.');
  });

  it('is never offered for what a tool fetched — that address is a fact', async () => {
    asMedia('m4', {
      type: 'download',
      url: 'https://x.com/user/status/1',
      webpage_url: 'https://x.com/user/status/1',
    });
    const target = await open({ entityId: 'm4' });
    expect(target.querySelector('#ed-source')).toBe(null);
    const rows = [...target.querySelectorAll('.info-row .info-k')].map((el) => el.textContent);
    expect(rows).toContain('Source');
  });
});
