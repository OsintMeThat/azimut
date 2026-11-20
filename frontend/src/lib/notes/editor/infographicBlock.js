/**
 * An infographic: a `:::: infographic` block (`engine/notes_infographic.py`), drawn as its
 * page, the server's own drawing of it (`POST notes/infographic`), so the editor shows what
 * the PDF and the picture show. A press on a panel, or on Edit, opens the builder beside the
 * note (`tools/notebook/InfographicBuilder.svelte`), a chart's or a map's settings card open
 * at the panel pressed; its `</>` opens the source.
 *
 * Under its head, the **Data** line: what `data:` names, its rows, how many panels read it
 * and whether it changed since (`editor/infographicData.js`), then *Read again (all panels)*
 * and *Change…* (the source picker, `components/DataPicker.svelte`), each one change and one
 * Undo. It is said again as the note changes, and read afresh when the block comes back into
 * sight (the Notebook shown again, a sheet edited in the Sheet tool meanwhile) or the window
 * does (a sheet edited in Excel).
 *
 * A point, a line or an area drawn on a map, in the builder's map panel or on a map of the
 * note, is case data rather than a line of the page: the pages holding a map panel are drawn
 * again (`onMapsTouched`), the drawing they had kept till the new one comes.
 */
import { isolateHistory } from '@codemirror/commands';
import { ViewPlugin } from '@codemirror/view';

import { api } from '../../api.js';
import { onMapsTouched } from '../mapSettings.svelte.js';
import { registerBlock } from './blocks.js';
import { dataLabel, dataSaid, dataState } from './infographicData.js';
import {
  INFOGRAPHIC_CLOSE, INFOGRAPHIC_OPEN, dataOf, infographicsIn, inheritingPanels, readInfographic, withDataRows, withDataSource,
} from './infographicText.js';
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

/** A map panel's opening fence, in a block's text. */
const MAP_PANEL = /^:::[ \t]*map[ \t]*$/m;

/** Forget the pages drawn of blocks holding a map, whose layers changed under them. */
function forgetMapPages() {
  for (const key of [...drawings.keys()]) if (MAP_PANEL.test(JSON.parse(key)[2])) drawings.delete(key);
}
// heard before any page drawn again asks, so each is asked afresh (`watchData`)
onMapsTouched(forgetMapPages);

