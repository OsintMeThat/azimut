// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { EditorSelection, EditorState } from '@codemirror/state';
import { undo } from '@codemirror/commands';

// the small pictures the case made, asked once a list opens
const { post } = vi.hoisted(() => ({ post: vi.fn(async () => []) }));
vi.mock('../../api.js', () => ({ api: { post } }));
// a diagram is drawn by Mermaid in a browser; here it answers at once
vi.mock('../../mermaid.js', () => ({ renderMermaidSvg: vi.fn(async () => ({ svg: '<svg></svg>' })) }));

const { focusedState, noteExtensions, setNoteCase } = await import('../liveMarkdown.js');
const { MEDIA_DRAG } = await import('../../drag.js');
const { forgetPickerThumbs } = await import('./casePicker.js');

/**
 * Pictures and stories without braces: a picture's bar veils it, puts another in its
 * place, shows a size while the pointer is on it and snaps a dragged corner, its caption
 * is written where it prints; a block of steps or a story is a strip whose steps are
 * added, dropped in, moved, written and framed in place. Each gesture writes the braces
 * or the lines an expert would type, in one change one Undo takes back. And no drawn
 * block keeps its room in a margin, which the editor's height map cannot see.
 */

const ROOF = { id: 'm1', type: 'media', label: 'Roof', attrs: { path: 'media/roof.png', kind: 'image' } };
const YARD = { id: 'm2', type: 'media', label: 'Yard', attrs: { path: 'media/yard.png', kind: 'image', folder: 'Port' } };
const GATE = { id: 'm3', type: 'capture', label: 'Gate', attrs: { path: 'media/gate.png', kind: 'image' } };
const CLIP = { id: 'v1', type: 'media', label: 'Clip', attrs: { path: 'media/clip.mp4', kind: 'video' } };

let view;
afterEach(() => {
  view?.destroy();
  view = null;
  for (const node of document.querySelectorAll('.cm-picker')) node.remove();
  forgetPickerThumbs();
  post.mockClear();
});

function editor(doc, { readOnly = false, template = false } = {}) {
  const parent = document.createElement('div');
  document.body.append(parent);
  view = new EditorView({ parent, state: EditorState.create({ doc, extensions: noteExtensions({ readOnly, template }) }) });
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [ROOF, YARD, GATE, CLIP] }) });
  // happy-dom answers focus() with a selection of its own, which a browser does not; the editor is made focused by its state
  view.focus = vi.fn();
  view.setState(focusedState(view.state.update({ selection: EditorSelection.cursor(0) }).state));
  view.dispatch({ effects: setNoteCase.of({ caseId: 'c1', entities: [ROOF, YARD, GATE, CLIP] }) });
  return view;
}

const text = () => view.state.doc.toString();
const mouse = (node, type, extra = {}) => node.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, ...extra }));
const pointer = (node, type, x, y) => node.dispatchEvent(new window.PointerEvent(type, {
  bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: x, clientY: y,
}));
const key = (node, name, options = {}) => node.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...options }));
const settle = async () => { for (let round = 0; round < 4; round += 1) await Promise.resolve(); };
/** A rect for an element happy-dom does not lay out. */
const rect = (node, { left = 0, top = 0, width = 0, height = 0 }) => {
  node.getBoundingClientRect = () => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top });
};
/** Undo once, and say whether the note is back to `doc`. */
const undoneTo = (doc) => {
  undo(view);
  return text() === doc;
};

