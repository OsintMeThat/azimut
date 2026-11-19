/**
 * The note editor: Markdown written in place, drawn as it will read.
 *
 * The file stays the Markdown the PDF and `lib/markdown.js` read. What changes is
 * the page: a heading is set large with its `#` put away, a case reference is a
 * chip, a picture, a table and a diagram are drawn, a task is a box to tick, and a
 * callout is a coloured block. The marks come back on the line being edited, so
 * nothing is hidden from the person writing it.
 *
 * A block (a picture, a table, a diagram, an aligned block, a block of steps or a
 * story, a page break, a chapter)
 * stays drawn when it is clicked: the press picks it, and its source shows only once
 * it is opened (a double press, Enter, or its </> button), until the cursor leaves.
 * The page can also be switched off for the raw Markdown (`setNoteMode`).
 *
 * Nothing on the page needs Markdown to be written: words selected bring up the
 * selection bubble and its Link field (`editor/bubble.js`, `editor/linkField.js`), `/`
 * or the + of an empty line the insert menu (`editor/insertMenu.js`), and what they
 * write is the Markdown an expert would type (`editor/marks.js`). A chip or a written
 * link, hovered or with the cursor in it, shows what the case knows of what it cites
 * (`editor/citationCard.js`).
 *
 * Built on CodeMirror 6. Everything the page draws is worked out from the editor
 * state alone (`noteDecorations`), so it is tested without a browser.
 *
 * This file only puts the editor together, and says what the rest of the app may
 * import. The parts live in `editor/`: the page (`decorations.js`), the kinds of
 * block it draws whole, one module each, registered in `blocks.js` and loaded by
 * `kinds.js`, where the drawn blocks are (`ranges.js`), the keys at a block
 * (`blockKeys.js`), the `/` and `@` menus, what the toolbar writes (`writing.js`),
 * what a tool puts in (`puts.js`), a table's grid (`tableGrid.js`), the block handle with
 * its menu (`handle.js`, `blockMenu.js`, what they write in `turnInto.js`), and the strip of a
 * block of steps or a story (`playedBlock.js`, what it writes in `stepEdits.js`, the case's
 * pictures it and a picture's Replace pick from in `casePicker.js`).
 */
import { EditorState, Compartment, Prec } from '@codemirror/state';
import {
  EditorView, keymap, placeholder as placeholderText, drawSelection, dropCursor,
} from '@codemirror/view';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { syntaxHighlighting } from '@codemirror/language';
import { history, historyKeymap, defaultKeymap, indentWithTab } from '@codemirror/commands';
import { autocompletion, completionKeymap, acceptCompletion } from '@codemirror/autocomplete';

import { blockKinds } from './editor/blocks.js';
import { blockKeys, pickedClass, typeNextToBlock, typeOnPicked } from './editor/blockKeys.js';
import { selectionBubble } from './editor/bubble.js';
import { citationCard } from './editor/citationCard.js';
import { drawn, rawField, rawHighlight, typeOverHints } from './editor/decorations.js';
import { handleExtensions } from './editor/handle.js';
import './editor/kinds.js';
import { insertMenu, insertPlus } from './editor/insertMenu.js';
import { mentionSource } from './editor/mentionMenu.js';
import { landed, spots } from './editor/puts.js';
import { blocksIn } from './editor/ranges.js';
import { slashSource } from './editor/slashMenu.js';
import {
  focused, noteCase, noteHandlers, openBlock, resolve, setFocused, setNoteCase, setOpenBlock, templateMode,
} from './editor/state.js';
import { highlight, look } from './editor/theme.js';
import { leaveEmptyItem, tickTask, toggleWrap } from './editor/writing.js';

