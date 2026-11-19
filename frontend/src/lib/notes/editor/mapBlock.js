/**
 * A map: a `::: map` block of `key: value` lines (`engine/notes_maps.py`), drawn in the
 * note as the page draws it: its ground, and over it the layers' marks, lines and areas
 * and the proofs, from the engine's own drawing (`POST /notes/maps/describe`, nothing
 * fetched). Its bar opens its settings (`editor/mapCard.js`) between the bar and the map,
 * so each choice is seen on the map at once and in the Page pane's HTML view as it is
 * drawn again; a double press or Enter opens them too, and `</>` its lines.
 *
 * Every choice writes its own line, the other lines kept as they were, as one Undo step
 * (`editor/mapText.js`). A base other than the ground filed, or a frame its ground does
 * not cover, files its picture on the press that asks for it (`POST /notes/maps/ground`):
 * the page still never fetches a tile. What is drawn on the map (an area to highlight with
 * its words, a point, a line, an area) goes into a personal layer of the case the block
 * names, made at the first drawing, each with its own Undo in the toast that says it.
 */
import { isolateHistory } from '@codemirror/commands';
import { Transaction } from '@codemirror/state';

import { fileUrl } from '../../fileUrl.js';
import {
  drawFeature, describeMap, editFeature, fileGround, forgetMaps, makeOwnLayer, removeFeature, restoreFeature,
} from '../mapSettings.svelte.js';
import { rovingToolbar } from '../pictureSize.js';
import { MAP_BLOCK } from '../syntax.js';
import { registerBlock } from './blocks.js';
import { button } from './gridMenu.js';
import { heldHeight, holdHeight, moveHeight, releaseHeight } from './heights.js';
import { drawingsTitle, mapSettings } from './mapCard.js';
import { TOOL_HINTS, mapSurface } from './mapSurface.js';
import { readMap, withMapSettings } from './mapText.js';
import { blocksIn, openSource } from './ranges.js';
import { noteHandlers } from './state.js';
import { lineChanges } from './tableText.js';
import { BlockWidget, markPicked, sourceButton } from './widgets.js';

/** A map's height before it is drawn, in pixels. */
const MAP_HEIGHT = 420;
/** What a base's press says while its picture is filed. */
const FILING = { satellite: 'Filing the imagery…', map: 'Filing the street map…', topographic: 'Filing the topographic map…', dark: 'Filing the street map…' };

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A map's block, read: its title, what it shows, its ground and how it is shown (`editor/mapText.js`). */
export function mapBlock(source) {
  const read = readMap(source);
  return { ...read, details: read.details.length };
}

/** What the map shows, said in a line each over its ground. */
function saidOf(map) {
  const shown = map.layers.filter((name) => !map.hidden.includes(name));
  return [
    map.plate ? `Plate: ${map.plate}` : '',
    shown.length ? `${shown.length === 1 ? 'Layer' : 'Layers'}: ${shown.join(', ')}` : '',
    map.hidden.length ? `Hidden: ${map.hidden.join(', ')}` : '',
    map.proofs ? `Proofs: ${map.proofs === 'all' ? 'all' : map.proofs.replace('..', ' to ')}` : '',
    map.ground ? '' : 'No ground: drawn on a plain background',
  ].filter(Boolean);
}

