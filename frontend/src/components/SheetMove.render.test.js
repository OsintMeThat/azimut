// @vitest-environment happy-dom
/**
 * The two screens a row crosses on its way to another sheet, actually mounted.
 *
 * Both exist because the one-press version was a trap. The lot is whatever the grid was
 * holding — and a drag down a column is forty rows nobody counted — so the first screen
 * **lists them and lets them be taken back out**. The columns were matched on their names
 * alone, so a heading spelled differently at the other end was a loss the analyst read
 * about in the toast, after the rows had left; so the second screen **lines them up** and
 * says what stays behind before there is a button to press.
 *
 * What these drive is the half a lib suite cannot: that the press is only reachable
 * through the screen that said what it would do.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: SheetMove } = await import('./SheetMove.svelte');

const SHEETS = [
  { id: 's1', title: 'Inbox', rows: 40, columns: 4, headings: ['id', 'Adresse', 'Statut', 'Note'] },
  { id: 's2', title: 'Worklist', rows: 3, columns: 3, headings: ['id', 'Adresse', 'note'] },
];
const ROWS = [
  { key: 'r1', label: 'Quai sud', colour: 'green' },
  { key: 'r2', label: 'Pont nord', colour: null },
];

let live = null;
const onmove = vi.fn();

function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(SheetMove, {
    target,
    props: {
      sheets: SHEETS,
      sheetId: 's1',
      columns: ['id', 'Adresse', 'Statut', 'Note'],
      rows: ROWS,
      scope: 'selected',
      onmove,
      onclose: vi.fn(),
      ...props,
    },
  });
  flushSync();
  return target;
}

const press = (target, text) => {
  const found = [...target.querySelectorAll('button')].find((node) =>
    node.textContent.trim().startsWith(text),
  );
  found.click();
  flushSync();
};

afterEach(() => {
  if (live) unmount(live);
  live = null;
  onmove.mockReset();
  document.body.innerHTML = '';
});

describe('the rows a move is about to take', () => {
  it('says which of the two selections it is holding', () => {
    // "40 rows" that turn out to be the wrong forty is the one thing this must not do.
    expect(open().textContent).toContain('2 selected rows');
    unmount(live);
    live = null;
    expect(open({ scope: 'ticked' }).textContent).toContain('2 ticked rows');
  });

  it('lists them, and a row taken back out stops counting', () => {
    const target = open();
    press(target, 'Review');

    const boxes = [...target.querySelectorAll('input[type="checkbox"]')];
    expect(target.textContent).toContain('Quai sud');
    expect(boxes).toHaveLength(2);

    boxes[1].click();
    flushSync();
    expect(target.textContent).toContain('1 selected row');
    expect(target.textContent).toContain('1 kept back');
  });

  it('offers no press until the second screen has been read', () => {
    const target = open();
    const labels = [...target.querySelectorAll('button')].map((node) => node.textContent.trim());

    expect(labels).toContain('Next');
    expect(labels.some((label) => label.startsWith('Move'))).toBe(false);
  });

  it('has nothing to offer when the case holds one sheet', () => {
    const target = open({ sheets: [SHEETS[0]] });

    expect(target.textContent).toContain('no other sheet');
    expect([...target.querySelectorAll('select')]).toHaveLength(0);
  });
});

describe('lining the columns up', () => {
  function second(props = {}) {
    const target = open(props);
    press(target, 'Next');
    return target;
  }

  it('proposes the exact name, guesses the one spelled differently, and says which', () => {
    const target = second();
    const [adresse, statut, note] = [...target.querySelectorAll('select')];

    expect(adresse.value).toBe('Adresse');
    expect(statut.value).toBe(''); // that sheet has nothing for it
    expect(note.value).toBe('note');
    expect(target.textContent).toContain('guessed');
    expect(target.textContent).toContain('2 columns move, 1 stays behind');
  });

  it('hands back what was pointed where, and only the rows still in the lot', () => {
    const target = second();
    press(target, 'Move 2 rows');

    expect(onmove).toHaveBeenCalledWith('s2', ['r1', 'r2'], { Adresse: 'Adresse', Note: 'note' });
  });

  it('lets a column be pointed somewhere else, and frees the one it left', () => {
    const target = second();
    const [adresse, statut] = [...target.querySelectorAll('select')];

    // Two columns cannot both land in `Adresse`: the first one lets go of it.
    statut.value = 'Adresse';
    statut.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(adresse.value).toBe('');

    press(target, 'Move 2 rows');
    expect(onmove).toHaveBeenCalledWith('s2', ['r1', 'r2'], { Statut: 'Adresse', Note: 'note' });
  });

  it('sends nothing for a column set back to “Don’t move”', () => {
    const target = second();
    const note = [...target.querySelectorAll('select')].at(-1);

    note.value = '';
    note.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    expect(target.textContent).toContain('1 column moves, 2 stay behind');
    expect(target.textContent).toContain('Left empty over there: note');

    press(target, 'Move 2 rows');
    expect(onmove).toHaveBeenCalledWith('s2', ['r1', 'r2'], { Adresse: 'Adresse' });
  });

  it('goes back to the rows with the lot as it was left', () => {
    const target = open();
    press(target, 'Review');
    target.querySelectorAll('input[type="checkbox"]')[0].click();
    flushSync();
    press(target, 'Next');
    press(target, 'Back');

    expect(target.textContent).toContain('1 selected row');
    press(target, 'Next');
    press(target, 'Move 1 row');
    expect(onmove).toHaveBeenCalledWith('s2', ['r2'], { Adresse: 'Adresse', Note: 'note' });
  });
});