export { noteCase, setNoteCase, templateMode } from './editor/state.js';
export { hintLineAt, noteDecorations, typeOverHints } from './editor/decorations.js';
export { openBlockAt } from './editor/ranges.js';
export { insertInclude, removeInclude } from './editor/includeBlock.js';
export { playedSteps, storyZoom } from './editor/playedBlock.js';
export { mapBlock } from './editor/mapBlock.js';
export { resizePicture } from './editor/pictureBlock.js';
export { mentionSource } from './editor/mentionMenu.js';
export { slashSource } from './editor/slashMenu.js';
export { openInsertMenu } from './editor/insertMenu.js';
export { openLinkField } from './editor/bubble.js';
export { registerTableChart } from './editor/tableGrid.js';
export { openTablePicker } from './editor/tableInsert.js';
export { holdCell, placeInCell, releaseCell } from './editor/tablePictures.js';
export {
  LIGHT_MS, blockAt, captionAt, heldRange, holdRange, lightLines, placeText, releaseRange, takeBackRange,
} from './editor/puts.js';
export {
  insertAtCursor, insertCover, jumpToLine, leaveEmptyItem, setLinePrefix, toggleWrap,
} from './editor/writing.js';

// -- the two modes ----------------------------------------------------------------

/**
 * The page is drawn, or it is the raw Markdown. Everything that draws or acts on a
 * drawn block lives in one compartment, so switching reconfigures it: the text, the
 * cursor, the history and the case stay where they are.
 */
const drawing = new Compartment();

const drawnMode = [
  openBlock, drawn, typeOverHints, typeNextToBlock, Prec.high(typeOnPicked), pickedClass, blockKeys, handleExtensions,
  // what a kind of block keeps or reads besides its lines (a table: which table is which, a pasted spreadsheet)
  blockKinds().map((kind) => kind.extensions ?? []),
];
const rawMode = [rawField, syntaxHighlighting(rawHighlight)];
// what helps write on the drawn page without Markdown: the selection bubble, the + of an empty line
drawnMode.push(selectionBubble, insertPlus);

/** `drawn` or `markdown`: how the page is shown now. */
export function noteMode(state) {
  return state.field(drawn, false) ? 'drawn' : 'markdown';
}

/**
 * Show the page drawn or as raw Markdown. The cursor and the selection are the
 * document's, so they stay; the scroll is held to the line at the top of the page.
 * Answers whether it changed.
 */
export function setNoteMode(view, mode) {
  const next = mode === 'markdown' ? 'markdown' : 'drawn';
  if (noteMode(view.state) === next) return false;
  view.dispatch({ effects: [drawing.reconfigure(next === 'markdown' ? rawMode : drawnMode), view.scrollSnapshot()] });
  return true;
}

// -- the editor ----------------------------------------------------------------

/**
 * The extensions a note editor is made of. `handlers` are the editor's outside:
 * `open(entity)`, `note(id)`, `point(lat, lon)`, `picture()`, `upload()`,
 * `include()`, `image(file)`, `url(url, from, to)`, `media(paths, at)` and
 * `change(text)`. `template` writes a template rather than a note. `mode` is
 * `drawn` or `markdown` (`setNoteMode` switches it later).
 */
