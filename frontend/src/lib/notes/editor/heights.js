/**
 * How tall the note is where the editor does not draw it: CodeMirror draws what is in
 * view and estimates the rest, so every line and block under a wrong estimate stands out
 * of place, and the note jumps the moment the editor sets it right (a panel taking the
 * keyboard, a block made again off-screen). Two estimates are kept true here:
 *
 * - **a drawn block**: estimated at the height it was last drawn at (`holdHeight`,
 *   `heldHeight`), the shared block widget and the kinds with their own asking for it;
 * - **a line of text**: CodeMirror reads its line height off the first short line of
 *   plain text in view, and a short heading (*Count*, *Register*), a line of code or of a
 *   raw table is not one. Such a line wears a mark (`steadyLines`), so the editor never
 *   reads its height as the note's: a register's sections otherwise flipped every line
 *   below them between a heading's 47 px and a paragraph's 25 px, thousands of pixels at
 *   once.
 */
import { syntaxTree } from '@codemirror/language';
import { Decoration, ViewPlugin } from '@codemirror/view';

/** How many drawn heights are kept, the oldest going first, by what a block's `same` compares. */
export const HELD_HEIGHTS = 400;
const heights = new Map();
let watcher = null;

function keepHeight(key, height) {
  heights.delete(key);
  heights.set(key, height);
  while (heights.size > HELD_HEIGHTS) heights.delete(heights.keys().next().value);
}

/** Note what a drawn box measures now, under the key of the block it draws. */
function measured(box, height) {
  if (!box.heightKey || !(height > 0)) return;
  box.heldHeight = height;
  keepHeight(box.heightKey, height);
}

/** Watch a block's box as long as it is drawn: each height it takes is kept for its block. */
export function holdHeight(box, widget) {
  box.heightKey = widget.heightKey();
  if (typeof ResizeObserver !== 'function') return;
  watcher ??= new ResizeObserver((entries) => {
    for (const entry of entries) measured(entry.target, entry.borderBoxSize?.[0]?.blockSize ?? entry.target.getBoundingClientRect().height);
  });
  watcher.observe(box);
}

/** A box kept for another block (`updateDOM`): its height is kept for that one too, until it measures otherwise. */
export function moveHeight(box, widget) {
  const key = widget.heightKey();
  if (key === box.heightKey) return;
  box.heightKey = key;
  if (box.heldHeight) keepHeight(key, box.heldHeight);
}

/** The box is taken out of the page: no longer watched. */
export function releaseHeight(box) {
  watcher?.unobserve(box);
}

/** The height a block was last drawn at, or null when none like it was drawn. */
export function heldHeight(widget) {
  return heights.get(widget.heightKey()) ?? null;
}

/** Forget every height kept (a test). */
export function forgetHeights() {
  heights.clear();
}

// -- the lines whose height is not the note's ------------------------------------------------

/** How long a line CodeMirror reads its line height from may be (`measureTextSize`). */
export const SAMPLED_LINE = 20;
/** What a line of another size stands in: a heading, code, a raw table, a comment. */
const SIZED = /^(?:ATXHeading\d|SetextHeading\d|FencedCode|CodeBlock|Table|CommentBlock|HTMLBlock)$/;
/**
 * What reads as such a line before the note is parsed: a heading, a `:::`, code or table
 * line (shown in small type), a setext underline. The parse, once there, finds the lines
 * of a code block too.
 */
const SIZED_LINE = /^\s{0,3}(?:#{1,6}(?:\s|$)|:::|```|~~~|\||(?:=+|-+)\s*$)/;
const unread = Decoration.mark({ class: 'cm-unsampled' });

/** Whether the line at `from` is set in another size than the note's text. */
function sized(state, tree, line) {
  if (SIZED_LINE.test(line.text)) return true;
  for (let node = tree.resolveInner(line.from + (line.text.length - line.text.trimStart().length), 1); node; node = node.parent) {
    if (SIZED.test(node.name)) return true;
  }
  return false;
}

/** Each short line drawn and set in another size, marked: those in view, and the cursor's, drawn wherever it is. */
function unsampled(view) {
  const marks = new Map();
  const tree = syntaxTree(view.state);
  const { main } = view.state.selection;
  const ranges = [...view.visibleRanges, { from: main.anchor, to: main.anchor }, { from: main.head, to: main.head }];
  for (const { from, to } of ranges) {
    for (let at = from; at <= to;) {
      const line = view.state.doc.lineAt(at);
      if (line.length && line.length <= SAMPLED_LINE && sized(view.state, tree, line)) marks.set(line.from, unread.range(line.from, line.to));
      at = line.to + 1;
    }
  }
  return Decoration.set([...marks.values()], true);
}

/** The marks that keep a heading, code or a raw table from setting the note's line height. */
export const steadyLines = ViewPlugin.fromClass(class {
  constructor(view) {
    this.decorations = unsampled(view);
  }

  update(update) {
    if (update.docChanged || update.viewportChanged || update.selectionSet || syntaxTree(update.startState) !== syntaxTree(update.state)) {
      this.decorations = unsampled(update.view);
    }
  }
}, { decorations: (plugin) => plugin.decorations });
