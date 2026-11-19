/**
 * A diagram: a closed ```mermaid fence, drawn by Mermaid in this tab. Open, its lines
 * are code.
 *
 * - **Made from scratch**: `/` › Diagram opens the gallery of six kinds, each drawn
 *   small with what it needs (`editor/diagramForm.js`); the one picked is written at the
 *   cursor and opens in its form, the drawing beside it. From the case, a network from the
 *   Graph or a timeline from the Timeline, listed before they are written. *Write it
 *   yourself* writes plain Mermaid and opens it as code.
 * - **Its bar**: the kind it is (the gallery again, to draw it as another kind that keeps
 *   its boxes), *Edit* (the form), and `</>` (its Mermaid, for those who know it). Mermaid
 *   the form cannot read (`editor/diagramText.js`) keeps its bar with a line saying so, and
 *   opens as its source.
 * - **Every choice in the form writes the fence's lines**, the changed ones only, one Undo
 *   step a gesture.
 *
 * A diagram is drawn once per source and kept, so typing elsewhere does not draw it again.
 * The legend and a Dark diagram's page are drawn with it (`lib/mermaid.js`), so the editor,
 * the PDF, the HTML page and WordPress show the same.
 */
import { isolateHistory, undo, undoDepth } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

import { renderMermaidSvg } from '../../mermaid.js';
import { entityLabel, loadEntityTypes } from '../../entityTypes.svelte.js';
import { MAX_COLOUR_NAME, MAX_PALETTE, layerPalette } from '../../map/layerPalette.svelte.js';
import { loadRelationTypes, relationVerb } from '../../relations.svelte.js';
import { rovingToolbar } from '../pictureSize.js';
import { DIAGRAM_STARTER } from '../syntax.js';
import { registerBlock } from './blocks.js';
import { diagramForm, openDiagramGallery, openNetworkPanel, openTimelinePanel } from './diagramForm.js';
import { DIAGRAM_KINDS, convertModel, diagramFence, fenceSource, readDiagram, starterModel, withColours, writeDiagram } from './diagramText.js';
import { button } from './gridMenu.js';
import { heldHeight, holdHeight, moveHeight, releaseHeight } from './heights.js';
import { blockAt } from './puts.js';
import { blocksIn, openSource } from './ranges.js';
import { noteCase, noteHandlers } from './state.js';
import { lineChanges } from './tableText.js';
import { BlockWidget, markPicked, sourceButton } from './widgets.js';

/** A diagram's height before it is drawn, in pixels. */
const DIAGRAM_HEIGHT = 220;
/** How wide the frame must be for the form and the drawing to stand side by side. */
const SIDE_BY_SIDE = 860;
/** What the bar says of Mermaid the form cannot read. */
const UNREAD = 'Written in Mermaid the form cannot read: edit its source';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const diagrams = new Map();

/** A diagram drawn once per source and kept: `{ svg, paper }` or `{ error }`. */
function drawn(source) {
  const known = diagrams.get(source);
  if (known) return known;
  const pending = renderMermaidSvg(source)
    .then(({ svg }) => ({ svg, paper: /data-background="(#[0-9a-f]{6})"/.exec(svg)?.[1] ?? '' }))
    .catch((error) => ({ error: String(error?.message ?? error).split('\n')[0] }))
    .then((result) => {
      diagrams.set(source, result);
      if (diagrams.size > 60) diagrams.delete(diagrams.keys().next().value);
      return result;
    });
  diagrams.set(source, pending);
  return pending;
}

/** A diagram in the note, kept on its box (`box.diagram`). */
class DiagramBox {
  constructor(box, widget, view) {
    this.box = box;
    this.view = view;
    this.widget = widget;
    this.source = fenceSource(widget.source);
    this.model = readDiagram(this.source);
    this.form = null;
    this.gone = false;
    this.asked = null;
    box.diagram = this;
    this.build();
    this.draw();
  }

  get info() {
    return this.widget.info;
  }

  get handlers() {
    return this.view.state.facet(noteHandlers);
  }

  get writable() {
    return this.widget.writable && !this.view.state.readOnly;
  }