export function noteExtensions({ handlers = {}, placeholder = '', readOnly = false, editable, template = false, mode = 'drawn' } = {}) {
  return [
    noteCase,
    focused,
    templateMode.of(template),
    noteHandlers.of(handlers),
    spots,
    landed,
    drawing.of(mode === 'markdown' ? rawMode : drawnMode),
    history(),
    drawSelection(),
    dropCursor(),
    EditorView.lineWrapping,
    markdown({ base: markdownLanguage, addKeymap: true }),
    syntaxHighlighting(highlight),
    autocompletion({ override: [mentionSource, slashSource(handlers, { template })], icons: false, activateOnTyping: true, closeOnBlur: true }),
    insertMenu,
    // what a chip or a written link cites, on hover or with the cursor in it, drawn or raw
    citationCard,
    // above Markdown's own Enter, which continues a list: an open menu takes Enter first
    Prec.highest(keymap.of([{ key: 'Tab', run: acceptCompletion }, ...completionKeymap, { key: 'Enter', run: leaveEmptyItem }])),
    keymap.of([
      { key: 'Mod-b', run: (view) => toggleWrap(view, '**') },
      { key: 'Mod-i', run: (view) => toggleWrap(view, '*') },
      ...historyKeymap,
      indentWithTab,
      ...defaultKeymap,
    ]),
    placeholder ? placeholderText(placeholder) : [],
    (editable ?? new Compartment()).of([EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)]),
    look,
    // the rules a kind of block brings, after the editor's own
    blockKinds().filter((kind) => kind.theme).map((kind) => EditorView.theme(kind.theme)),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) handlers.change?.(update.state.doc.toString());
      if (update.focusChanged) {
        const now = update.view.hasFocus;
        queueMicrotask(() => {
          if (update.view.state.field(focused) !== now) update.view.dispatch({ effects: setFocused.of(now) });
        });
      }
    }),
    EditorView.domEventHandlers({
      mousedown(event, view) {
        const chip = event.target.closest?.('[data-chip]');
        if (chip && event.button === 0) {
          event.preventDefault();
          const entity = resolve(view.state.field(noteCase), chip.dataset.entityId);
          if (entity) handlers.open?.(entity);
          return true;
        }
        const go = event.target.closest?.('.cm-coords-go');
        if (go && event.button === 0) {
          event.preventDefault();
          handlers.point?.(Number(go.dataset.lat), Number(go.dataset.lon));
          return true;
        }
        const box = event.target.closest?.('.cm-task');
        if (box && event.button === 0) {
          event.preventDefault();
          if (!view.state.readOnly) tickTask(view, Number(box.dataset.taskAt));
          return true;
        }
        // a press on a block of a kind that answers presses itself (a chapter's Open and Remove)
        for (const kind of blockKinds()) if (kind.mousedown?.(event, view, handlers)) return true;
        return false;
      },
      paste(event, view) {
        const items = [...(event.clipboardData?.items ?? [])];
        const image = items.find((item) => item.type.startsWith('image/'));
        if (image && handlers.image) {
          event.preventDefault();
          handlers.image(image.getAsFile());
          return true;
        }
        const text = event.clipboardData?.getData('text/plain') ?? '';
        if (handlers.url && /^\s*https?:\/\/\S+\s*$/i.test(text)) {
          const from = view.state.selection.main.from;
          const url = text.trim();
          queueMicrotask(() => handlers.url(url, from, from + url.length));
        }
        return false;
      },
      drop(event, view) {
        const at = view.posAtCoords({ x: event.clientX, y: event.clientY }) ?? view.state.selection.main.head;
        if (handlers.media?.(event, at)) {
          event.preventDefault();
          return true;
        }
        const image = [...(event.dataTransfer?.files ?? [])].find((file) => file.type.startsWith('image/'));
        if (image && handlers.image) {
          event.preventDefault();
          view.dispatch({ selection: { anchor: at } });
          handlers.image(image);
          return true;
        }
        return false;
      },
    }),
  ];
}

/** A note's editor state: its text, and the case its references are read in. */
export function noteState(text, { caseInfo, ...options } = {}) {
  const state = EditorState.create({ doc: text, extensions: noteExtensions(options) });
  return caseInfo ? state.update({ effects: setNoteCase.of(caseInfo) }).state : state;
}

/** Mark a state as being edited, for tests of what the line being edited shows. */
export function focusedState(state) {
  return state.update({ effects: setFocused.of(true) }).state;
}

/** The state with the block drawn at `pos` open, the cursor at its start, for tests of what an open block shows. */
export function openedState(state, pos) {
  const block = blocksIn(state, pos).find((item) => item.from <= pos && pos <= item.to);
  if (!block) return focusedState(state);
  return state.update({ selection: { anchor: block.from }, effects: [setFocused.of(true), setOpenBlock.of({ from: block.from, to: block.to })] }).state;
}
