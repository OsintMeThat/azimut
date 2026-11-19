// @vitest-environment happy-dom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flushSync, mount, unmount } from 'svelte';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { contrast, over, parseColour } from '../contrast.fixture.js';
import { noteExtensions } from './liveMarkdown.js';
import { normaliseLook } from './look.js';

/**
 * The quiet controls of the note's editor and the Notebook (each ⋯, ▾, ⋮⋮, + and button
 * drawn as an icon alone) stand out at least 3:1 from what they sit on, WCAG's floor for
 * a control (1.4.11), in the dark theme and the light one. A note card's ⋯ and a table
 * column's ▾ were drawn in the hint grey, the ▾ at 70 % on top of it, and read as nothing.
 *
 * The colours are the ones the page computes: the app's style sheet, the editor's themes
 * and the components' own styles, each control found where it is drawn, the background
 * it sits on read up its ancestors (the canvas behind the page when none has one). A row
 * that lights up under the pointer is held to the lit colour too.
 */

const here = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(here, path), 'utf8');
/** A component's own styles, as the page has them once Svelte has scoped them. */
const componentStyles = (path) => {
  const source = read(path);
  return source.slice(source.indexOf('<style>') + 7, source.indexOf('</style>')).replace(/:global\(([^()]*(?:\([^()]*\))?[^()]*)\)/g, '$1');
};
const STYLES = [
  read('../../app.css'),
  componentStyles('../../components/FloatingMenu.svelte'),
  componentStyles('../../tools/notebook/NotesHome.svelte'),
  componentStyles('../../tools/notebook/LookControl.svelte'),
  componentStyles('../../tools/notebook/InfographicBuilder.svelte'),
];
/** What the page itself is drawn on: the Notebook's canvas, and a docked note's panel. */
const CANVASES = ['--bg-0', '--bg-1'];
const FLOOR = 3;

const token = (name) => parseColour(getComputedStyle(document.documentElement).getPropertyValue(name));

/** The opaque colour `node` is drawn on: its own background, else its ancestors', else `canvas`. */
function ground(node, canvas) {
  const layers = [];
  for (let at = node; at && at.nodeType === 1; at = at.parentElement) {
    const colour = parseColour(getComputedStyle(at).backgroundColor);
    if (colour && colour.a > 0) {
      layers.push(colour);
      if (colour.a >= 1) break;
    }
  }
  let base = layers.at(-1)?.a >= 1 ? layers.pop() : token(canvas);
  for (const layer of layers.reverse()) base = over(layer, base);
  return base;
}

/** How opaque `node` is drawn, its ancestors' opacity included. */
function opacity(node) {
  let value = 1;
  for (let at = node; at && at.nodeType === 1; at = at.parentElement) {
    const own = Number.parseFloat(getComputedStyle(at).opacity);
    if (Number.isFinite(own)) value *= own;
  }
  return value;
}

/** Each control's contrast at rest, and against the lit row where it sits in one: `[name, ratio]`. */
function measure(controls) {
  const found = [];
  for (const { name, node, lit, canvases = CANVASES, as } of controls) {
    expect(node, `${name} is drawn`).toBeTruthy();
    // a state the control is drawn in: a class on it, or on what holds it (`[selector, class]`)
    const [holder, state] = Array.isArray(as) ? [node.closest(as[0]), as[1]] : [node, as];
    if (as) holder.classList.add(state);
    const ink = parseColour(getComputedStyle(node).color);
    expect(ink, `${name} has a colour`).toBeTruthy();
    for (const canvas of canvases) found.push([`${name} on ${canvas}`, contrast(ink, ground(node, canvas), opacity(node))]);
    if (lit) found.push([`${name} on its lit row`, contrast(ink, token('--bg-3'), opacity(node))]);
    if (as) holder.classList.remove(state);
  }
  return found;
}

/** An element of `classes` (`'a.b'`) under `parent`, made the way the editor or a component makes it. */
function made(parent, path) {
  let at = parent;
  for (const step of path.split(' > ')) {
    const [tag, ...classes] = step.split('.');
    const node = document.createElement(tag || 'div');
    node.className = classes.join(' ');
    at.append(node);
    at = node;
  }
  return at;
}

let style;
let view;
let home;
let homeApp;
let look;
let lookApp;
let loose;