  /** Where the block stands in the note now, `{ from, to }`, or null once it is gone. */
  range() {
    let from;
    try {
      from = this.view.posAtDOM(this.box);
    } catch {
      return null;
    }
    return blocksIn(this.view.state, from).find((block) => block.from === from && block.kind === 'diagram') ?? null;
  }

  /** The diagram worked on is the one picked: the cursor at its start keeps it drawn while the form has the keyboard. */
  pick() {
    const range = this.range();
    const { main } = this.view.state.selection;
    if (range && !(main.empty && main.head === range.from)) this.view.dispatch({ selection: { anchor: range.from } });
  }

  build() {
    const { box } = this;
    box.className = 'cm-block cm-block-diagram cm-dg-block';
    box.dataset.block = 'diagram';
    this.frame = element('div', 'cm-dg-frame');
    if (this.writable) this.frame.append(this.makeBar());
    this.body = element('div', 'cm-dg-body');
    this.formPanel = element('div', 'cm-dg-form-panel cm-dg-ui');
    this.formPanel.hidden = true;
    this.formPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleForm(false);
      this.editButton?.focus({ preventScroll: true });
    });
    this.figure = element('div', 'cm-dg-figure');
    this.body.append(this.formPanel, this.figure);
    this.frame.append(this.body);
    box.append(this.frame);
    if (!this.writable) box.append(sourceButton(this.view, box));
    // the form takes the room beside the note while it is open, and stands beside the drawing where there is room
    if (typeof ResizeObserver === 'function') {
      this.watch = new ResizeObserver(() => this.fit());
      this.watch.observe(this.view.scrollDOM);
    }
    this.refreshBar();
  }

  makeBar() {
    const bar = element('div', 'cm-dg-bar cm-dg-ui');
    this.bar = bar;
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Diagram');
    const tool = (className, options, run) => {
      const node = button(`cm-dg-tool ${className}`, options);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => {
        this.pick();
        run(node);
      });
      bar.append(node);
      return node;
    };
    this.kindButton = tool('cm-dg-kind', { label: 'Diagram', iconName: 'network', title: 'Draw it as another kind' }, (node) => this.pickKind(node));
    this.editButton = tool('cm-dg-edit', { label: 'Edit', iconName: 'sliders', title: 'Its boxes, links, direction, colours and style' }, () => this.toggleForm());
    this.editButton.setAttribute('aria-pressed', 'false');
    this.unread = element('span', 'cm-dg-unread', UNREAD);
    bar.append(this.unread, element('span', 'cm-dg-spring'));
    const source = button('cm-dg-tool cm-dg-source', { label: 'Edit the source', alone: true, title: 'Edit the source' });
    source.dataset.editSource = 'true';
    source.addEventListener('mousedown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      this.toSource();
    });
    source.addEventListener('click', (event) => {
      if (event.detail === 0) this.toSource();
    });
    bar.append(source);
    rovingToolbar(bar);
    return bar;
  }

  /** The bar says what the diagram is: its kind and Edit, or that the form cannot read it. */
  refreshBar() {
    if (!this.kindButton) return;
    const readable = Boolean(this.model);
    const label = readable ? DIAGRAM_KINDS.find((one) => one.kind === this.model.kind)?.label : '';
    this.kindButton.hidden = !readable;
    this.kindButton.lastChild.textContent = label || 'Diagram';
    this.kindButton.setAttribute('aria-label', label ? `Kind: ${label}` : 'Kind');
    this.kindButton.disabled = readable && this.model.kind === 'timeline';
    this.kindButton.title = readable && this.model.kind === 'timeline' ? 'A timeline is drawn from dated events, which no other kind holds' : 'Draw it as another kind';
    this.editButton.hidden = !readable;
    this.unread.hidden = readable;
  }

  /** The block's lines changed: read them again, draw them again, and the form follows. */
  update(widget) {
    const before = this.widget;
    this.widget = widget;
    const source = fenceSource(widget.source);
    if (source !== this.source || widget.info.caseId !== before.info.caseId) {
      this.source = source;
      this.model = readDiagram(source);
      this.draw();
    }
    this.refreshBar();
    if (this.form) {
      if (this.model) this.form.refresh();
      else this.toggleForm(false);
    }
  }

  draw() {
    const source = this.source;
    const known = diagrams.get(source);
    if (known && !(known instanceof Promise)) {
      this.show(known);
      return;
    }
    // the drawing it had stays, paler, until the new one comes: nothing jumps
    if (!this.figure.querySelector('svg')) this.figure.replaceChildren(element('p', 'cm-dg-said', 'Drawing the diagram…'));
    this.figure.classList.add('cm-dg-loading');
    const asked = drawn(source);
    this.asked = asked;
    asked.then((result) => {
      if (this.gone || this.asked !== asked) return;
      this.show(result);
    });
  }

  show(result) {
    this.asked = null;
    this.figure.classList.remove('cm-dg-loading');
    this.box.classList.toggle('cm-block-failed', Boolean(result.error));
    if (result.svg) {
      // Mermaid's own drawing, drawn strict: its words escaped there
      this.figure.innerHTML = result.svg;
      this.figure.style.background = result.paper || '';
    } else {
      this.figure.style.background = '';
      this.figure.replaceChildren(element('p', 'cm-dg-said cm-dg-failed', `Diagram not drawn: ${result.error}`));
    }
    this.view.requestMeasure();
  }

  // -- writing --

  /** Write `model` as the fence's lines, the changed ones only, as one step Undo takes back. */
  write(model) {
    if (!this.writable) return false;
    const range = this.range();
    if (!range) return false;
    const fence = this.view.state.sliceDoc(range.from, range.to);
    const lines = fence.split('\n');
    const next = [lines[0], writeDiagram(model), lines[lines.length - 1]].join('\n');
    if (next === fence) return false;
    this.view.dispatch({
      changes: lineChanges(fence, next).map((piece) => ({ from: range.from + piece.from, to: range.from + piece.to, insert: piece.insert })),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.diagram')],
    });
    return true;
  }

  /**
   * While the form is open, the frame takes the room the page leaves beside the note's
   * column, and the form stands beside the drawing once the frame is `SIDE_BY_SIDE` wide;
   * above it else (a narrow window, the Page pane open).
   */
  fit() {
    if (this.gone) return;
    this.frame.style.marginLeft = '';
    this.frame.style.marginRight = '';
    let room = 0;
    if (this.form && this.box.isConnected) {
      const scroller = this.view.scrollDOM;
      const page = scroller.getBoundingClientRect();
      const frame = this.frame.getBoundingClientRect();
      const bar = scroller.offsetWidth - scroller.clientWidth;
      room = Math.max(0, Math.floor(Math.min(frame.left - page.left, page.right - bar - frame.right) - 16));
      if (room) {
        this.frame.style.marginLeft = `-${room}px`;
        this.frame.style.marginRight = `-${room}px`;
      }
    }
    // the bar's tools stay where the note's column starts, clear of the block's handle beside it
    if (this.bar) this.bar.style.paddingLeft = room ? `${room + 6}px` : '';
    const wide = Boolean(this.form) && this.frame.getBoundingClientRect().width >= SIDE_BY_SIDE;
    if (wide !== this.box.classList.contains('cm-dg-wide')) {
      this.box.classList.toggle('cm-dg-wide', wide);
      this.view.requestMeasure();
    }
    this.form?.relayout();
  }

  /** Open or close the form, between the bar and the drawing, or beside the drawing where there is room. */
  toggleForm(open = this.formPanel.hidden) {
    if (!this.writable) return;
    if (open && !this.model) {
      this.toSource();
      return;
    }
    if (!open) {
      this.form?.commit();
      this.form?.destroy();
      this.form = null;
      this.formPanel.hidden = true;
      this.formPanel.replaceChildren();
      this.box.classList.remove('cm-dg-editing');
    } else if (!this.form) {
      const caseId = this.info.caseId;
      if (caseId) layerPalette.load(caseId);
      this.formPanel.hidden = false;
      this.box.classList.add('cm-dg-editing');
      this.form = diagramForm(this.formPanel, {
        view: this.view,
        state: () => (this.gone ? null : this.model),
        write: (model) => this.write(model),
        undo: () => {
          this.pick();
          undo(this.view);
        },
        canUndo: () => undoDepth(this.view.state) > 0,
        palette: () => (caseId ? layerPalette.colours : []),
        keep: caseId ? (values) => keepColours(this.view, caseId, values) : null,
        fromCase: caseId ? (which, anchor) => this.fromCase(which, anchor) : null,
        kind: (anchor) => this.pickKind(anchor),
        close: () => {
          this.toggleForm(false);
          this.editButton?.focus({ preventScroll: true });
        },
      });
    }
    this.editButton?.setAttribute('aria-pressed', String(Boolean(open && this.form)));
    this.fit();
    if (open && this.form) this.form.focus();
    this.view.requestMeasure();
  }

  /** The gallery, to draw it as another kind that keeps its boxes; one step. */
  pickKind(anchor) {
    if (!this.model) return;
    openDiagramGallery(this.view, anchor, {
      model: this.model,
      onPick: (kind) => {
        const next = convertModel(this.model, kind);
        if (next) this.write(withColours(next, this.info.caseId ? layerPalette.colours : []));
        if (!this.form) this.toggleForm(true);
      },
    });
  }

  /** The Graph's or the Timeline's panel; what it writes takes the diagram's boxes' place, its title and style kept, as one step. */
  fromCase(which, anchor) {
    const caseId = this.info.caseId;
    if (!caseId) return;
    const onWrite = (made) => {
      const kept = { ...made, title: this.model?.title ?? '', style: this.model?.style ?? 'report' };
      this.write(withColours(kept, layerPalette.colours));
    };
    if (which === 'timeline') openTimelinePanel(this.view, anchor, { caseId, onWrite });
    else openNetworkPanel(this.view, anchor, { caseId, onWrite, ...caseWords() });
  }

  toSource() {
    const range = this.range();
    if (range) openSource(this.view, range);
  }

  destroy() {
    this.gone = true;
    this.watch?.disconnect();
    this.form?.destroy();
  }
}

