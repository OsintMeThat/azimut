// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

/**
 * The links behind a line of the check before export: folded to a few words, opened
 * to every link with its site, each taking the note to its line.
 */

const { default: LinkList } = await import('./LinkList.svelte');

const ITEMS = [
  { text: 'Al Jazeera, 10 Sep', url: 'https://www.aljazeera.com/news/2026/9/10/a', line: 12 },
  { text: 'BBC, 5 Oct', url: 'https://www.bbc.com/news/articles/c1', line: 30 },
  { text: 'ISW', url: 'https://understandingwar.org/x', line: null },
  { text: 'Mereja, 10 Oct', url: 'https://mereja.com/b', line: 44 },
];

let component;
let target;

function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  component = mount(LinkList, { target, props: { items: ITEMS, label: '4 outside links have no archived copy.', ...props } });
  flushSync();
  return target.querySelector('details');
}

afterEach(async () => {
  if (component) await unmount(component);
  component = null;
  target?.remove();
});

describe('the folded links', () => {
  it('says the first three and how many more, folded until asked', () => {
    const details = show();
    expect(details.open).toBe(false);
    expect(details.querySelector('summary').textContent).toContain('“Al Jazeera, 10 Sep” · “BBC, 5 Oct” · “ISW” and 1 more');
    const list = details.querySelector('ul');
    expect(list.getAttribute('aria-label')).toBe('4 outside links have no archived copy.');
    expect([...list.querySelectorAll('li')].map((row) => row.querySelector('.host').textContent))
      .toEqual(['aljazeera.com', 'bbc.com', 'understandingwar.org', 'mereja.com']);
  });

  it('takes the note to a link, and offers nothing for one with no line', () => {
    const ongo = vi.fn();
    const details = show({ ongo });
    const rows = [...details.querySelectorAll('li')];
    expect(rows.map((row) => Boolean(row.querySelector('button')))).toEqual([true, true, false, true]);
    rows[1].querySelector('button').click();
    expect(ongo).toHaveBeenCalledWith(30);
  });
});
