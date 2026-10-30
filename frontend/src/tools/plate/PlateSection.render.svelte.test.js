// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createRawSnippet, flushSync, mount, unmount } from 'svelte';
import PlateSection from './PlateSection.svelte';
import { layout } from '../../lib/plate/layout.svelte.js';

let held = [];
beforeEach(() => { localStorage.clear(); layout.folded = []; });
afterEach(() => { for (const one of held) unmount(one); held = []; document.body.innerHTML = ''; });

const body = (text) => createRawSnippet(() => ({ render: () => `<p class="inside">${text}</p>` }));
function show(title, summary = '') {
  held.push(mount(PlateSection, { target: document.body, props: { title, summary, children: body(title) } }));
  flushSync();
}
const heads = () => [...document.body.querySelectorAll('h4 button')];

describe('a section of the plate inspector', () => {
  it('folds by its title, says what it holds once folded, and opens again', () => {
    show('Grid', 'UTM');
    const head = heads()[0];
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('.inside')).not.toBeNull();
    expect(document.body.textContent).not.toContain('UTM');
    head.click();
    flushSync();
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('.inside')).toBeNull();
    expect(head.textContent).toContain('UTM');
    head.click();
    flushSync();
    expect(document.body.querySelector('.inside')).not.toBeNull();
  });

  it('folds every section of that title at once, and remembers it', () => {
    show('Layers');
    show('Layers');
    show('Words');
    heads()[0].click();
    flushSync();
    expect(heads().map((head) => head.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'true']);
    expect(JSON.parse(localStorage.getItem('azimut:plateLayout')).folded).toEqual(['Layers']);
  });
});