/** A map drawn in the note, kept on its box (`box.map`). */
class MapBox {
  constructor(box, widget, view) {
    this.box = box;
    this.view = view;
    this.widget = widget;
    this.map = readMap(widget.source);
    this.described = null;
    this.asked = null;
    this.busy = '';
    this.settings = null;
    this.surface = null;
    this.tab = 'look';
    this.gone = false;
    box.map = this;
    this.build();
    this.describe();
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

  get caseId() {
    return this.info.caseId ?? '';
  }

  range() {
    let from;
    try {
      from = this.view.posAtDOM(this.box);
    } catch {
      return null;
    }
    return blocksIn(this.view.state, from).find((block) => block.from === from && block.kind === 'map') ?? null;
  }

  /** The map worked on is the one picked: the cursor goes to its start, so the note keeps it drawn where it is. */
  pick() {
    const range = this.range();
    const { main } = this.view.state.selection;
    if (range && !(main.empty && main.head === range.from)) this.view.dispatch({ selection: { anchor: range.from } });
  }

  // -- drawing --

  build() {
    const { box } = this;
    box.className = 'cm-block cm-block-map cm-map-block';
    box.dataset.block = 'map';
    const card = element('div', 'cm-map-card');
    if (this.writable) card.append(this.makeBar());
    else card.append(element('div', 'cm-played-head', 'Map · interactive in HTML, a picture in the PDF'));
    this.settingsPanel = element('div', 'cm-map-settings cm-map-ui');
    this.settingsPanel.hidden = true;
    this.settingsPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.surface?.armed) return;
      event.preventDefault();
      event.stopPropagation();
      this.toggleSettings(false);
      this.settingsButton?.focus({ preventScroll: true });
    });
    this.stage = element('div', 'cm-map-stage');
    this.stage.tabIndex = -1;
    this.said = element('div', 'cm-map-said');
    this.hint = element('p', 'cm-map-hint cm-map-ui');
    this.hint.hidden = true;
    const holder = element('div', 'cm-map-holder');
    holder.append(this.stage, this.said);
    card.append(this.settingsPanel, holder, this.hint);
    box.append(card);
    if (!this.writable) box.append(sourceButton(this.view, box));
    this.renderSaid();
  }

  makeBar() {
    const bar = element('div', 'cm-map-bar cm-map-ui');
    bar.setAttribute('role', 'toolbar');
    bar.setAttribute('aria-label', 'Map');
    bar.append(element('span', 'cm-map-bar-name', 'Map'), element('span', 'cm-map-bar-said', 'interactive in HTML, a picture in the PDF'));
    bar.append(element('span', 'cm-chart-spring'));
    const tool = (className, options, run) => {
      const node = button(`cm-chart-tool ${className}`, options);
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => {
        this.pick();
        run(node);
      });
      bar.append(node);
      return node;
    };
    this.drawButton = tool('cm-map-draw', { label: 'Draw', iconName: 'edit', title: 'An area to highlight, a point, a line or an area, on the map' },
      () => this.toggleSettings(true, 'draw'));
    this.settingsButton = tool('cm-map-settings-btn', { label: 'Settings', iconName: 'sliders', title: 'Base, layers, frame, timeline, steps and cards' },
      () => this.toggleSettings());
    this.settingsButton.setAttribute('aria-pressed', 'false');
    const source = button('cm-chart-tool cm-chart-source', { label: 'Edit the source', alone: true, title: 'Edit the source' });
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

  renderSaid() {
    const title = element('strong', '', this.map.title || 'Map');
    this.said.replaceChildren(title, ...saidOf(this.map).map((part) => element('span', '', part)));
  }

  update(widget) {
    const before = this.widget;
    this.widget = widget;
    this.map = readMap(widget.source);
    this.renderSaid();
    if (widget.source !== before.source || widget.info.caseId !== before.info.caseId) this.describe();
    else this.settings?.refresh();
  }

  /** Read the map again as it shows now, and draw it; the drawing it had stays, paler, till then. */
  describe() {
    if (!this.caseId) {
      this.stage.replaceChildren(element('p', 'cm-map-note', 'A map is drawn in a note of a case.'));
      return;
    }
    this.stage.classList.add('cm-map-loading');
    const asked = describeMap({ caseId: this.caseId, text: this.widget.source });
    this.asked = asked;
    asked.then((answer) => {
      if (this.gone || this.asked !== asked) return;
      this.stage.classList.remove('cm-map-loading');
      if (answer?.error) {
        this.described = null;
        this.stage.replaceChildren(element('p', 'cm-map-note cm-map-failed', `Map not drawn: ${answer.error}`));
        this.settings?.refresh();
        return;
      }
      this.described = answer;
      this.draw();
      this.settings?.refresh();
      // a map started from nothing opens on what draws on it
      if (this.writable && !this.opened && this.empty()) {
        this.opened = true;
        this.toggleSettings(true, 'draw', { focus: false });
      }
      this.view.requestMeasure();
    });
  }

  /** A map that draws only an empty layer of its own: one just started. */
  empty() {
    const layers = this.described?.layers ?? [];
    return layers.length === 1 && layers[0].own && !this.described.drawings.length && !this.map.plate && !this.map.proofs;
  }

  draw() {
    const armed = this.surface?.armed;
    this.surface?.disarm();
    const ground = this.described.ground;
    this.surface = mapSurface(this.stage, this.described, {
      groundUrl: ground ? fileUrl(this.caseId, ground.path) : '',
      onarmed: (tool) => this.showHint(tool),
    });
    this.stage.classList.toggle('cm-map-plain', !ground);
    if (armed) this.showHint(null);
    this.settings?.refresh();
  }

  showHint(tool) {
    this.hint.hidden = !tool;
    this.hint.textContent = tool ? TOOL_HINTS[tool] ?? '' : '';
    this.box.classList.toggle('cm-map-drawing-on', Boolean(tool));
    this.view.requestMeasure();
  }

  // -- writing --

  /** Write `changes` (`{ key: value }`, '' or [] taking lines out) as one step. */
  write(changes) {
    return this.edit((source) => withMapSettings(source, changes));
  }

  /** Change the block's text with `change(source)`, as one step Undo takes back. */
  edit(change) {
    if (!this.writable) return false;
    const range = this.range();
    if (!range) return false;
    const source = this.view.state.sliceDoc(range.from, range.to);
    const next = change(source);
    if (next === source) return false;
    this.view.dispatch({
      changes: lineChanges(source, next).map((piece) => ({ from: range.from + piece.from, to: range.from + piece.to, insert: piece.insert })),
      annotations: [isolateHistory.of('full'), Transaction.userEvent.of('input.map')],
    });
    return true;
  }

  say(message, actions = [], kind) {
    this.handlers.tableToast?.(message, actions, kind);
  }

  setBusy(words) {
    this.busy = words;
    this.settings?.refresh();
  }

  /**
   * Draw the map on `value`: its picture filed on this press (cited again when the same view
   * was filed before), then the base, the ground and its close-ups written as one step.
   * `reframe` files the ground again for the frame the map has.
   */
  async base(value, { reframe = false } = {}) {
    if (!this.caseId || this.busy) return;
    const range = this.range();
    if (!range) return;
    this.setBusy(`base:${FILING[value] ?? 'Filing…'}`);
    try {
      const answer = await fileGround(this.caseId, { text: this.view.state.sliceDoc(range.from, range.to), base: value });
      if (this.gone) return;
      const changes = { base: answer.base ?? '', ground: answer.ground, detail: answer.details ?? [] };
      // a ground filed for a frame looks where the frame is
      if (reframe || !this.map.view) changes.view = answer.view;
      this.write(changes);
      if (answer.filed?.length) forgetMaps();
    } catch (error) {
      this.say(error?.message || 'The map keeps its ground', [], 'warn');
    } finally {
      this.setBusy('');
    }
  }

  /** Arm `tool` on the map, the card's choice answered with what it drew. */
  arm(tool, done) {
    if (!this.surface) return;
    this.surface.arm(tool, (answer) => {
      this.stage.blur();
      done(answer);
    });
    // the whole map in view, where the tool is used
    this.stage.scrollIntoView?.({ block: 'nearest' });
    this.stage.focus({ preventScroll: true });
  }

  /**
   * The personal layer this map draws in: the one made for its drawings that it names, else
   * one made now and named in the block. A layer the analyst made elsewhere is never drawn in.
   */
  async drawingsLayer() {
    const own = this.described?.layers?.find((layer) => layer.own && layer.from === 'line');
    if (own) return own.name;
    const made = await makeOwnLayer(this.caseId, drawingsTitle(this.map));
    this.write({ layer: [...this.map.layers, made.name] });
    return made.name;
  }

  async drawn(kind, coords, extra = {}) {
    if (!this.caseId || this.busy) return;
    this.setBusy('draw:Putting it on the map…');
    try {
      const layer = await this.drawingsLayer();
      const answer = await drawFeature(this.caseId, { layer, kind, coords, name: extra.name ?? '', colour: extra.colour ?? '#0072b2',
        label: Boolean(extra.label), highlight: Boolean(extra.highlight) });
      this.describe();
      const what = extra.highlight ? 'Area highlighted' : kind === 'point' ? 'Point put' : kind === 'line' ? 'Line drawn' : 'Area drawn';
      this.say(`${what} in the layer of this map`, [{ label: 'Undo', onClick: () => this.removed({ layer, key: answer.key }, false) }]);
    } catch (error) {
      this.say(`Not drawn: ${error?.message ?? error}`, [], 'warn');
    } finally {
      this.setBusy('');
    }
  }

  async editDrawn(row, changes) {
    try {
      await editFeature(this.caseId, row.key, { layer: row.layer, ...changes });
      this.describe();
    } catch (error) {
      this.say(`Not changed: ${error?.message ?? error}`, [], 'warn');
    }
  }

  async removed(row, undoable = true) {
    try {
      await removeFeature(this.caseId, row.layer, row.key);
      this.describe();
      if (undoable) {
        this.say('Taken out of the map', [{
          label: 'Undo',
          onClick: () => restoreFeature(this.caseId, row.layer, row.key).then(() => this.describe(), (error) => this.say(`Not put back: ${error.message}`, [], 'warn')),
        }]);
      }
    } catch (error) {
      this.say(`Not taken out: ${error?.message ?? error}`, [], 'warn');
    }
  }

  /** Layers › From a sheet…: a layer made from a sheet's rows, or one it already makes brought level, put on this map. */
  fromSheet() {
    const put = (row) => {
      if (row?.name && !this.map.layers.includes(row.name)) this.write({ layer: [...this.map.layers, row.name] });
      else this.describe();
    };
    this.handlers.sheetMap?.({
      onmade: (row) => {
        put(row);
        this.say(`Layer “${row.title}” made from its sheet: ${row.made?.points ?? row.features} points`);
      },
      onupdated: (answer) => {
        put(answer);
        this.say(`Layer “${answer.title}” brought level with its sheet`);
      },
    });
  }

  // -- the settings --

  /** Open or close the settings on the map, on `tab`; open, its tabs take the keyboard. */
  toggleSettings(open = this.settingsPanel.hidden, tab = null, { focus = true } = {}) {
    if (!this.writable) return;
    if (!open) {
      this.surface?.disarm();
      this.settings?.destroy();
      this.settings = null;
      this.settingsPanel.hidden = true;
      this.settingsPanel.replaceChildren();
    } else if (!this.settings) {
      this.settingsPanel.hidden = false;
      this.settings = mapSettings(this.settingsPanel, {
        tab: tab ?? this.tab,
        onTab: (id) => { this.tab = id; this.surface?.disarm(); },
        state: () => (this.gone ? null : { map: this.map, described: this.described, busy: this.busy }),
        write: (changes) => this.write(changes),
        base: (value, options) => this.base(value, options),
        arm: (tool, done) => this.arm(tool, done),
        draw: (kind, coords, extra) => this.drawn(kind, coords, extra),
        edit: (row, changes) => this.editDrawn(row, changes),
        remove: (row) => this.removed(row),
        overlay: (shapes) => this.surface?.show(shapes),
        fromSheet: this.handlers.sheetMap ? () => this.fromSheet() : null,
      });
    } else if (tab) this.settings.open(tab);
    this.settingsButton?.setAttribute('aria-pressed', String(open));
    if (open && focus) this.settings.focus();
    this.view.requestMeasure();
  }

  toSource() {
    const range = this.range();
    if (range) openSource(this.view, range);
  }

  destroy() {
    this.gone = true;
    this.surface?.disarm();
    this.settings?.destroy();
  }
}