/** The page a block draws, asked once per source and kept. */
export function drawingOf(caseId, noteId, source) {
  const key = JSON.stringify([caseId, noteId ?? '', source]);
  if (!drawings.has(key)) {
    // where the rows came from is the Data line's to say, as the note is typed
    const asked = api.post(`/api/cases/${encodeURIComponent(caseId)}/notes/infographic`, {
      text: source, note: noteId && noteId !== 'case' ? noteId : '', format: 'json', origins: false,
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
  const data = el('div', 'cm-ig-data');
  box.append(head, data, page);
  box.igData = new DataLine(data, box, widget, view);
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
  drawPage(page, widget, builds);
  // drawn again when a map it shows changed, the page it had kept till then
  if (MAP_PANEL.test(widget.source)) box.igRedraw = () => drawPage(page, widget, builds);
}

/** The page drawn in `page`, its panels' boxes over it. */
function drawPage(page, widget, builds) {
  const asked = drawingOf(widget.info?.caseId, widget.info?.noteId, widget.source);
  page.igAsked = asked;
  asked.then((drawn) => {
    if (page.igAsked !== asked) return;
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

/** The infographic drawn in `box` as the note holds it now, `{ from, to, source }`, or null. */
function blockOf(view, box) {
  let from;
  try {
    from = view.posAtDOM(box);
  } catch {
    return null;
  }
  return infographicsIn(view.state.doc.toString()).find((one) => one.from === from) ?? null;
}

/** Write the infographic in `box` again with `change(source)`, as one change and one Undo. */
function rewrite(view, box, change) {
  const one = blockOf(view, box);
  if (!one) return false;
  const next = change(one.source);
  return next !== one.source && replaceBlock(view, one.from, one.to, next, one.source);
}

/** What the note says of a block's data, said again whenever asked. */
class DataLine {
  constructor(node, box, widget, view) {
    this.node = node;
    this.box = box;
    this.widget = widget;
    this.view = view;
    this.asked = 0;
    this.state = null;
    // no empty frame while the data is read
    node.hidden = true;
    this.refresh();
    // the Notebook stays mounted while another tool is shown: back in sight, the data is read afresh
    this.seen = typeof IntersectionObserver === 'undefined' ? null : new IntersectionObserver((entries) => {
      if (!this.box.isConnected) this.seen.disconnect();
      else if (this.state && entries.some((entry) => entry.isIntersecting)) void this.refresh({ fresh: true });
    });
    this.seen?.observe(box);
  }

  get handlers() {
    return this.view.state.facet(noteHandlers);
  }

  get writable() {
    return this.widget.writable && !this.view.state.readOnly;
  }

  ask(fresh = false) {
    const noteId = this.handlers.noteId ?? '';
    return dataState({ caseId: this.widget.info?.caseId, noteId, noteText: this.view.state.doc.toString(), source: this.widget.source, fresh });
  }

  async refresh({ fresh = false } = {}) {
    const run = ++this.asked;
    if (!this.widget.info?.caseId || (!dataOf(this.widget.source) && !this.writable)) {
      this.node.hidden = true;
      return;
    }
    const state = await this.ask(fresh).catch((error) => ({ data: { error: error?.message ?? String(error) }, panels: { inheriting: [], own: [], differs: [] } }));
    if (run !== this.asked || !this.node.isConnected) return;
    this.state = state;
    this.render();
  }

  render() {
    const { data, panels } = this.state;
    const parts = [el('span', 'cm-ig-data-word', 'Data')];
    const name = el('span', `cm-ig-data-name${data && !data.found ? ' cm-ig-data-gone' : ''}`, data ? dataLabel(data) : 'None');
    parts.push(name, el('span', 'cm-ig-data-said', dataSaid(data, panels)));
    if (this.writable && data?.found && panels.differs.length) {
      parts.push(act('again', 'Read again (all panels)', `Copy the rows of ${dataLabel(data)} into the ${panels.inheriting.length} panels that read it`, 'cm-ig-data-strong'));
    }
    if (this.writable && this.handlers.pickData && this.widget.info?.caseId) {
      parts.push(act('change', data ? 'Change…' : 'Choose data…', 'A sheet of the case, a table of this note, or new data'));
    }
    this.node.hidden = false;
    this.node.replaceChildren(...parts);
  }

  /** Read again (all panels): the data's rows, read now, into every panel that takes it, as one change. */
  async readAgain() {
    const state = await this.ask(true);
    this.state = state;
    if (!state.data?.found) {
      this.render();
      return;
    }
    rewrite(this.view, this.box, (source) => withDataRows(source, state.data.text, inheritingPanels(source, state.data.columns)));
  }

  /** Change…: the source picker under the press; the one picked is the page's data, as one change. */
  change(anchor) {
    this.handlers.pickData?.({
      anchor,
      current: dataOf(this.widget.source),
      onpick: ({ origin, data }) => {
        if (origin && data?.text) rewrite(this.view, this.box, (source) => withDataSource(source, origin, data.text).text);
      },
    });
  }
}

function act(name, label, title, extra = '') {
  const node = el('button', `cm-ig-data-act${extra ? ` ${extra}` : ''}`, label);
  node.type = 'button';
  node.dataset.igAct = name;
  node.title = title;
  return node;
}

/** A Data line's button pressed: Read again (all panels), or Change…. */
function dataAct(acting, box) {
  if (acting.dataset.igAct === 'again') void box.igData?.readAgain();
  else if (acting.dataset.igAct === 'change') box.igData?.change(acting);
}

/** A press on Edit or on a panel: the builder opens beside the note, at that panel; on the Data line, its act. */
function press(target, box, view) {
  const acting = target.closest('[data-ig-act]');
  if (acting) {
    dataAct(acting, box);
    return;
  }
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
  '.cm-ig-data': {
    display: 'flex', alignItems: 'baseline', flexWrap: 'wrap', gap: '4px 10px', margin: '-2px 0 8px', padding: '6px 10px',
    border: '1px solid var(--border)', borderRadius: '5px', background: 'var(--bg-1)', fontSize: '0.8em', lineHeight: '1.4',
  },
  '.cm-ig-data[hidden]': { display: 'none' },
  '.cm-ig-data-word': { color: 'var(--text-3)', fontWeight: '650', letterSpacing: '0.06em', textTransform: 'uppercase', fontSize: '0.88em' },
  '.cm-ig-data-name': { color: 'var(--text-1)', fontWeight: '600' },
  '.cm-ig-data-gone': { color: 'var(--danger)' },
  '.cm-ig-data-said': { flex: '1 1 auto', color: 'var(--text-2)' },
  '.cm-ig-data-act': {
    padding: '1px 9px', border: '1px solid var(--border-strong)', borderRadius: '4px', background: 'var(--bg-3)', color: 'var(--text-1)',
    font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-ig-data-act:hover, .cm-ig-data-act:focus-visible': { borderColor: 'var(--accent)', color: 'var(--accent)' },
  '.cm-ig-data-strong': { borderColor: 'color-mix(in srgb, var(--accent) 55%, transparent)', background: 'var(--accent-soft)', fontWeight: '600' },
  '.cm-ig-frame': { position: 'relative', lineHeight: '0' },
  '.cm-ig-frame > svg': { display: 'block', width: '100%', height: 'auto' },
  '.cm-ig-hit': {
    position: 'absolute', margin: '0', padding: '0', border: '1.5px dashed transparent', borderRadius: '4px', background: 'transparent',
    cursor: 'pointer',
  },
  '.cm-ig-hit:hover, .cm-ig-hit:focus-visible': { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 6%, transparent)' },
  '.cm-ig-empty': { margin: '0', padding: '18px 6px', color: 'var(--text-3)', fontSize: '0.85em', lineHeight: '1.4' },
};

/** Each infographic's Data line says again what it reads: soon after the note changes, and when the window comes back. */
const watchData = ViewPlugin.fromClass(class {
  constructor(view) {
    this.view = view;
    this.timer = null;
    this.back = () => this.each({ fresh: true });
    window.addEventListener('focus', this.back);
    this.stop = onMapsTouched(() => this.redraw());
  }

  /** The pages with a map panel drawn again: a map's layer changed under them. */
  redraw() {
    for (const box of this.view.contentDOM.querySelectorAll('.cm-block-infographic')) box.igRedraw?.();
  }

  each(options) {
    for (const box of this.view.contentDOM.querySelectorAll('.cm-block-infographic')) void box.igData?.refresh(options);
  }

  update(update) {
    if (!update.docChanged) return;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.each(), 300);
  }

  destroy() {
    clearTimeout(this.timer);
    window.removeEventListener('focus', this.back);
    this.stop();
  }
});

registerBlock({
  name: 'infographic',
  // four colons: the blocks inside keep their own three, and are drawn as its panels
  fence: INFOGRAPHIC_OPEN,
  close: INFOGRAPHIC_CLOSE,
  widget: blockWidget,
  draw: (box, widget, view) => drawInfographic(box, widget, view),
  bar: '.cm-ig-edit, .cm-ig-hit, .cm-ig-data-act',
  press,
  listen: (box) => {
    // a keyboard's Enter on the Data line's buttons, which the mouse presses on its way down
    box.addEventListener('click', (event) => {
      const acting = event.detail === 0 ? event.target.closest?.('[data-ig-act]') : null;
      if (acting) dataAct(acting, box);
    });
  },
  extensions: [watchData],
  atomic: true,
  height: 900,
  theme: THEME,
});