describe('a picture\'s bar', () => {
  const DOC = 'Intro\n\n[[media:m1|Roof]]{width=50% caption="The roof"}\n\nEnd';
  const bar = () => view.dom.querySelector('.cm-block-picture [data-size-bar]');

  it('offers its sizes, its places, its caption, Graphic and Replace…, Graphic pressed when the braces say graphic', () => {
    editor(DOC);
    const labels = [...bar().querySelectorAll('button')].map((button) => button.textContent || button.getAttribute('aria-label'));
    expect(labels).toEqual(['XXS', 'XS', 'S', 'M', 'L', 'Full', 'Left', 'Centre', 'Right', 'Caption', 'Graphic', 'Replace…', 'Side by side', 'Edit the source']);
    expect(bar().querySelector('[data-graphic]').getAttribute('aria-pressed')).toBe('false');
    expect(bar().querySelector('[data-graphic]').title).toBe('Graphic: blurred on the web until pressed');
    view.destroy();
    editor(DOC.replace('}', ' graphic}'));
    expect(bar().querySelector('[data-graphic]').getAttribute('aria-pressed')).toBe('true');
  });

  it('veils a graphic picture in one press, drawn blurred and saying so, and one Undo takes it back', () => {
    editor(DOC);
    mouse(bar().querySelector('[data-graphic]'), 'mousedown');
    expect(text()).toBe(DOC.replace('caption="The roof"}', 'caption="The roof" graphic}'));
    const frame = view.dom.querySelector('.cm-block-picture .cm-picture-frame');
    expect(frame.classList.contains('cm-veiled')).toBe(true);
    expect(frame.querySelector('.cm-veil-said').textContent).toBe('Graphic pictureBlurred on the web until pressed');
    expect(bar().querySelector('[data-graphic]').getAttribute('aria-pressed')).toBe('true');
    // and off again, the braces as they were
    mouse(bar().querySelector('[data-graphic]'), 'mousedown');
    expect(text()).toBe(DOC);
    expect(undoneTo(DOC.replace('caption="The roof"}', 'caption="The roof" graphic}'))).toBe(true);
    expect(undoneTo(DOC)).toBe(true);
  });

  it('writes the caption where it prints, once its words are pressed, in one change', () => {
    editor(DOC);
    const caption = view.dom.querySelector('.cm-block-picture .markdown-caption');
    expect(caption.dataset.captionEdit).toBe('true');
    mouse(caption, 'mousedown');
    const field = view.dom.querySelector('.picture-caption-field');
    expect(field.value).toBe('The roof');
    field.value = 'The roof, burnt';
    key(field, 'Enter');
    expect(text()).toBe(DOC.replace('The roof"', 'The roof, burnt"'));
    expect(undoneTo(DOC)).toBe(true);
  });

  it('puts another picture of the case in its place, picked from a list of them, its braces kept', async () => {
    editor(DOC);
    mouse(bar().querySelector('[data-replace]'), 'mousedown');
    const picker = view.dom.querySelector('.cm-picker');
    expect(picker.getAttribute('aria-label')).toBe('Replace the picture');
    // the case's pictures by name, never a video
    expect([...picker.querySelectorAll('.cm-picker-name')].map((name) => name.textContent)).toEqual(['Gate', 'Roof', 'Yard']);
    await settle();
    expect(post).toHaveBeenCalledWith('/api/cases/c1/media/metadata', { paths: ['media/gate.png', 'media/roof.png', 'media/yard.png'] });
    const field = picker.querySelector('.cm-picker-field');
    field.value = 'port';
    field.dispatchEvent(new Event('input'));
    expect([...picker.querySelectorAll('.cm-picker-name')].map((name) => name.textContent)).toEqual(['Yard']);
    mouse(picker.querySelector('[data-entity-pick="m2"]'), 'click');
    expect(view.dom.querySelector('.cm-picker')).toBeNull();
    expect(text()).toBe(DOC.replace('[[media:m1|Roof]]', '[[media:m2|Yard]]'));
    expect(undoneTo(DOC)).toBe(true);
  });

  it('closes its list on Escape, writing nothing', () => {
    editor(DOC);
    mouse(bar().querySelector('[data-replace]'), 'mousedown');
    key(view.dom.querySelector('.cm-picker-field'), 'Escape');
    expect(view.dom.querySelector('.cm-picker')).toBeNull();
    expect(text()).toBe(DOC);
  });

  it('shows a size on the picture while the pointer is on its button, writing nothing', () => {
    editor(DOC);
    const frame = view.dom.querySelector('.cm-block-picture .cm-picture-frame');
    expect(frame.style.width).toBe('50%');
    const large = bar().querySelector('[data-share="0.75"]');
    large.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
    expect(frame.style.width).toBe('75%');
    expect(frame.querySelector('.cm-picture-size').textContent).toBe('L · 75%');
    large.dispatchEvent(new window.PointerEvent('pointerout', { bubbles: true, relatedTarget: document.body }));
    expect(frame.style.width).toBe('50%');
    expect(frame.querySelector('.cm-picture-size')).toBeNull();
    expect(text()).toBe(DOC);
  });

  it('snaps a corner dragged to the nearest size, said on the picture, and writes it let go, in one change', () => {
    editor(DOC);
    const box = view.dom.querySelector('.cm-block-picture');
    const frame = box.querySelector('.cm-picture-frame');
    const corner = frame.querySelector('.cm-picture-corner');
    expect(corner.dataset.side).toBe('right');
    Object.defineProperty(box, 'clientWidth', { value: 800, configurable: true });
    const style = getComputedStyle(box);
    const room = 800 - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
    rect(frame, { left: 32, top: 0, width: room / 2, height: 200 });
    pointer(corner, 'pointerdown', 32 + room / 2, 200);
    pointer(corner, 'pointermove', 32 + room * 0.72, 260);
    expect(frame.style.width).toBe('75%');
    expect(frame.querySelector('.cm-picture-size').textContent).toBe('L · 75%');
    expect(text()).toBe(DOC);
    pointer(corner, 'pointerup', 32 + room * 0.72, 260);
    expect(text()).toBe(DOC.replace('width=50%', 'width=75%'));
    expect(undoneTo(DOC)).toBe(true);
  });

  it('leaves its size as it was when Escape ends the drag', () => {
    editor(DOC);
    const box = view.dom.querySelector('.cm-block-picture');
    const frame = box.querySelector('.cm-picture-frame');
    const corner = frame.querySelector('.cm-picture-corner');
    Object.defineProperty(box, 'clientWidth', { value: 800, configurable: true });
    rect(frame, { left: 32, top: 0, width: 300, height: 200 });
    pointer(corner, 'pointerdown', 332, 200);
    pointer(corner, 'pointermove', 80, 200);
    key(window, 'Escape');
    expect(frame.style.width).toBe('50%');
    pointer(corner, 'pointerup', 80, 200);
    expect(text()).toBe(DOC);
  });

  it('has no bar, no corner and no pressable caption in a note nobody can write in', () => {
    editor(DOC, { readOnly: true });
    expect(bar()).toBeNull();
    expect(view.dom.querySelector('.cm-picture-corner')).toBeNull();
    expect(view.dom.querySelector('.markdown-caption').dataset.captionEdit).toBeUndefined();
  });
});

