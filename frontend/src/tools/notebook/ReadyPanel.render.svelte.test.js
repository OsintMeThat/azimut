// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { readReady } from '../../lib/notes/readyPanel.js';

const { default: ReadyPanel } = await import('./ReadyPanel.svelte');

/**
 * The Ready to publish? panel, mounted: its groups in order, the count it says, an
 * empty group said as such, and every press handed up to the Notebook, which does the
 * fix with the action it already has.
 */

const ANSWER = readReady({
  note: 'n1', title: 'Lead', internal: 0, weight: 2_000_000, links: [], pov: [],
  warnings: [
    { text: '2 counts read as exact: "12 trucks", "7 boats". Say "at least" or give a range.', line: 2, kind: 'count', group: 'words',
      items: [{ text: '12 trucks', url: '', line: 2 }, { text: '7 boats', url: '', line: 6 }] },
    { text: '3 outside links have no archived copy.', line: 2, kind: 'unarchived', group: 'sources',
      items: [{ text: 'A', url: 'https://a.example.org', line: 2 }] },
  ],
  ready: { format: 'html', edition: 'internal', style: 'report', tlp: '', pictures: [], claims: [], gone: [], unarchived: [], unseen: [] },
}, 'html');

let target;
let app;

function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  app = mount(ReadyPanel, { target, props: { title: 'Lead', ready: ANSWER, canEdit: true, ...props } });
  flushSync();
  return document.querySelector('[role="dialog"]');
}

afterEach(() => {
  if (app) unmount(app);
  app = null;
  target?.remove();
  document.body.innerHTML = '';
});

describe('the Ready to publish? panel', () => {
  it('lists the groups in a reader’s order, says how many lines are to look at, and says an empty group is clear', () => {
    const dialog = open();
    expect([...dialog.querySelectorAll('.group-head')].map((node) => node.firstChild.textContent.trim()))
      .toEqual(['Words', 'Sources', 'Figures', 'Edition', 'Weight and reach']);
    expect(dialog.querySelector('[role="status"]').textContent).toContain('3 to look at.');
    expect(dialog.querySelector('[data-group="figures"]').textContent).toContain('Nothing to look at.');
    expect(dialog.querySelector('[data-group="reach"]').textContent).toContain('About 1.9 MB');
  });

  it('hands every fix and every Go to up, and holds the others while one is under way', () => {
    const onfix = vi.fn();
    const ongo = vi.fn();
    const dialog = open({ onfix, ongo });
    const words = dialog.querySelector('[aria-label="Words"]');
    const [first] = words.querySelectorAll('li');
    [...first.querySelectorAll('button')].find((button) => button.textContent.includes('Say “at least”')).click();
    expect(onfix).toHaveBeenCalledWith(expect.objectContaining({ fix: expect.objectContaining({ id: 'atleast', phrase: '12 trucks' }), line: 2 }));
    [...first.querySelectorAll('button')].find((button) => button.textContent === 'Go to').click();
    expect(ongo).toHaveBeenCalledWith(expect.objectContaining({ line: 2, kind: 'count' }));
    const archive = [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Archive every link…'));
    archive.click();
    expect(onfix).toHaveBeenLastCalledWith(expect.objectContaining({ fix: expect.objectContaining({ id: 'archive' }) }));
    unmount(app);
    document.body.innerHTML = '';
    const busy = open({ busy: 'w0-0' });
    const fixes = [...busy.querySelectorAll('button.fix')];
    expect(fixes.every((button) => button.disabled)).toBe(true);
    expect(fixes[0].textContent.trim()).toBe('Working…');
  });

  it('goes back to the export it came from, or on to one', () => {
    const onclose = vi.fn();
    const onexport = vi.fn();
    let dialog = open({ fromExport: true, onclose });
    [...dialog.querySelectorAll('button')].find((button) => button.textContent === 'Back to the export').click();
    expect(onclose).toHaveBeenCalledOnce();
    unmount(app);
    document.body.innerHTML = '';
    dialog = open({ onexport });
    [...dialog.querySelectorAll('button')].find((button) => button.textContent.includes('Export…')).click();
    expect(onexport).toHaveBeenCalledOnce();
  });

  it('in the extension\'s panel, opens the note in Azimut to export it, and offers only the fixes it can do there', () => {
    const onexport = vi.fn();
    const ready = readReady({
      note: 'n1', title: 'Lead', internal: 0, links: [], pov: [{ text: 'Quay', line: 4 }],
      warnings: [{ text: '1 count reads as exact: "12 trucks".', line: 2, kind: 'count', group: 'words', items: [{ text: '12 trucks', url: '', line: 2 }] }],
      ready: { format: 'pdf', edition: 'internal', claims: [{ text: 'Seized at dawn', id: 'c1', line: 6 }], pictures: [], gone: [], unarchived: [], unseen: [] },
    });
    const dialog = open({ ready, tools: false, onexport });
    const pressable = () => [...dialog.querySelectorAll('button')].map((button) => button.textContent.trim());
    // the count is written as in the Notebook; Round them is the export's, Open the claim is Details'
    expect(pressable()).toContain('Say “at least”');
    expect(pressable()).not.toContain('Round them');
    expect(pressable()).not.toContain('Open the claim');
    // each line keeps its Go to, and the three still count
    expect(dialog.querySelectorAll('[data-kind="pov"], [data-kind="claim"]')).toHaveLength(2);
    expect(dialog.querySelector('[role="status"]').textContent).toContain('3 to look at.');
    expect(pressable()).not.toContain('Export…');
    const azimut = [...dialog.querySelectorAll('button')].find((button) => button.textContent.trim() === 'Open in Azimut');
    expect(azimut.title).toBe('Open this note in Azimut, in a tab, to export it');
    azimut.click();
    expect(onexport).toHaveBeenCalledOnce();
  });
});
