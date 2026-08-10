// @vitest-environment happy-dom
/**
 * The list actually mounted, for the one thing reading the source cannot answer:
 * whether a pointer ends up under its own heading or inline among the findings.
 *
 * Its sibling suite checks the wiring. This one checks what an analyst sees — the
 * complaint that started it was "relations and mentions are mixed together", which
 * is a question about rendered order, not about which function was called.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const GROUPS = { mentions: 'Mentions' };
const VERBS = { 'located-at': 'was recorded at', mentions: 'mentions', depicts: 'shows' };

vi.mock('../lib/relations.svelte.js', () => ({
  confidenceHint: () => '',
  confidenceLabel: () => '',
  confidenceLevels: () => [],
  isCurrentConnection: () => true,
  isRatable: () => true,
  loadRelationTypes: () => Promise.resolve(),
  relationAction: (type) => (type === 'mentions' ? 'mention' : 'relation'),
  relationGroup: (type) => GROUPS[type] ?? '',
  relationHint: () => '',
  relationOptions: () => [],
  // Only the tie verb declares one, which is the whole point of the field belonging
  // to the verb: every other row renders without it.
  relationQualifier: (type) => (type === 'associated-with' ? 'How they are tied' : ''),
  relationReading: (type) => VERBS[type] ?? type,
  relationVerb: (type) => VERBS[type] ?? type,
}));
vi.mock('../lib/entityTypes.svelte.js', () => ({
  loadEntityTypes: () => Promise.resolve(),
  reliabilityOf: () => null,
}));
vi.mock('../lib/entityIcon.js', () => ({ entityIcon: () => 'note' }));
vi.mock('../lib/navigate.js', () => ({ openEntity: () => {} }));
vi.mock('../lib/state.svelte.js', () => ({ toast: () => {} }));
vi.mock('../lib/api.js', () => ({ api: { patch: vi.fn(), del: vi.fn() } }));

const { default: RelationList } = await import('./RelationList.svelte');

/** One row, confirmed, so nothing sorts ahead of it for needing review. */
const row = (id, type, label) => ({
  link: { id, type, provenance: { status: 'confirmed' } },
  entity: { id: `e${id}`, type: 'place', label, attrs: {} },
  direction: 'out',
});

let live = null;

function open(relations, extra = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(RelationList, {
    target,
    props: { caseId: 'c1', relations, onchanged: () => {}, ...extra },
  });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

/** Every heading and every row name, in the order they are painted. */
const reading = (root) =>
  [...root.querySelectorAll('.group, .relation .name')].map((el) => el.textContent.trim());

describe('a pointer is not shown as a finding', () => {
  it('heads the mentions apart and leaves the rest of the list unheaded', () => {
    const root = open([
      row('1', 'located-at', 'North quay'),
      row('2', 'mentions', 'The sawmill'),
      row('3', 'depicts', 'Far ridge'),
    ]);

    expect(reading(root)).toEqual(['North quay', 'Far ridge', 'Mentions', 'The sawmill']);
  });

  it('draws no heading at all when every verb belongs with the others', () => {
    const root = open([row('1', 'located-at', 'North quay'), row('2', 'depicts', 'Far ridge')]);

    expect(root.querySelectorAll('.group')).toHaveLength(0);
    expect(reading(root)).toEqual(['North quay', 'Far ridge']);
  });

  it('heads them even when the list holds nothing else', () => {
    const root = open([row('1', 'mentions', 'The sawmill')]);

    expect(reading(root)).toEqual(['Mentions', 'The sawmill']);
    expect(root.querySelector('.mention .says').textContent).toContain('mentions');
    expect(root.querySelector('.mention .rate')).toBeNull();
  });

  it('puts what needs a decision first inside its own section', () => {
    // the split wins over review order across sections — a heading the analyst can
    // read is not a hiding place — and review order still decides inside each one
    const pending = row('2', 'mentions', 'The sawmill');
    pending.link.provenance.status = 'suggested';
    const root = open([
      row('1', 'located-at', 'North quay'),
      row('3', 'mentions', 'Old crane'),
      pending,
    ]);

    expect(reading(root)).toEqual(['North quay', 'Mentions', 'The sawmill', 'Old crane']);
  });

  it('says the word once when the host already named the section', () => {
    // Details draws its own "Mentions" heading above this list and asks for that
    // action alone; the list heading it again read as two lists
    const root = open([row('2', 'mentions', 'The sawmill')], { actionFilter: 'mention' });

    expect(root.querySelectorAll('.group')).toHaveLength(0);
    expect(reading(root)).toEqual(['The sawmill']);
  });

  it('counts a hidden row once, whichever section it would have landed in', () => {
    const root = open(
      [
        row('1', 'located-at', 'North quay'),
        row('2', 'mentions', 'The sawmill'),
        row('3', 'depicts', 'Far ridge'),
      ],
      { max: 2 }
    );

    expect(root.querySelector('.more').textContent.trim()).toBe('+ 1 more');
    // the cap counts rows, not sections: two rows survive it and one of them heads
    expect(reading(root)).toEqual(['North quay', 'Mentions', 'The sawmill']);
  });
});

describe('what kind of tie, where the verb cannot say it', () => {
  it('draws the field on the verb that declares one, and on no other row', () => {
    // Declared by the verb, never by the edge: a note every relation could hold
    // would leave nothing saying what a relation *is*.
    const root = open([row('l1', 'associated-with', 'Second'), row('l2', 'owns', 'A lorry')]);
    const fields = [...root.querySelectorAll('.nature')];
    expect(fields).toHaveLength(1);
    expect(fields[0].placeholder).toBe('How they are tied');
  });

  it('shows the word already stated rather than an empty box', () => {
    const stated = row('l1', 'associated-with', 'Second');
    stated.link.nature = 'sister';
    const root = open([stated]);
    expect(root.querySelector('.nature').value).toBe('sister');
    expect(root.querySelector('.nature').classList.contains('set')).toBe(true);
  });

  it('offers nothing to qualify on a proposal, which is reviewed before it is read', () => {
    const proposed = row('l1', 'associated-with', 'Second');
    proposed.link.provenance = { status: 'suggested' };
    expect(open([proposed]).querySelector('.nature')).toBeNull();
  });
});