describe('a story\'s strip', () => {
  const STORY = [
    'Intro', '', '::: story', 'What the strike left.',
    '[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}', 'The roof first.', '',
    '[[media:m2|Yard]]', 'The yard.', ':::', '', 'End',
  ].join('\n');
  const box = () => view.dom.querySelector('.cm-block-story');
  const step = (index) => box().querySelector(`[data-step-index="${index}"]`);

  it('draws each step with its number to drag it by and its tools, and ends on Add a step', () => {
    editor(STORY);
    expect(box().querySelector('.cm-played-head').textContent).toBe('Story · 2 steps, the words scroll beside the pictures in HTML');
    expect([...box().querySelectorAll('.cm-step-grip')].map((grip) => grip.textContent)).toEqual(['1', '2']);
    expect([...step(0).querySelectorAll('.cm-step-tools button')].map((button) => button.getAttribute('aria-label')))
      .toEqual(['Move this step earlier', 'Move this step later', 'Remove this step']);
    expect(box().querySelector('[data-add-step]').textContent).toBe('Add a stepor drop a picture here');
    expect(step(0).querySelector('[data-zoom-area]').dataset.hint).toBe('Drag on the picture to frame what this step moves in on');
    expect(step(0).querySelector('[data-step-edit="words"]').textContent.trim()).toBe('The roof first.');
  });

  it('is drawn as it reads, with no tool, in a note nobody can write in', () => {
    editor(STORY, { readOnly: true });
    expect(box().querySelector('.cm-step-grip, .cm-step-tools, [data-add-step], [data-zoom-area], [data-step-edit]')).toBeNull();
    expect(box().querySelector('.cm-zoom-box')).not.toBeNull();
  });

  it('adds a step picked from the case\'s pictures, last, one Undo', () => {
    editor(STORY);
    mouse(box().querySelector('[data-add-step]'), 'mousedown');
    const picker = view.dom.querySelector('.cm-picker');
    expect(picker.getAttribute('aria-label')).toBe('Add a step');
    // the arrows walk the list and Enter picks: Gate, Roof, Yard
    key(picker.querySelector('.cm-picker-field'), 'ArrowDown');
    key(picker.querySelector('.cm-picker-field'), 'ArrowUp');
    key(picker.querySelector('.cm-picker-field'), 'Enter');
    expect(text()).toBe(STORY.replace('The yard.\n:::', 'The yard.\n\n[[media:m3|Gate]]\n:::'));
    expect(box().querySelectorAll('.cm-played-step')).toHaveLength(3);
    expect(undoneTo(STORY)).toBe(true);
  });

  it('moves a step with its arrows, the keyboard staying on the arrow, and one Undo puts it back', () => {
    editor(STORY);
    mouse(step(0).querySelector('[data-move="1"]'), 'mousedown');
    const moved = STORY.replace(
      '[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}\nThe roof first.\n\n[[media:m2|Yard]]\nThe yard.',
      '[[media:m2|Yard]]\nThe yard.\n\n[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}\nThe roof first.',
    );
    expect(text()).toBe(moved);
    expect(undoneTo(STORY)).toBe(true);
    // the keyboard's press gives a click with no press before it
    step(1).querySelector('[data-move="-1"]').dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 0 }));
    expect(text()).toBe(moved);
    expect(document.activeElement?.closest?.('[data-step-index]')?.dataset.stepIndex).toBe('0');
  });

  it('moves a step dragged by its number to where it is let go, a line showing where', () => {
    editor(STORY);
    const [first, second] = box().querySelectorAll('.cm-played-step');
    rect(first, { left: 0, top: 100, width: 600, height: 200 });
    rect(second, { left: 0, top: 320, width: 600, height: 200 });
    const grip = first.querySelector('.cm-step-grip');
    pointer(grip, 'pointerdown', 10, 110);
    pointer(grip, 'pointermove', 10, 300);
    pointer(grip, 'pointermove', 10, 480);
    expect(first.classList.contains('cm-step-lifted')).toBe(true);
    expect(box().querySelector('.cm-step-drop').hidden).toBe(false);
    pointer(grip, 'pointerup', 10, 480);
    expect(text().indexOf('[[media:m2|Yard]]')).toBeLessThan(text().indexOf('[[media:m1|Roof]]'));
    expect(undoneTo(STORY)).toBe(true);
  });

  it('removes a step, its picture and its words', () => {
    editor(STORY);
    mouse(step(0).querySelector('[data-remove]'), 'mousedown');
    expect(text()).toBe(STORY.replace('[[media:m1|Roof]]{zoom=0.25,0.1,0.5,0.4}\nThe roof first.\n\n', ''));
    expect(undoneTo(STORY)).toBe(true);
  });

  it('writes a step\'s words in place: Enter writes them, Shift+Enter starts a line, Escape leaves them', () => {
    editor(STORY);
    mouse(step(1).querySelector('[data-step-edit="words"]'), 'mousedown');
    let field = box().querySelector('.cm-step-field');
    expect(field.value).toBe('The yard.');
    field.value = 'Nothing changed';
    key(field, 'Escape');
    expect(text()).toBe(STORY);
    mouse(step(1).querySelector('[data-step-edit="words"]'), 'mousedown');
    field = box().querySelector('.cm-step-field');
    field.value = 'The yard, from the gate.\nIts wall is down.';
    expect(key(field, 'Enter', { shiftKey: true })).toBe(true);
    expect(text()).toBe(STORY);
    key(field, 'Enter');
    expect(text()).toBe(STORY.replace('The yard.', 'The yard, from the gate.\nIts wall is down.'));
    expect(undoneTo(STORY)).toBe(true);
  });

  it('frames the part a step moves in on by a box dragged on its picture, and shows the whole picture again', () => {
    editor(STORY);
    const area = step(1).querySelector('[data-zoom-area]');
    rect(area.querySelector('img'), { left: 100, top: 100, width: 400, height: 200 });
    pointer(area, 'pointerdown', 140, 120);
    pointer(area, 'pointermove', 340, 220);
    expect(parseFloat(area.querySelector('.cm-zoom-drawing').style.width)).toBeCloseTo(50);
    pointer(area, 'pointerup', 340, 220);
    expect(text()).toBe(STORY.replace('[[media:m2|Yard]]', '[[media:m2|Yard]]{zoom=0.1,0.1,0.5,0.5}'));
    expect(undoneTo(STORY)).toBe(true);
    // a press that frames almost nothing writes nothing
    const again = step(1).querySelector('[data-zoom-area]');
    rect(again.querySelector('img'), { left: 100, top: 100, width: 400, height: 200 });
    pointer(again, 'pointerdown', 140, 120);
    pointer(again, 'pointerup', 142, 121);
    expect(text()).toBe(STORY);
    mouse(step(0).querySelector('[data-unzoom]'), 'mousedown');
    expect(text()).toBe(STORY.replace('{zoom=0.25,0.1,0.5,0.4}', ''));
  });

  it('adds the case pictures dropped on it, from the Media library or the case\'s lists, where they land', () => {
    editor(STORY);
    const drop = (type, transfer, y) => {
      const [first, second] = box().querySelectorAll('.cm-played-step');
      rect(first, { left: 0, top: 100, width: 600, height: 200 });
      rect(second, { left: 0, top: 320, width: 600, height: 200 });
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { clientX: 10, clientY: y });
      Object.defineProperty(event, 'dataTransfer', { value: transfer });
      first.dispatchEvent(event);
      return event;
    };
    const library = { types: [MEDIA_DRAG], getData: () => JSON.stringify([{ path: 'media/gate.png' }]), dropEffect: 'none' };
    expect(drop('dragover', library, 310).defaultPrevented).toBe(true);
    expect(box().querySelector('.cm-step-drop').hidden).toBe(false);
    drop('drop', library, 310);
    expect(text()).toBe(STORY.replace('\n[[media:m2|Yard]]', '\n[[media:m3|Gate]]\n[[media:m2|Yard]]'));
    expect(undoneTo(STORY)).toBe(true);
    // records dragged from the case's lists come as their ids; a video or a note is not a step
    const ids = (value) => ({ types: ['text/plain'], getData: () => value, dropEffect: 'none' });
    drop('drop', ids('m3 v1'), 50);
    expect(text()).toBe(STORY);
    drop('drop', ids('n0 m3'), 50);
    expect(text()).toBe(STORY);
    drop('drop', ids('m3'), 50);
    expect(text()).toBe(STORY.replace('[[media:m1|Roof]]', '[[media:m3|Gate]]\n[[media:m1|Roof]]'));
  });

  it('shows its own empty state, not a note\'s guidance, and keeps a template\'s guidance', () => {
    const empty = '::: story\n<!--? A picture, then the words read beside it -->\n:::\n\nEnd';
    editor(empty);
    expect(box().querySelector('.cm-step-none').textContent).toBe('No step yet: each picture you add is one.');
    expect(box().querySelector('.cm-hint')).toBeNull();
    mouse(box().querySelector('[data-add-step]'), 'mousedown');
    mouse(view.dom.querySelector('[data-entity-pick="m1"]'), 'click');
    expect(text()).toBe('::: story\n[[media:m1|Roof]]\n:::\n\nEnd');
    view.destroy();
    editor(empty, { template: true });
    expect(box().querySelector('.cm-hint').textContent).toBe('A picture, then the words read beside it');
  });
});