beforeAll(async () => {
  style = document.createElement('style');
  style.textContent = STYLES.join('\n');
  document.head.append(style);
  // the editor: a table drawn as a grid, its bar and its column menus, a handle, the + of an empty line
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({
    parent,
    state: EditorState.create({ doc: '## Vehicles\n\n| Model | Count |\n|---|---|\n| Cougar | 8 |\n\nText.\n', extensions: noteExtensions({ mode: 'drawn' }) }),
  });
  // what opens on a press is made as the editor makes it, inside the editor so its theme reaches it
  made(view.dom, 'div.cm-handle-menu > button.cm-handle-item > span.cm-handle-icon');
  view.dom.querySelector('.cm-handle-item').append(Object.assign(document.createElement('span'), { className: 'cm-handle-more' }));
  made(view.dom, 'div.cm-tooltip.cm-tooltip-autocomplete.cm-insert-menu > ul > li > span.cm-insert-more');
  made(view.dom, 'div.cm-chart-frame > div.cm-chart-bar > button.cm-chart-tool.cm-chart-source');
  // the + stands in the margin of the empty line being written; the editor keeps its own lines, so it is made beside them
  made(view.dom, 'div.cm-line > span.cm-insert-plus-anchor > button.cm-insert-plus');
  // the Notebook's own: a note's card, the Look's header and footer, a menu, the infographic builder, the header's ⋯
  const { default: NotesHome } = await import('../../tools/notebook/NotesHome.svelte');
  home = document.createElement('div');
  document.body.append(home);
  homeApp = mount(NotesHome, {
    target: home,
    props: {
      caseId: 'c1', loading: false, templates: [], selected: [],
      rows: [{ id: 'n1', title: 'Lead', folder: '', excerpt: 'Seen at the quay.', modified: null, look: null,
        tasks: { open: 0, done: 0 }, mentions: 0, pictures: 0, includes: 0 }],
    },
  });
  const { default: LookControl } = await import('../../tools/notebook/LookControl.svelte');
  look = document.createElement('div');
  document.body.append(look);
  lookApp = mount(LookControl, { target: look, props: { look: normaliseLook({ header: { left: 'azimut:logo' } }), onchange() {}, entities: [] } });
  flushSync();
  look.querySelector('[data-guide="notebook.look"]').click();
  flushSync();
  [...document.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === 'Header & footer').click();
  flushSync();
  loose = document.createElement('div');
  document.body.append(loose);
  made(loose, 'div.float-menu > button.fm-item > svg');
  made(loose, 'aside.ib > ul > li.ib-panel > button.ib-remove');
  made(loose, 'header.tool-header > button.btn.btn-ghost.btn-sm');
});

afterAll(() => {
  view?.destroy();
  unmount(homeApp);
  unmount(lookApp);
  document.body.replaceChildren();
  style.remove();
  delete document.documentElement.dataset.theme;
});

const controls = () => [
  { name: "a column's ▾", node: view.dom.querySelector('.cm-grid-colbtn') },
  { name: "the grid bar's ⋯", node: view.dom.querySelector('.cm-grid-more') },
  { name: "the grid bar's </>", node: view.dom.querySelector('.cm-grid-source') },
  { name: "a row's number", node: view.dom.querySelector('.cm-grid-rowbtn') },
  { name: "the chart bar's </>", node: view.dom.querySelector('.cm-chart-source') },
  { name: 'the block handle ⋮⋮', node: view.dom.querySelector('.cm-handle') },
  { name: "the cursor's handle", node: view.dom.querySelector('.cm-handle'), as: 'cm-handle-caret' },
  { name: "a block menu row's icon", node: view.dom.querySelector('.cm-handle-icon'), lit: true },
  { name: "a block menu row's ›", node: view.dom.querySelector('.cm-handle-more'), lit: true },
  { name: "the insert menu's ›", node: view.dom.querySelector('.cm-insert-more') },
  { name: 'the + of an empty line', node: view.dom.querySelector('.cm-insert-plus') },
  { name: "a note card's ⋯", node: home.querySelector('button.more') },
  { name: "a picked note card's ⋯", node: home.querySelector('button.more'), as: ['.note-card', 'on'] },
  { name: "a slot's logo button", node: document.querySelector('.float-menu .slot-logo') },
  { name: "a logo chip's ×", node: document.querySelector('.float-menu .chip-x') },
  { name: "a menu row's icon", node: loose.querySelector('.fm-item > svg'), lit: true },
  { name: "a builder panel's ×", node: loose.querySelector('.ib-remove'), lit: true },
  { name: "the Notebook header's ⋯", node: loose.querySelector('.btn-ghost') },
];

describe('the quiet controls', () => {
  for (const theme of ['dark', 'light']) {
    it(`stand out 3:1 from what they sit on in the ${theme} theme`, () => {
      if (theme === 'light') document.documentElement.dataset.theme = 'light';
      else delete document.documentElement.dataset.theme;
      const found = measure(controls());
      expect(found.length).toBeGreaterThan(30);
      const faint = found.filter(([, ratio]) => ratio < FLOOR).map(([name, ratio]) => `${name}: ${ratio.toFixed(2)}`);
      expect(faint, `${theme} theme`).toEqual([]);
    });
  }

  it('measure as WCAG does', () => {
    expect(contrast(parseColour('#000'), parseColour('#fff'))).toBeCloseTo(21, 5);
    expect(contrast(parseColour('#777777'), parseColour('#ffffff'))).toBeCloseTo(4.48, 2);
    // the hint grey at 70 % over a header cell: what a column's ▾ was
    expect(contrast(parseColour('#6c6c6c'), parseColour('#252525'), 0.7)).toBeLessThan(FLOOR);
    expect(parseColour('rgba(255, 255, 255, 0.09)')).toEqual({ r: 255, g: 255, b: 255, a: 0.09 });
  });
});