/** How a type and a link are said, as the Graph says them, the registries read once. */
function caseWords() {
  loadEntityTypes();
  loadRelationTypes();
  return { label: (type) => entityLabel(type), verb: (type) => relationVerb(type) };
}

/** What keeping a diagram's colours says, naming those the case could not take. */
function keptSaid(left = []) {
  if (!left.length) return 'Kept for the case: every chart, map, layer and diagram paints them the same';
  const names = left.map((name) => `“${name.length > 24 ? `${name.slice(0, 23)}…` : name}”`).join(', ');
  return `Kept for the case, but not ${names}: a case names a colour once, ${MAX_PALETTE} at most, in ${MAX_COLOUR_NAME} letters`;
}

/** Name a diagram's colours in the case's palette (`layerPalette.keep`); the toast offers its own Undo. */
async function keepColours(view, caseId, values) {
  const toast = view.state.facet(noteHandlers).tableToast;
  try {
    const { before, left } = await layerPalette.keep(caseId, values);
    refreshForms(view);
    toast?.(keptSaid(left), [{
      label: 'Undo',
      onClick: () => layerPalette.save(caseId, before).then(() => refreshForms(view), (error) => toast?.(`Not undone: ${error.message}`, [], 'warn')),
    }]);
  } catch (error) {
    toast?.(`Colours not kept: ${error.message}`, [], 'warn');
  }
}

