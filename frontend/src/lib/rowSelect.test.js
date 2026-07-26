import { describe, expect, it } from 'vitest';
import { dragPayload, rangeSelected, toggleSelected } from './rowSelect.js';

const rows = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = rows.map((r) => r.id);

describe('toggleSelected', () => {
  it('adds then removes, without touching the previous set', () => {
    const first = toggleSelected(new Set(), 'b');
    expect([...first]).toEqual(['b']);
    const second = toggleSelected(first, 'c');
    expect([...second]).toEqual(['b', 'c']);
    expect([...toggleSelected(second, 'b')]).toEqual(['c']);
    expect([...first]).toEqual(['b']); // untouched
  });
});

describe('rangeSelected', () => {
  it('takes the run between the anchor and the clicked row, either way round', () => {
    expect([...rangeSelected(ids, 'b', 'd')]).toEqual(['b', 'c', 'd']);
    expect([...rangeSelected(ids, 'd', 'b')]).toEqual(['b', 'c', 'd']);
    expect([...rangeSelected(ids, 'c', 'c')]).toEqual(['c']);
  });

  it('selects the clicked row alone when the anchor is no longer displayed', () => {
    expect([...rangeSelected(ids, 'gone', 'c')]).toEqual(['c']);
  });
});

describe('dragPayload', () => {
  it('carries the whole selection when the dragged row belongs to it', () => {
    const selected = new Set(['a', 'c']);
    expect(dragPayload(rows, selected, { id: 'c' }).map((r) => r.id)).toEqual(['a', 'c']);
  });

  it('carries the dragged row alone when it is outside the selection', () => {
    const selected = new Set(['a', 'c']);
    expect(dragPayload(rows, selected, { id: 'd' }).map((r) => r.id)).toEqual(['d']);
  });

  it('keeps display order, not click order', () => {
    const selected = new Set(['d', 'a']);
    expect(dragPayload(rows, selected, { id: 'a' }).map((r) => r.id)).toEqual(['a', 'd']);
  });
});
