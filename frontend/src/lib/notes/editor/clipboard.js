/**
 * Copying from the drawn page and pasting into it.
 *
 * A copy puts two things on the clipboard: the Markdown of what is selected as plain
 * text, its marks closed where the selection cuts them and a line's own marks kept
 * when the line is taken whole, so a paste back into a note is the same note; and the
 * page it makes as HTML, so a paste into Word or Google Docs keeps the headings, the
 * bold, the links and the lists. A chip goes there as its name.
 *
 * A paste of a web page's or a document's HTML is written as Markdown
 * (`htmlMarkdown.js`); a paste of what a note copied, or of words alone, is left to the
 * editor, as are pictures, a lone address and a table (each read by its own paste).
 */
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { ensureSyntaxTree, syntaxTree } from '@codemirror/language';

import { markdownHtml } from '../../markdown.js';
import { markSpans, wordsStart } from './caret.js';
import { drawn } from './decorations.js';
import { readHtml } from './htmlMarkdown.js';
import { noteCase } from './state.js';

/** The mark a note's own copy wears in its HTML, so a paste back reads its Markdown. */
const OWN = 'data-azimut-note';

/**
 * The Markdown of `from`–`to` as a copy carries it: the marks of words the selection
 * cuts closed on its side of the cut, the marks of words it holds none of left out, and
 * the marks of a line whose words it takes whole (`## `, `- `) kept.
 */
export function copiedMarkdown(state, from, to) {
  const line = state.doc.lineAt(from);
  if (from <= wordsStart(state, line) && to >= line.to) from = line.from;
  const drop = [];
  let before = '';
  let after = '';
  const spans = markSpans(state, from, to).sort((a, b) => a.open[0] - b.open[0]);
  for (const span of spans) {
    const holds = Math.max(from, span.open[1]) < Math.min(to, span.close[0]);
    if (!holds) {
      for (const mark of [span.open, span.close]) if (mark[0] >= from && mark[1] <= to) drop.push(mark);
      continue;
    }
    if (from > span.open[0]) before += state.sliceDoc(span.open[0], span.open[1]);
    if (to < span.close[1]) after = state.sliceDoc(span.close[0], span.close[1]) + after;
  }
  let text = '';
  let at = from;
  for (const [gone, end] of drop.sort((a, b) => a[0] - b[0])) {
    text += state.sliceDoc(at, gone);
    at = end;
  }
  text += state.sliceDoc(at, to);
  return `${before}${text}${after}`;
}

/** Whether `pos` is in code, where a paste stays as written. */
function inCode(state, pos) {
  const tree = ensureSyntaxTree(state, Math.min(state.doc.length, pos + 1), 100) ?? syntaxTree(state);
  for (let node = tree.resolveInner(pos, -1); node; node = node.parent) {
    if (['FencedCode', 'CodeBlock', 'InlineCode', 'CommentBlock', 'HTMLBlock'].includes(node.name)) return true;
  }
  return false;
}

/** The HTML of copied Markdown for another program: a chip as its name, the case's files at this app's address. */
export function copiedHtml(state, markdown) {
  const info = state.field(noteCase, false);
  const html = markdownHtml(markdown, { entities: info ? [...info.byId.values()] : [], caseId: info?.caseId ?? '', redirects: info?.redirects ?? {}, identity: info?.identity })
    .replace(/<a\b[^>]*\bdata-entity-id="[^"]*"[^>]*>([\s\S]*?)<\/a>/g, '$1');
  const origin = globalThis.location?.origin ?? '';
  const placed = origin ? html.replace(/\b(src|href)="\/(?!\/)/g, `$1="${origin}/`) : html;
  return `<div ${OWN}="1">${placed}</div>`;
}

/** The Markdown of every range selected, one after the other. */
function selectedMarkdown(state) {
  return state.selection.ranges.filter((range) => !range.empty).map((range) => copiedMarkdown(state, range.from, range.to)).join(state.lineBreak);
}

function putOnClipboard(event, state) {
  const text = selectedMarkdown(state);
  if (!text || !event.clipboardData) return false;
  event.clipboardData.clearData();
  event.clipboardData.setData('text/plain', text);
  event.clipboardData.setData('text/html', copiedHtml(state, text));
  event.preventDefault();
  return true;
}

/** Copy, cut and paste on the drawn page. */
export const pageClipboard = EditorView.domEventHandlers({
  copy(event, view) {
    if (!view.state.field(drawn, false)) return false;
    return putOnClipboard(event, view.state);
  },
  cut(event, view) {
    if (!view.state.field(drawn, false) || !putOnClipboard(event, view.state)) return false;
    if (!view.state.readOnly) view.dispatch(view.state.replaceSelection(''), { userEvent: 'delete.cut', scrollIntoView: true });
    return true;
  },
  paste(event, view) {
    const data = event.clipboardData;
    const { state } = view;
    if (!data || state.readOnly || !state.field(drawn, false)) return false;
    if ([...(data.items ?? [])].some((item) => item.type.startsWith('image/'))) return false;
    const html = data.getData('text/html');
    const plain = data.getData('text/plain') ?? '';
    if (!html || html.includes(OWN) || /^\s*https?:\/\/\S+\s*$/i.test(plain)) return false;
    const range = state.selection.main;
    if (inCode(state, range.from)) return false;
    const { markdown, formatted } = readHtml(html);
    // words alone: the editor's own paste writes them as they are, Markdown typed elsewhere included
    if (!markdown || !formatted) return false;
    event.preventDefault();
    view.dispatch({
      changes: { from: range.from, to: range.to, insert: markdown },
      selection: EditorSelection.cursor(range.from + markdown.length),
      userEvent: 'input.paste',
      scrollIntoView: true,
    });
    return true;
  },
});
