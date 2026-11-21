/**
 * An infographic: a `:::: infographic` block (`engine/notes_infographic.py`), drawn as its
 * page, the server's own drawing of it (`POST notes/infographic`), so the editor shows what
 * the PDF and the picture show. A press on a panel, or on Edit, opens the builder beside the
 * note (`tools/notebook/InfographicBuilder.svelte`), a chart's or a map's settings card open
 * at the panel pressed; its `</>` opens the source.
 *
 * Under its head, the **Data** line, said as a chart's is (`editor/dataLine.js`): what
 * `data:` names and the press that edits it there (*Open in Sheet*, *Go to the table*), its
 * rows and how many panels read it (`editor/infographicData.js`), then *Change…* (the source
 * picker, `components/DataPicker.svelte`), one change and one Undo. It is said again as the
 * note changes, and read afresh when the block comes back into sight (the Notebook shown
 * again, a sheet edited in the Sheet tool meanwhile) or the window does (a sheet edited in
 * Excel). The panels that take the data, and a panel with a source of its own, follow it by
 * themselves (`editor/follow.js`): one step Undo takes back.
 *
 * A point, a line or an area drawn on a map, in the builder's map panel or on a map of the
 * note, is case data rather than a line of the page: the pages holding a map panel are drawn
 * again (`onMapsTouched`), the drawing they had kept till the new one comes.
 */
import { isolateHistory } from '@codemirror/commands';
import { ViewPlugin } from '@codemirror/view';
import { infographicSeed } from '../dataSeed.js';

import { api } from '../../api.js';
import { onMapsTouched } from '../mapSettings.svelte.js';
import { registerBlock } from './blocks.js';
import { compareRows, readChart } from './chartText.js';
import { LOCAL, SHEET, drawDataLine, sourceOf } from './dataLine.js';
import { followChanges, followSource, heldBack, settled } from './follow.js';
import { tablesOf } from './gridEdits.js';
import { dataSaid, dataState, pageWords, readData } from './infographicData.js';
import { INFOGRAPHIC_CLOSE, INFOGRAPHIC_OPEN, dataOf, infographicsIn, ownSourcePanels, panelText, readInfographic, withDataSource } from './infographicText.js';
import { noteHandlers } from './state.js';
import { applyChanges } from './tableText.js';
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
  // drawn again when a map it shows changed, the page it had kept till then; a view that cannot write draws the fresh rows
  box.igRedraw = (source = widget.source) => drawPage(page, widget, builds, source);
}