function refreshForms(view) {
  for (const box of view.contentDOM.querySelectorAll('.cm-dg-block')) box.diagram?.form?.refresh();
}

/** A diagram drawn in place: its box, its bar and its form kept while its lines change. */
class DiagramWidget extends BlockWidget {
  constructor(spec) {
    super('diagram', spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
  }

  toDOM(view) {
    const box = document.createElement('div');
    // eslint-disable-next-line no-new
    new DiagramBox(box, this, view);
    markPicked(box, this.picked);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.cm-dg-ui, a')) return;
      event.preventDefault();
      // a press picks the diagram, which stays drawn; a double press opens its form, or its source
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('.cm-dg-ui')) return;
      event.preventDefault();
      openDiagram(view, { from: view.posAtDOM(box) });
    });
    holdHeight(box, this);
    return box;
  }

  updateDOM(dom, _view, previous) {
    if (!dom.diagram || !(previous instanceof DiagramWidget) || previous.writable !== this.writable) return false;
    if (!previous.same(this)) dom.diagram.update(this);
    else dom.diagram.widget = this;
    markPicked(dom, this.picked);
    moveHeight(dom, this);
    return true;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.cm-dg-ui'));
  }

  destroy(dom) {
    releaseHeight(dom);
    dom.diagram?.destroy();
  }

  /** The height it was last drawn at, its form open included, else a diagram's. */
  get estimatedHeight() {
    return heldHeight(this) ?? DIAGRAM_HEIGHT;
  }
}

