// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import AnnotationToolbar from './AnnotationToolbar.svelte';
import { ANNOTATION_COLOURS, ANNOTATION_TOOLS } from '../../lib/map/compareAnnotations.js';

// Read off the project root: under happy-dom `import.meta.url` is an http URL.
const source = readFileSync(resolve('src/tools/compare/AnnotationToolbar.svelte'), 'utf8');

let live;
let target;

function props(overrides = {}) {
  return {
    tool: 'select',
    selected: null,
    canUndo: false,
    canRedo: false,
    undo: vi.fn(),
    redo: vi.fn(),
    palette: ANNOTATION_COLOURS,
    colour: ANNOTATION_COLOURS[0],
    strokeWidth: 4,
    fillOpacity: 0,
    count: 0,
    side: 'both',
    ...overrides,
  };
}

function stage(overrides = {}) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(AnnotationToolbar, { target, props: props(overrides) });
  flushSync();
  return target;
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

describe('the comparison annotation rail', () => {
  it('holds every drawing tool, undo and redo', () => {
    const rail = stage().innerHTML;
    for (const entry of ANNOTATION_TOOLS) expect(rail).toContain(entry.label);
    expect(rail).toContain('Undo (Ctrl+Z)');
    expect(rail).toContain('Redo (Ctrl+Shift+Z)');
  });

  it('packs into two columns, so the rail stays short enough to fit a laptop', () => {
    // Proof Maker's rail, followed here: two 32px columns, and a separator that
    // spans both so the groups it marks survive the grid.
    expect(source).toMatch(/grid-template-columns:\s*repeat\(2,\s*32px\)/);
    expect(source).toMatch(/\.separator\s*{[^}]*grid-column:\s*1 \/ -1/);
    expect(source).toMatch(/select\s*{[^}]*grid-column:\s*1 \/ -1/);
  });

  it('keeps colour, size and fill out of the way until something is being drawn', () => {
    expect(stage().innerHTML).not.toContain('Annotation colour');
    unmount(live);
    live = null;
    expect(stage({ tool: 'rect' }).innerHTML).toContain('Fill opacity');
  });
});

describe('the flyout a rail button opens', () => {
  const press = (node) => node.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  const panel = () => document.querySelector('.flyout');
  const trigger = (title) => target.querySelector(`button[title="${title}"]`);

  it('closes on a press outside it', () => {
    stage({ tool: 'rect' });
    trigger('Annotation colour').click();
    flushSync();
    expect(panel()).not.toBeNull();

    press(document.body);
    flushSync();
    expect(panel()).toBeNull();
  });

  it('stays open while it is being used, and shuts from its own button', () => {
    stage({ tool: 'rect' });
    trigger('Annotation colour').click();
    flushSync();

    press(panel().querySelector('.colour-button'));
    flushSync();
    expect(panel()).not.toBeNull();

    // The press on the opener must not close it, or the click that follows
    // would reopen what it was meant to shut.
    press(trigger('Annotation colour'));
    trigger('Annotation colour').click();
    flushSync();
    expect(panel()).toBeNull();
  });

  it('goes with the button behind it when that button leaves the rail', () => {
    stage({ tool: 'rect' });
    trigger('Fill opacity').click();
    flushSync();
    expect(panel()).not.toBeNull();

    // Back to Select with nothing picked: the contextual buttons go, and a
    // panel left behind would float over the maps with nothing behind it. The
    // click carries no mousedown, so this is the guard and not the outside press.
    trigger('Select and move (V)').click();
    flushSync();
    expect(panel()).toBeNull();
  });
});