/** A map drawn in place: drawn again in place, its box, its bar and its open settings kept, when its lines change. */
export class MapWidget extends BlockWidget {
  constructor(spec) {
    super('map', spec.source, spec.info, spec.writable, '', spec.pinned, spec.picked);
  }

  toDOM(view) {
    const box = document.createElement('div');
    // eslint-disable-next-line no-new
    new MapBox(box, this, view);
    markPicked(box, this.picked);
    box.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || event.target.closest('.cm-map-ui, .cm-map-armed, a')) return;
      event.preventDefault();
      // a press picks the map, which stays drawn; a double press opens its settings
      view.dispatch({ selection: { anchor: view.posAtDOM(box) } });
      view.focus();
    });
    box.addEventListener('dblclick', (event) => {
      if (event.target.closest('.cm-map-ui, .cm-map-armed')) return;
      event.preventDefault();
      if (box.map.writable) box.map.toggleSettings(true);
      else openSource(view, box.map.range());
    });
    holdHeight(box, this);
    return box;
  }

  updateDOM(dom, _view, previous) {
    if (!dom.map || !(previous instanceof MapWidget) || previous.writable !== this.writable) return false;
    if (!previous.same(this)) dom.map.update(this);
    else dom.map.widget = this;
    markPicked(dom, this.picked);
    moveHeight(dom, this);
    return true;
  }

  ignoreEvent(event) {
    return event.type !== 'mousedown' || Boolean(event.target?.closest?.('.cm-map-ui, .cm-map-armed'));
  }

  destroy(dom) {
    releaseHeight(dom);
    dom.map?.destroy();
  }

  get estimatedHeight() {
    return heldHeight(this) ?? MAP_HEIGHT;
  }
}

