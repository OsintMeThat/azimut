// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { buildSeries } from '../../lib/map/detectSeries.js';
import SeriesSpots from './SeriesSpots.svelte';
import { liveProps } from './props.fixture.svelte.js';

// 130 things seen once each, a kilometre apart: 130 spots
const rows = [{ id: 'r1', title: 'Base', dates: ['2026-07-24', '2026-09-27'],
  areas: [{ area_id: 'apron', status: 'ready', b: '2026-09-27' }],
  results: Array.from({ length: 130 }, (_, i) => ({ id: `c${i}`, area_id: 'apron', review: 'new', coordinates: [54 + i * 0.01, 24] })) }];

let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); });

function open(extra = {}) {
  const props = liveProps({ series: buildSeries(rows), selected: null, onverdict: vi.fn(), onopen: vi.fn(), onselect: vi.fn(), ...extra });
  target = document.createElement('div');
  document.body.append(target);
  live = mount(SeriesSpots, { target, props });
  flushSync();
  return props;
}
const rowsDrawn = () => target.querySelectorAll('.spot-row').length;

it('draws a long list a page at a time', () => {
  open();
  expect(rowsDrawn()).toBe(60);
  const more = [...target.querySelectorAll('button')].find((b) => b.textContent.includes('more of'));
  expect(more.textContent.trim()).toBe('Show 60 more of 70');
  more.click(); flushSync();
  expect(rowsDrawn()).toBe(120);
});

it('brings in the page of a spot picked on the map', () => {
  const props = open();
  props.selected = 'S125'; flushSync();
  expect(rowsDrawn()).toBe(130);
  expect(target.querySelector('.spot-row.on').textContent).toContain('S125');
});

it('judges every spot a filter shows in one press', () => {
  const props = open();
  [...target.querySelectorAll('button')].find((b) => b.textContent.trim().startsWith('Keep these')).click();
  expect(props.onverdict).toHaveBeenCalledWith(expect.any(Array), 'noted');
  expect(props.onverdict.mock.calls[0][0]).toHaveLength(130);
});
