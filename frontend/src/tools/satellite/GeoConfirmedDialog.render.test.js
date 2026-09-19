// @vitest-environment happy-dom
/**
 * The GeoConfirmed dialog: one conflict, a window, and optionally the view.
 *
 * Opening it is the act that asks GeoConfirmed for anything, so what is asserted
 * first is that the list is asked for once, here, and that a failure to reach it
 * says so and can be tried again rather than leaving an empty menu.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import GeoConfirmedDialog from './GeoConfirmedDialog.svelte';

const CONFLICTS = [
  { conflict: 'World', name: 'World', start: '2023-01-01', end: '' },
  { conflict: 'Ukraine', name: 'Ukraine', start: '2013-01-01', end: '' },
  { conflict: 'Israel', name: 'Israel/Gaza/Lebanon', start: '2023-10-07', end: '' },
];

let held = null;

async function show(props = {}) {
  held = mount(GeoConfirmedDialog, {
    target: document.body,
    props: {
      busy: false,
      load: vi.fn(async () => CONFLICTS),
      view: () => ({ west: 30, south: 44, east: 40, north: 52 }),
      ...props,
    },
  });
  await tick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
  return document.body;
}

afterEach(() => {
  if (held) unmount(held);
  held = null;
  document.body.innerHTML = '';
});

const button = (label) =>
  [...document.body.querySelectorAll('button')].find(
    (node) => node.textContent.trim() === label
  );
const select = () => document.body.querySelector('select');

describe('the GeoConfirmed dialog', () => {
  it('asks for the conflict list once, on opening, and opens on Ukraine', async () => {
    const load = vi.fn(async () => CONFLICTS);
    await show({ load });

    expect(load).toHaveBeenCalledOnce();
    expect([...select().options].map((option) => option.textContent)).toEqual([
      'World',
      'Ukraine',
      'Israel/Gaza/Lebanon',
    ]);
    expect(select().value).toBe('Ukraine');
  });

  it('adds the last thirty days of the whole conflict by default', async () => {
    const onadd = vi.fn();
    await show({ onadd });

    button('Add').click();

    expect(onadd).toHaveBeenCalledWith({ conflict: 'Ukraine', days: 30 });
  });

  it('sends the chosen window and the view when asked to keep to it', async () => {
    const onadd = vi.fn();
    await show({ onadd });

    button('7 days').click();
    const box = document.body.querySelector('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();
    button('Add').click();

    expect(onadd).toHaveBeenCalledWith({ conflict: 'Ukraine', days: 7, area: [30, 44, 40, 52] });
  });

  it('asks for the whole history, and says it is read again only on Refresh', async () => {
    const onadd = vi.fn();
    await show({ onadd });

    button('All history').click();
    flushSync();

    expect(document.body.textContent).not.toContain('switch it on');
    button('Add').click();
    expect(onadd).toHaveBeenCalledWith({ conflict: 'Ukraine', everything: true });
  });

  it('holds Add back on a range with no first day yet', async () => {
    await show();

    button('Dates…').click();
    flushSync();

    expect(button('Add').disabled).toBe(true);
  });

  it('says why a view across the antimeridian cannot be sent', async () => {
    await show({ view: () => ({ west: 170, south: 0, east: -170, north: 10 }) });

    const box = document.body.querySelector('input[type="checkbox"]');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    flushSync();

    expect(document.body.textContent).toContain('crosses the antimeridian');
    expect(button('Add').disabled).toBe(true);
  });

  it('says GeoConfirmed could not be reached, and tries again on request', async () => {
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error('could not reach that source: offline'))
      .mockResolvedValueOnce(CONFLICTS);
    await show({ load });

    expect(document.body.textContent).toContain('could not reach that source');
    button('Try again').click();
    await new Promise((resolve) => setTimeout(resolve, 0));
    flushSync();

    expect(load).toHaveBeenCalledTimes(2);
    expect(select().value).toBe('Ukraine');
  });
});