/** The diagram drawn at `block.from`, or null. */
function boxAt(view, from) {
  return [...view.contentDOM.querySelectorAll('.cm-dg-block')].find((node) => {
    try {
      return view.posAtDOM(node) === from;
    } catch {
      return false;
    }
  })?.diagram ?? null;
}

/** Enter on a picked diagram, or a double press: its form, or its source when the form cannot read it or the note is locked. */
function openDiagram(view, block) {
  const diagram = boxAt(view, block.from);
  if (!diagram?.writable || !diagram.model) return openSource(view, { from: block.from, to: block.to ?? diagram?.range()?.to ?? block.from });
  diagram.toggleForm(true);
  return true;
}

// -- making a diagram --------------------------------------------------------------------------

/** An anchor at the cursor, for a panel to stand under; taken out with it. */
function cursorAnchor(view) {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head) ?? view.dom.getBoundingClientRect();
  const anchor = document.createElement('span');
  anchor.className = 'cm-dg-anchor';
  anchor.style.cssText = `position: fixed; left: ${coords.left}px; top: ${coords.top}px; width: 1px; height: ${Math.max(14, coords.bottom - coords.top)}px; pointer-events: none;`;
  view.dom.append(anchor);
  // it goes once no panel stands under it
  const watch = new MutationObserver(() => {
    if (![...view.dom.children].some((node) => node.matches('.dg-gallery, .dg-case'))) {
      watch.disconnect();
      anchor.remove();
    }
  });
  watch.observe(view.dom, { childList: true });
  return anchor;
}

/** Write `text` (a fence) at `pos` as one step, pick it, and, given `open`, open its form. */
function placeDiagram(view, text, pos, { open = true } = {}) {
  if (view.state.readOnly) return;
  const { insert, start } = blockAt(view.state, pos, text);
  view.dispatch({
    changes: { from: pos, insert },
    selection: { anchor: pos + start },
    annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.diagram')],
    scrollIntoView: true,
  });
  view.focus();
  if (open) boxAt(view, pos + start)?.toggleForm(true);
}

/**
 * `/` › Diagram on the drawn page: the gallery at the cursor. A kind writes its starter and
 * opens its form; a panel from the case writes what it listed; *Write it yourself* writes
 * plain Mermaid and opens it as code.
 */
export function startDiagram(view) {
  if (view.state.readOnly) return;
  const pos = view.state.selection.main.head;
  const { caseId } = view.state.field(noteCase);
  const anchor = cursorAnchor(view);
  const palette = () => (caseId ? layerPalette.colours : []);
  if (caseId) layerPalette.load(caseId);
  const place = (model) => placeDiagram(view, diagramFence(withColours(model, palette())), Math.min(pos, view.state.doc.length));
  openDiagramGallery(view, anchor, {
    caseId,
    onPick: (kind) => place(starterModel(kind)),
    onCase: (which) => {
      const options = { caseId, onWrite: place };
      if (which === 'timeline') openTimelinePanel(view, anchor, options);
      else openNetworkPanel(view, anchor, { ...options, ...caseWords() });
    },
    onSource: () => {
      const at = Math.min(pos, view.state.doc.length);
      placeDiagram(view, DIAGRAM_STARTER, at, { open: false });
      const block = blocksIn(view.state, view.state.selection.main.head).find((one) => one.kind === 'diagram');
      if (block) openSource(view, block);
    },
  });
}

const TOOL = {
  display: 'inline-flex', alignItems: 'center', gap: '6px', height: '26px', padding: '0 9px', border: '1px solid transparent',
  borderRadius: '5px', background: 'none', color: 'var(--text-2)', font: 'inherit', fontSize: '12.5px', cursor: 'pointer', whiteSpace: 'nowrap',
};