/** Enter on a picked map, or a double press: its settings; a locked note opens the source. */
function openMap(view, block) {
  const box = [...view.contentDOM.querySelectorAll('.cm-map-block')].find((node) => {
    try {
      return view.posAtDOM(node) === block.from;
    } catch {
      return false;
    }
  });
  if (!box?.map || !box.map.writable) return openSource(view, block);
  box.map.toggleSettings(true);
  return true;
}

const THEME = {
  '.cm-block-map.cm-map-block': { padding: '0', overflow: 'hidden' },
  '.cm-map-card': { display: 'flex', flexDirection: 'column' },
  '.cm-map-card > .cm-played-head': { padding: '9px 13px 4px' },
  '.cm-map-bar': {
    display: 'flex', alignItems: 'center', gap: '4px', padding: '5px 6px 5px 12px', borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px',
  },
  '.cm-map-bar-name': { fontWeight: '650', color: 'var(--text-1)' },
  '.cm-map-bar-said': { color: 'var(--text-3)', fontSize: '11.5px', marginLeft: '4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  '.cm-map-holder': { position: 'relative', padding: '10px 12px 12px' },
  '.cm-map-stage': {
    position: 'relative', width: '100%', maxHeight: '560px', aspectRatio: 'var(--r, 1.6)', margin: '0 auto', overflow: 'hidden',
    borderRadius: '4px', background: '#20252b', outline: 'none', userSelect: 'none',
  },
  '.cm-map-stage.cm-map-plain': { background: '#e9e6df' },
  '.cm-map-stage.cm-map-loading > *': { opacity: '.55', transition: 'opacity .2s' },
  '.cm-map-world': { position: 'absolute', inset: '0', filter: 'saturate(.62) brightness(.86) contrast(1.04)', pointerEvents: 'none' },
  '.cm-map-stage[data-base="dark"] .cm-map-world': { filter: 'grayscale(1) invert(1) brightness(.82) contrast(1.1)' },
  '.cm-map-stage:is([data-base="map"], [data-base="topographic"]) .cm-map-world': { filter: 'saturate(.8) brightness(.94)' },
  '.cm-map-ground': { position: 'absolute', maxWidth: 'none !important', margin: '0 !important', pointerEvents: 'none' },
  '.cm-map-drawing, .cm-map-drawing > svg, .cm-map-over': { position: 'absolute', inset: '0', width: '100%', height: '100%' },
  '.cm-map-drawing svg .az-off, .cm-map-drawing svg .az-clash': { opacity: '0', visibility: 'hidden' },
  '.cm-map-drawing svg .az-past': { opacity: '.38', visibility: 'visible' },
  '.cm-map-drawing svg .az-halo': { fill: 'none', stroke: 'rgba(255, 255, 255, .5)' },
  '.cm-map-drawing svg .az-stroke': { fill: 'none' },
  '.cm-map-drawing svg :is(.az-halo, .az-stroke)': { vectorEffect: 'non-scaling-stroke', strokeLinecap: 'round', strokeLinejoin: 'round' },
  '.cm-map-drawing svg .az-label': { fill: '#fff', stroke: 'rgba(12, 14, 18, .86)', strokeWidth: '4px', paintOrder: 'stroke', fontFamily: 'var(--font-sans)', fontWeight: '700' },
  '.cm-map-drawing svg .az-leader line': { stroke: 'rgba(255, 255, 255, .92)', strokeWidth: '1.2px', vectorEffect: 'non-scaling-stroke' },
  '.cm-map-over': { pointerEvents: 'none', overflow: 'visible' },
  '.cm-map-armed .cm-map-over': { pointerEvents: 'auto', cursor: 'crosshair' },
  '.cm-map-armed': { boxShadow: '0 0 0 2px var(--accent)' },
  '.cm-map-box': { fill: 'rgba(255, 255, 255, .08)', stroke: '#fff', vectorEffect: 'non-scaling-stroke' },
  '.cm-map-box-new': { strokeDasharray: '6 4', stroke: 'var(--accent)' },
  '.cm-map-box-label': { fill: '#fff', fontFamily: 'var(--font-sans)', fontWeight: '700', paintOrder: 'stroke', stroke: 'rgba(12, 14, 18, .8)', strokeWidth: '3px' },
  '.cm-map-path': { fill: 'none', stroke: 'var(--accent)', strokeLinejoin: 'round', strokeLinecap: 'round' },
  '.cm-map-path-area': { fill: 'color-mix(in srgb, var(--accent) 22%, transparent)' },
  '.cm-map-corner': { fill: '#fff', stroke: 'var(--accent)', strokeWidth: '2px', vectorEffect: 'non-scaling-stroke' },
  '.cm-map-holder > .cm-map-said': { left: '22px', bottom: '22px' },
  '.cm-map-drawing-on .cm-map-said': { display: 'none' },
  '.cm-map-hint': {
    margin: '0 12px 10px', padding: '6px 10px', borderRadius: '6px', background: 'var(--accent-soft)', color: 'var(--text-1)',
    fontFamily: 'var(--font-sans)', fontSize: '12px',
  },
  '.cm-map-hint[hidden]': { display: 'none' },
  '.cm-map-settings': {
    display: 'flex', flexDirection: 'column', gap: '0', background: 'var(--bg-2)', borderBottom: '1px solid var(--border)',
    fontFamily: 'var(--font-sans)', fontSize: '12.5px', color: 'var(--text-1)',
  },
  '.cm-map-settings[hidden]': { display: 'none' },
  '.cm-map-tabs': { display: 'flex', gap: '2px', padding: '6px 10px 0', borderBottom: '1px solid var(--border)' },
  '.cm-map-tab': {
    height: '28px', padding: '0 12px', border: 'none', borderBottom: '2px solid transparent', background: 'none', color: 'var(--text-2)',
    font: 'inherit', fontWeight: '600', cursor: 'pointer',
  },
  '.cm-map-tab:hover, .cm-map-tab:focus-visible': { color: 'var(--text-1)', outline: 'none' },
  '.cm-map-tab[aria-selected="true"]': { color: 'var(--text-1)', borderBottomColor: 'var(--accent)' },
  '.cm-map-tab-body': { display: 'flex', flexDirection: 'column', gap: '11px', padding: '12px 14px 13px' },
  '.cm-map-field': { display: 'grid', gridTemplateColumns: '108px minmax(0, 1fr)', alignItems: 'center', gap: '10px', minWidth: '0' },
  '.cm-map-field > :is(.cm-map-busy, .cm-map-note)': { gridColumn: '2' },
  '.cm-map-field-name': { color: 'var(--text-2)', fontSize: '11.5px' },
  '.cm-map-grid': { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '10px 18px' },
  '.cm-map-grid .cm-map-field': { gridTemplateColumns: '108px auto' },
  '.cm-map-grid .cm-map-field:nth-child(even)': { gridTemplateColumns: '80px auto' },
  '.cm-map-input, .cm-map-select': {
    boxSizing: 'border-box', minHeight: '28px', padding: '3px 8px', border: '1px solid var(--border-strong)', borderRadius: '5px',
    background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', outline: 'none', minWidth: '0',
  },
  '.cm-map-input:focus, .cm-map-select:focus': { borderColor: 'var(--info)' },
  '.cm-map-title-field .cm-map-input': { width: '100%', fontWeight: '600', fontSize: '13.5px' },
  '.cm-map-date': { width: '140px' },
  '.cm-map-colour': { width: '150px', paddingLeft: '24px', backgroundImage: 'radial-gradient(circle at 12px 50%, var(--swatch) 5px, transparent 5.5px)' },
  '.cm-map-actions': { display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '6px 8px' },
  '.cm-map-act': {
    display: 'inline-flex', alignItems: 'center', gap: '6px', height: '28px', padding: '0 10px', border: '1px solid var(--border-strong)',
    borderRadius: '6px', background: 'var(--bg-1)', color: 'var(--text-1)', font: 'inherit', cursor: 'pointer', whiteSpace: 'nowrap',
  },
  '.cm-map-act:hover, .cm-map-act:focus-visible': { background: 'var(--bg-3)', outline: 'none' },
  '.cm-map-act:disabled': { opacity: '.5', cursor: 'default' },
  '.cm-map-icon-btn': {
    display: 'inline-grid', placeItems: 'center', width: '26px', height: '26px', padding: '0', border: 'none', borderRadius: '5px',
    background: 'none', color: 'var(--text-2)', cursor: 'pointer', flex: 'none',
  },
  '.cm-map-icon-btn:hover, .cm-map-icon-btn:focus-visible': { background: 'var(--bg-3)', color: 'var(--text-1)', outline: 'none' },
  '.cm-map-icon-btn:disabled': { opacity: '.35', cursor: 'default', background: 'none' },
  '.cm-map-note': { margin: '0', color: 'var(--text-3)', fontSize: '11.5px' },
  '.cm-map-failed': { color: 'var(--danger)', padding: '14px' },
  '.cm-map-busy': { color: 'var(--accent)', fontSize: '11.5px', margin: '0' },
  '.cm-map-list': { display: 'flex', flexDirection: 'column', border: '1px solid var(--border)', borderRadius: '7px', background: 'var(--bg-1)' },
  '.cm-map-row': { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 10px', minWidth: '0' },
  '.cm-map-list > .cm-map-row + .cm-map-row': { borderTop: '1px solid var(--border)' },
  '.cm-map-list > .cm-map-note': { padding: '8px 10px' },
  '.cm-map-off .cm-map-row-name, .cm-map-off .cm-map-swatches': { opacity: '.45' },
  '.cm-map-row-name': { flex: '1 1 auto', minWidth: '0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  '.cm-map-count': { color: 'var(--text-3)', fontVariantNumeric: 'tabular-nums' },
  '.cm-map-swatches': { display: 'inline-flex', gap: '2px', flex: 'none' },
  '.cm-map-dot': { width: '9px', height: '9px', borderRadius: '50%', boxShadow: 'inset 0 0 0 1px rgba(0, 0, 0, .25)' },
  '.cm-map-check': { display: 'inline-flex', alignItems: 'center', gap: '5px', color: 'var(--text-2)', whiteSpace: 'nowrap', cursor: 'pointer' },
  '.cm-map-drawn-row': { flexWrap: 'wrap' },
  '.cm-map-kind': { display: 'inline-grid', placeItems: 'center', color: 'var(--text-2)', flex: 'none' },
  '.cm-map-name': { flex: '1 1 140px' },
  '.cm-map-steps': { alignItems: 'start' },
  '.cm-map-steps-head': { display: 'flex', flexDirection: 'column', gap: '3px' },
  '.cm-map-step-list': { display: 'flex', flexDirection: 'column', gap: '4px', margin: '0', padding: '0', listStyle: 'none' },
  '.cm-map-steps > .cm-map-act': { gridColumn: '2', justifySelf: 'start' },
  '.cm-map-step': {
    display: 'grid', gridTemplateColumns: '26px 92px minmax(80px, 1fr) minmax(120px, 2fr) repeat(4, 26px)', alignItems: 'center', gap: '6px',
    padding: '3px 4px', borderRadius: '6px',
  },
  '.cm-map-step-on': { background: 'color-mix(in srgb, #ffd640 18%, transparent)' },
  '.cm-map-step-n': {
    width: '22px', height: '22px', padding: '0', border: 'none', borderRadius: '50%', background: 'var(--bg-3)', color: 'var(--text-1)',
    font: 'inherit', fontWeight: '700', fontSize: '11px', cursor: 'pointer',
  },
  '.cm-map-step-day': { color: 'var(--text-2)', fontSize: '11.5px', whiteSpace: 'nowrap' },
};

registerBlock({
  name: 'map',
  fence: MAP_BLOCK,
  widget: (spec) => new MapWidget(spec),
  open: openMap,
  atomic: true,
  height: MAP_HEIGHT,
  theme: THEME,
});


