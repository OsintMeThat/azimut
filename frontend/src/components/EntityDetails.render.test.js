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

vi.mock('../lib/api.js', async () => {
  // The panel reads its entity off the bounded chain endpoint, never off the case.
  const { entity } = await import('./details.fixture.svelte.js');
  const chain = { entity, sources: [], lost: [], dependents: [], relations: [], empty: true };
  return {
    api: {
      get: (url) => (url.includes('entity-types') ? registryLanded : Promise.resolve(chain)),
      patch: vi.fn(),
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
vi.mock('../lib/trash.js', () => ({ deletedToast: () => {}, RESTORABLE: [] }));

const { default: EntityDetails } = await import('./EntityDetails.svelte');

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
