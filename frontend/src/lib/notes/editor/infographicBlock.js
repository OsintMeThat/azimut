/**
 * An infographic: a `:::: infographic` block (`engine/notes_infographic.py`), drawn as its
 * page, the server's own drawing of it (`POST notes/infographic`), so the editor shows what
 * the PDF and the picture show. A press on a panel, or on Edit, opens the builder beside the
 * note (`tools/notebook/InfographicBuilder.svelte`) at that panel; its `</>` opens the source.
 */
import { isolateHistory } from '@codemirror/commands';

import { api } from '../../api.js';
import { registerBlock } from './blocks.js';
import { INFOGRAPHIC_CLOSE, INFOGRAPHIC_OPEN, readInfographic } from './infographicText.js';
import { noteHandlers } from './state.js';
import { blockWidget } from './widgets.js';

/**
 * Replace `from`–`to` with `insert` as one change and its own Undo step, when that stretch
 * still reads `expected`: what the builder writes. Answers whether it landed.
 */
export function replaceBlock(view, from, to, insert, expected) {
  const { state } = view;
  if (state.readOnly || from < 0 || to > state.doc.length || from > to) return false;
  if (expected !== undefined && state.sliceDoc(from, to) !== expected) return false;
  view.dispatch(state.update({ changes: { from, to, insert }, userEvent: 'input.infographic', annotations: isolateHistory.of('full') }));
  return true;
}

/** Drawings kept by what they draw, so typing elsewhere in the note never draws one again. */
const drawings = new Map();
const KEPT = 24;

/** Panel names as the builder says them. */
const PANEL_WORDS = { chart: 'Chart', map: 'Map', words: 'Words' };

/** The page a block draws, asked once per source and kept. */
export function drawingOf(caseId, noteId, source) {
  const key = JSON.stringify([caseId, noteId ?? '', source]);
  if (!drawings.has(key)) {
    const asked = api.post(`/api/cases/${encodeURIComponent(caseId)}/notes/infographic`, {
      text: source, note: noteId && noteId !== 'case' ? noteId : '', format: 'json',
    }).catch((error) => ({ error: error?.message ?? String(error) }));
    drawings.set(key, asked);
    if (drawings.size > KEPT) drawings.delete(drawings.keys().next().value);
  }
  return drawings.get(key);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** The block drawn: a bar saying what it is, then the page with a press-able box over each panel. */
function drawInfographic(box, widget, view) {
  const read = readInfographic(widget.source);
  // the builder is the Notebook's: where there is none (the note pinned to the side), the page is only drawn
  const builds = widget.writable && Boolean(view?.state.facet(noteHandlers).infographic);
  const head = el('div', 'cm-ig-head');
  const count = read.panels.length;
  head.append(el('span', 'cm-ig-said', `Infographic · ${count} panel${count === 1 ? '' : 's'}`));
  if (builds) {
    const edit = el('button', 'cm-ig-edit', 'Edit');
    edit.type = 'button';
    edit.dataset.igEdit = 'true';
    edit.title = 'Open the builder beside the note';
    head.append(edit);
  }
  const page = el('div', 'cm-ig-page');
  box.append(head, page);
  const caseId = widget.info?.caseId;
  if (!count) {
    page.append(el('p', 'cm-ig-empty', 'No panel yet. Edit adds a chart, from a table of this note or from scratch, a map or words.'));
    return;
  }
  if (!caseId) {
    page.append(el('p', 'cm-ig-empty', 'Drawn once the note is in a case.'));
    return;
  }
  page.append(el('p', 'cm-ig-empty', 'Drawing the infographic…'));
  drawingOf(caseId, widget.info?.noteId, widget.source).then((drawn) => {
    page.replaceChildren();
    if (!drawn || drawn.error) {
      page.append(el('p', 'cm-ig-empty', `Not drawn: ${drawn?.error ?? 'no answer'}`));
      return;
    }
    const frame = el('div', 'cm-ig-frame');
    frame.innerHTML = drawn.svg;
    frame.querySelector('svg')?.removeAttribute('width');
    frame.querySelector('svg')?.removeAttribute('height');
    for (const panel of drawn.panels ?? []) {
      const hit = el('button', 'cm-ig-hit');
      hit.type = 'button';
      hit.dataset.igPanel = String(panel.index);
      const kind = panel.chart ? `${panel.chart[0].toUpperCase()}${panel.chart.slice(1)}` : PANEL_WORDS[panel.kind] ?? panel.kind;
      hit.title = `${panel.title ? `${panel.title} · ` : ''}${kind} · ${panel.width === 'wide' ? 'Wide' : 'Half'}${builds ? ' · press to edit' : ''}`;
      hit.setAttribute('aria-label', hit.title);
      hit.style.left = `${(panel.x / drawn.width) * 100}%`;
      hit.style.top = `${(panel.y / drawn.height) * 100}%`;
      hit.style.width = `${(panel.w / drawn.width) * 100}%`;
      hit.style.height = `${(panel.h / drawn.height) * 100}%`;
      if (!builds) hit.disabled = true;
      frame.append(hit);
    }
    page.append(frame);
  });
}

/** A press on Edit or on a panel: the builder opens beside the note, at that panel. */
function press(target, box, view) {
  const open = view.state.facet(noteHandlers).infographic;
  if (!open) return;
  const from = view.posAtDOM(box);
  const panel = target.closest('[data-ig-panel]');
  open({ from, panel: panel ? Number(panel.dataset.igPanel) : null });
}

const THEME = {
  '.cm-block-infographic': {
    margin: '4px var(--note-gutter, 32px)', padding: '8px 12px 12px', border: '1px solid var(--border)', borderRadius: '6px',
    background: 'var(--bg-2)',
  },
  '.cm-block-infographic > .cm-source-edit': { right: '6px' },
  '.cm-ig-head': { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' },
  '.cm-ig-said': {
    flex: '1', color: 'var(--text-3)', fontSize: '0.7em', fontWeight: '650', letterSpacing: '0.06em', textTransform: 'uppercase',
  },
  '.cm-ig-edit': {
    marginRight: '30px', padding: '2px 10px', border: '1px solid var(--border-strong)', borderRadius: '4px',
    background: 'var(--bg-3)', color: 'var(--text-1)', font: 'inherit', fontSize: '0.8em', cursor: 'pointer',
  },
  '.cm-ig-edit:hover, .cm-ig-edit:focus-visible': { borderColor: 'var(--accent)', color: 'var(--accent)' },
  '.cm-ig-page': { borderRadius: '4px', overflow: 'hidden' },
  '.cm-ig-frame': { position: 'relative', lineHeight: '0' },
  '.cm-ig-frame > svg': { display: 'block', width: '100%', height: 'auto' },
  '.cm-ig-hit': {
    position: 'absolute', margin: '0', padding: '0', border: '1.5px dashed transparent', borderRadius: '4px', background: 'transparent',
    cursor: 'pointer',
  },
  '.cm-ig-hit:hover, .cm-ig-hit:focus-visible': { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-ig-empty': { margin: '0', padding: '18px 6px', color: 'var(--text-3)', fontSize: '0.85em', lineHeight: '1.4' },
};

registerBlock({
  name: 'infographic',
  // four colons: the blocks inside keep their own three, and are drawn as its panels
  fence: INFOGRAPHIC_OPEN,
  close: INFOGRAPHIC_CLOSE,
  widget: blockWidget,
  draw: (box, widget, view) => drawInfographic(box, widget, view),
  bar: '.cm-ig-edit, .cm-ig-hit',
  press,
  atomic: true,
  height: 900,
  theme: THEME,
});