const THEME = {
  // the frame replaces the plain white box a diagram had: its bar on top, its drawing on white
  '.cm-block-diagram.cm-dg-block': {
    background: 'none', padding: '10px var(--note-gutter, 32px)', margin: '0', border: 'none', borderRadius: '0', overflowX: 'visible',
    color: 'var(--text-1)', cursor: 'default',
  },
  '.cm-block-diagram.cm-dg-block.cm-picked': { boxShadow: 'none' },
  '.cm-dg-frame': {
    position: 'relative', border: '1px solid var(--border-strong)', borderRadius: '8px', overflow: 'hidden', background: 'var(--bg-1)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px', lineHeight: '1.45', whiteSpace: 'normal', wordBreak: 'normal', overflowWrap: 'normal',
  },
  '.cm-dg-block.cm-picked .cm-dg-frame': { boxShadow: '0 0 0 2px var(--accent)' },
  '.cm-dg-bar': {
    display: 'flex', alignItems: 'center', gap: '2px', padding: '4px 6px', background: 'var(--bg-1)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap',
  },
  '.cm-dg-spring': { flex: '1' },
  '.cm-dg-tool': TOOL,
  '.cm-dg-tool[hidden], .cm-dg-ui[hidden], .cm-dg-unread[hidden]': { display: 'none' },
  '.cm-dg-tool:hover, .cm-dg-tool:focus-visible': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-dg-tool:disabled': { opacity: '0.6', cursor: 'default', background: 'none' },
  '.cm-dg-tool svg': { flex: 'none', opacity: '0.85' },
  '.cm-dg-kind': { color: 'var(--text-1)', fontWeight: '600' },
  '.cm-dg-tool[aria-pressed="true"]': { background: 'var(--bg-3)', color: 'var(--text-1)' },
  '.cm-dg-unread': { padding: '0 8px', color: 'var(--text-3)', fontSize: '12px' },
  '.cm-dg-source': { padding: '0 7px', minWidth: '28px', justifyContent: 'center' },
  '.cm-dg-source::before': { content: '"</>"', fontFamily: 'var(--font-mono)', fontSize: '11px' },
  '.cm-dg-body': { display: 'block' },
  '.cm-dg-wide.cm-dg-editing .cm-dg-body': { display: 'grid', gridTemplateColumns: 'minmax(380px, 46%) minmax(0, 1fr)', alignItems: 'start' },
  '.cm-dg-wide.cm-dg-editing .cm-dg-form-panel': { borderBottom: 'none', borderRight: '1px solid var(--border)', alignSelf: 'stretch' },
  '.cm-dg-wide.cm-dg-editing .cm-dg-figure': { position: 'sticky', top: '0' },
  // beside the form, a drawing taller than the page is drawn smaller rather than cut
  '.cm-dg-wide.cm-dg-editing .cm-dg-figure > svg': { maxHeight: 'calc(100vh - 210px)', width: 'auto' },
  '.cm-dg-figure': {
    position: 'relative', background: '#fff', minHeight: '60px', padding: '14px', color: '#202124', overflowX: 'auto',
  },
  '.cm-dg-figure > svg': { display: 'block', maxWidth: '100%', height: 'auto', margin: '0 auto', transition: 'opacity 0.2s var(--ease)' },
  '.cm-dg-loading > svg': { opacity: '0.55' },
  '.cm-dg-said': { margin: '0', padding: '22px 16px', color: '#6e675a', textAlign: 'center' },
  '.cm-dg-failed': { color: 'var(--danger)' },
};

registerBlock({
  name: 'diagram',
  // a closed ```mermaid fence; open, its lines are code
  node: 'FencedCode',
  read: (node, { state }) => {
    const opening = state.doc.sliceString(node.from, Math.min(node.to, state.doc.lineAt(node.from).to));
    const closed = /^(```|~~~)$/.test(state.doc.lineAt(node.to).text.trim());
    return /^\s*(```|~~~)\s*mermaid\b/.test(opening) && closed ? { from: node.from, to: node.to } : null;
  },
  widget: (spec) => new DiagramWidget(spec),
  open: openDiagram,
  atomic: true,
  height: DIAGRAM_HEIGHT,
  theme: THEME,
});