/** The page drawn in `page`, its panels' boxes over it: `source`, the block's own text unless a read-only view drew fresh rows in. */
function drawPage(page, widget, builds, source = widget.source) {
  const asked = drawingOf(widget.info?.caseId, widget.info?.noteId, source);
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

/** What the note says of a block's data, said again whenever asked; the panels that read it follow it. */
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

  get noteId() {
    return this.handlers.noteId ?? '';
  }

  ask(fresh = false) {
    return dataState({ caseId: this.widget.info?.caseId, noteId: this.noteId, noteText: this.view.state.doc.toString(), source: this.widget.source, fresh });
  }

  async refresh({ fresh = false } = {}) {
    const run = ++this.asked;
    if (!this.widget.info?.caseId || (!dataOf(this.widget.source) && !this.writable && !ownSourcePanels(this.widget.source).length)) {
      this.node.hidden = true;
      return;
    }
    const state = await this.ask(fresh).catch((error) => ({ data: { error: error?.message ?? String(error) }, panels: { inheriting: [], own: [], differs: [] } }));
    if (run !== this.asked || !this.node.isConnected) return;
    this.state = state;
    this.render();
    await this.follow(state, fresh, run);
  }

  /**
   * The panels that read the data, and each panel with a source of its own, follow what they
   * read: the note rewritten as one step (`followSource`); a view that cannot write draws the
   * fresh rows instead.
   */
  async follow(state, fresh, run) {
    const sources = [];
    const origin = dataOf(this.widget.source);
    if (state.data?.found) sources.push({ origin, text: state.data.text, differs: state.panels.differs.length > 0 });
    const read = readInfographic(this.widget.source);
    const own = [...new Set(ownSourcePanels(this.widget.source).map((index) => read.panels[index].origin.trim()))];
    for (const one of own) {
      const data = await readData({ caseId: this.widget.info?.caseId, noteId: this.noteId, noteText: this.view.state.doc.toString(), origin: one, fresh })
        .catch(() => null);
      if (run !== this.asked) return;
      if (!data?.found) continue;
      const differs = ownSourcePanels(this.widget.source).some((index) => {
        if (read.panels[index].origin.trim() !== one) return false;
        const { table } = readChart(panelText(this.widget.source, index));
        return table && compareRows(table, data.table) === 'differs';
      });
      sources.push({ origin: one, text: data.text, differs });
    }
    let shown = this.widget.source;
    for (const source of sources) {
      if (!source.differs) settled(this.view, source.origin, source.text);
      else if (this.writable) followSource(this.view, source.origin, source.text);
      else shown = applyChanges(shown, followChanges(shown, source.origin, source.text));
    }
    if (shown !== this.widget.source) this.box.igRedraw?.(shown);
  }

  render() {
    const { data, panels } = this.state;
    const origin = dataOf(this.widget.source);
    const { mode, id } = sourceOf(origin, this.noteId);
    const held = Boolean(data?.found && panels.differs.length && this.writable && heldBack(this.view, origin, data.text));
    const words = pageWords(origin, data, { noteId: this.noteId, held });
    const canAct = (act) => (act === 'sheet' ? Boolean(this.handlers.inCase && this.handlers.open)
      : act === 'table' ? (mode === LOCAL ? data?.found : Boolean(this.handlers.note)) : false);
    drawDataLine(this.node, words, {
      prefix: 'cm-ig',
      act: words.act && canAct(words.act.id) ? (act) => this.act(act, { mode, id, data }) : null,
      said: dataSaid(data, panels),
      change: this.writable && this.handlers.pickData && this.widget.info?.caseId ? (anchor) => this.change(anchor) : null,
      changeLabel: data ? 'Change…' : 'Choose data…',
    });
    this.node.hidden = false;
  }

  /** Open in Sheet, or Go to the table: where the page's rows live. */
  act(id, { mode, id: where, data }) {
    if (id === 'sheet') this.handlers.open?.({ id: where, type: 'sheet' });
    else if (mode === LOCAL) {
      const found = tablesOf(this.view.state).find((table) => table.line === data?.line);
      if (!found) return;
      this.view.dispatch({ selection: { anchor: found.from }, scrollIntoView: true });
      this.view.focus();
    } else if (mode !== SHEET) this.handlers.note?.(where);
  }

  /** Change…: the source picker under the press; the one picked is the page's data, as one change. */
  change(anchor) {
    this.handlers.pickData?.({
      anchor,
      current: dataOf(this.widget.source),
      seed: infographicSeed(this.widget.source),
      onpick: ({ origin, data }) => {
        if (origin && data?.text) rewrite(this.view, this.box, (source) => withDataSource(source, origin, data.text).text);
      },
    });
  }
}

/** A press on Edit or on a panel: the builder opens beside the note, at that panel; the Data line's presses act on their click. */
function press(target, box, view) {
  if (target.closest('.cm-ig-data')) return;
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
  '.cm-ig-data-dot': { color: 'var(--text-3)' },
  '.cm-ig-data-state': { color: 'var(--warn)' },
  '.cm-ig-data-said': { color: 'var(--text-2)' },
  '.cm-ig-data-spring': { flex: '1' },
  '.cm-ig-use': {
    padding: '0', border: 'none', background: 'none', color: 'var(--info)', font: 'inherit', cursor: 'pointer', textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--info) 40%, transparent)', textUnderlineOffset: '2px', whiteSpace: 'nowrap',
  },
  '.cm-ig-use:hover, .cm-ig-use:focus-visible': { color: 'var(--text-1)', outline: 'none' },
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
  bar: '.cm-ig-edit, .cm-ig-hit, .cm-ig-use',
  press,
  extensions: [watchData],
  atomic: true,
  height: 900,
  theme: THEME,
});