describe('a block of steps\' strip', () => {
  const STEPS = 'Intro\n\n::: steps\n[[media:m1|Roof]]{caption="2 Mar"}\n[[media:m2|Yard]]{caption="3 Mar"}\n:::\n\nEnd';
  const box = () => view.dom.querySelector('.cm-block-steps');

  it('writes a step\'s caption in place, under its picture, shown once', () => {
    editor(STEPS);
    const [first] = box().querySelectorAll('.cm-played-step');
    expect(first.querySelectorAll('.markdown-caption')).toHaveLength(0);
    expect(first.querySelector('[data-step-edit="caption"]').textContent).toBe('2 Mar');
    expect(first.querySelector('[data-zoom-area]')).toBeNull();
    mouse(first.querySelector('[data-step-edit="caption"]'), 'mousedown');
    const field = box().querySelector('.picture-caption-field');
    field.value = '2 Mar 2026';
    key(field, 'Enter');
    expect(text()).toBe(STEPS.replace('2 Mar"', '2 Mar 2026"'));
    expect(undoneTo(STEPS)).toBe(true);
  });

  it('moves a step across with its arrows, and its add card ends the row', () => {
    editor(STEPS);
    const [, second] = box().querySelectorAll('.cm-played-step');
    expect(second.querySelector('[data-move="-1"]').getAttribute('aria-label')).toBe('Move this step earlier');
    expect(box().querySelector('.cm-played-list > [data-add-step]')).not.toBeNull();
    mouse(second.querySelector('[data-move="-1"]'), 'mousedown');
    expect(text()).toBe('Intro\n\n::: steps\n[[media:m2|Yard]]{caption="3 Mar"}\n[[media:m1|Roof]]{caption="2 Mar"}\n:::\n\nEnd');
    expect(undoneTo(STEPS)).toBe(true);
  });
});
