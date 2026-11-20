/**
 * An infographic's map panel, worked on in the builder (`tools/notebook/InfographicBuilder.svelte`)
 * under its row: the map drawn as the note draws it, and under it the map's own settings card
 * (`editor/mapCard.js`, driven by `editor/mapBlock.js`'s `MapEditing`), so a frame, a step or a
 * drawing is made on the map in place. Every choice writes the panel's lines inside the
 * `:::: infographic` block, as one Undo step; what is drawn goes into a personal layer of the
 * case, its toast offering Undo, as on a map of the note.
 *
 * Every tab applies to a panel: the HTML page draws the panel as the page's own map, its
 * legend, timeline, steps and cards included, and the PDF and the picture print it as a map in
 * a note prints. Only Size does not: the page sets a panel's width, Half or Wide on its row,
 * so the card says that in its place (`SIZED_BY`).
 *
 * The builder sits outside the editor, whose themes style the card: the panel takes the
 * editor's theme classes (`themes`, `EditorView.themeClasses`), as CodeMirror's own tooltips
 * do when they are drawn elsewhere.
 */
import { MapEditing } from './mapBlock.js';
import { readMap } from './mapText.js';

/** What the card says in place of Size, in a panel. */
export const SIZED_BY = 'Set on its row above: Half or Wide.';

function element(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

/** The map panel worked on in `host` (`MapEditing`, its lines handed in and written back by the builder). */
class MapPanel extends MapEditing {
  constructor(host, options) {
    super();
    this.options = options;
    this.current = options.source ?? '';
    this.map = readMap(this.current);
    this.tab = options.tab ?? 'look';
    this.build(host);
    this.toggleSettings(true, this.tab, { focus: false });
    this.describe();
  }

  get caseId() {
    return this.options.caseId ?? '';
  }

  get writable() {
    return Boolean(this.options.edit);
  }

  get source() {
    return this.current;
  }

  get sheetMap() {
    return this.options.sheetMap ?? null;
  }

  get sizedBy() {
    return SIZED_BY;
  }

  /** Its lines as the note holds them now, or null when the panel is no longer a map. */
  text() {
    const now = this.options.text ? this.options.text() : this.current;
    return now && /^\s*:::\s*map\s*$/m.test(now) ? now : null;
  }

  edit(change) {
    return Boolean(this.options.edit?.(change));
  }

  say(message, actions = [], kind = 'info') {
    this.options.say?.(message, actions, kind);
  }

  build(host) {
    this.host = host;
    // the editor's themes reach what is drawn here
    this.box = element('div', `ib-map ${this.options.themes ?? ''}`.trim());
    this.stage = element('div', 'cm-map-stage');
    this.stage.tabIndex = -1;
    const holder = element('div', 'cm-map-holder');
    holder.append(this.stage);
    this.hint = element('p', 'cm-map-hint cm-map-ui');
    this.hint.hidden = true;
    this.settingsPanel = element('div', 'cm-map-settings cm-map-ui');
    this.settingsPanel.hidden = true;
    this.settingsPanel.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape' || this.surface?.armed) return;
      event.preventDefault();
      event.stopPropagation();
      this.options.onclose?.();
    });
    this.box.append(holder, this.hint, this.settingsPanel);
    host.replaceChildren(this.box);
  }

  /** The tab picked is the builder's to keep, so the card opens on it again. */
  onTab(id) {
    super.onTab(id);
    this.options.onTab?.(id);
  }

  /** The panel's lines as the page holds them now: drawn again when they changed, else its card said again. */
  update(source) {
    const next = source ?? '';
    const changed = next !== this.current;
    this.current = next;
    this.reread(next, changed);
  }

  destroy() {
    if (this.gone) return;
    super.destroy();
    this.host?.replaceChildren();
  }
}

/**
 * The map panel `options.source` (its `::: map` lines) worked on in `host`. `options`:
 * `caseId`; `edit(change)`, the panel's lines changed by `change(lines)` and written inside the
 * infographic as one change, answering whether it landed; `text()`, the panel's lines as the
 * note holds them now; `say(message, actions, kind)`, a toast; `sheetMap`, the note's
 * *From a sheet…* when it can; `themes`, the editor's theme classes; `tab` and `onTab(id)`, the
 * tab it opens on and the one picked; `onclose()`, Escape. Answers the card as the builder
 * drives a chart's: `{ update(source), refresh, focus, commit, destroy }`.
 */
export function mapPanel(host, options) {
  const panel = new MapPanel(host, options);
  return {
    panel,
    update: (source) => panel.update(source),
    refresh: () => panel.settings?.refresh(),
    focus: () => panel.settings?.focus(),
    /** A word typed and not yet left is written before the card goes. */
    commit: () => {
      const active = document.activeElement;
      if (active && panel.box.contains(active) && typeof active.blur === 'function') active.blur();
    },
    destroy: () => panel.destroy(),
  };
}
