// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/** Add an event from wherever the analyst is, with what the tool is looking at. */

const chains = {};
const get = vi.fn(async (url) => chains[url.split('/entities/')[1]?.split('/')[0]] ?? { relations: [] });
vi.mock('../lib/api.js', () => ({ api: { get, post: vi.fn() } }));

const seatedWith = [];
vi.mock('./EntryLine.svelte', async () => {
  const { default: Stub } = await import('./NoteBarLine.fixture.svelte');
  return {
    default: Stub,
    claimSeat: (entity) =>
      entity ? { slot: { media: 'cites', place: 'at' }[entity.type] ?? 'about' } : null,
  };
});

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { offerNote, withdrawNote } = await import('../lib/noteHere.svelte.js');
const { default: NoteBar } = await import('./NoteBar.svelte');

let live = null;

async function settle() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
  flushSync();
}

async function show() {
  live = mount(NoteBar, { target: document.body });
  flushSync();
  await settle();
}

const bar = () => document.querySelector('.note-bar');

beforeEach(() => {
  caseState.current = { id: 'case-a', name: 'Case', entities: [], links: [], folders: [] };
  uiState.tool = 'media';
  uiState.noting = false;
  seatedWith.length = 0;
  globalThis.__noteBarLine = seatedWith;
  withdrawNote('media');
  withdrawNote('satellite');
});

afterEach(() => {
  if (live) unmount(live);
  live = null;
});

describe('the Add event bar', () => {
  it('shows nothing until it is asked for', async () => {
    await show();
    expect(bar()).toBeNull();
  });

  it('opens on the tool’s own selection, with the date left to the analyst', async () => {
    offerNote('media', { id: 'm1', label: 'VID_0312', type: 'media', attrs: {} });
    uiState.noting = true;
    await show();
    expect(bar().querySelector('header').textContent).toContain('seen in VID_0312');
    expect(seatedWith.at(-1)).toMatchObject({ entity: { id: 'm1' }, also: [] });
  });

  it('seats a file’s one confirmed place beside it', async () => {
    chains.m1 = {
      relations: [{
        direction: 'out',
        link: { type: 'located-at', provenance: { status: 'confirmed' } },
        entity: { id: 'p1', type: 'place', label: 'Crossroads', attrs: {}, provenance: { status: 'confirmed' } },
      }],
    };
    offerNote('media', { id: 'm1', label: 'VID_0312', type: 'media', attrs: {} });
    uiState.noting = true;
    await show();
    await settle();
    expect(seatedWith.at(-1).also).toEqual([
      { id: 'p1', label: 'Crossroads', type: 'place', attrs: {}, slot: 'at' },
    ]);
    delete chains.m1;
  });

  it('never seats what another tool holds', async () => {
    offerNote('satellite', { id: 'p1', label: 'Crossroads', type: 'place', attrs: {} });
    uiState.noting = true;
    await show();
    expect(bar().querySelector('header .about')).toBeNull();
    expect(seatedWith.at(-1).entity).toBeNull();
  });

  it('closes on Escape, and when the analyst moves to another tool', async () => {
    uiState.noting = true;
    await show();
    bar().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    flushSync();
    expect(uiState.noting).toBe(false);

    uiState.noting = true;
    flushSync();
    uiState.tool = 'satellite';
    flushSync();
    await settle();
    expect(uiState.noting).toBe(false);
  });
});
