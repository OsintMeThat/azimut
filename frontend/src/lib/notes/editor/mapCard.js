/**
 * A map's settings, drawn on the map's own card between its bar and its map, in five
 * short tabs so no choice hides another:
 *
 * - **Look**: its title, the base it is drawn on (satellite as filed, a street map, a
 *   topographic one, a dark one), a satellite map's imagery (Sentinel-2 or Esri, its ground
 *   filed on the press), its frame (dragged on the map, or fitted to what it shows) and
 *   whether a live map keeps its readers inside it, its size, its legend, a north arrow and
 *   the scale; *Apply a template…* sets a
 *   map template's look (Settings › Templates › Figures), its layers, frame and steps kept;
 * - **Layers**: each layer on or off and its colour from the case's palette, another
 *   layer added, the proofs of a period (only where each was filmed, or every point),
 *   the names on the map and how many marks make a crowd;
 * - **Draw**: an area to highlight with its words ("about 15 km²"), a point, a line or an
 *   area, each with its name, its day or its days and its colour, kept in a personal
 *   layer of the case the map names;
 * - **Time**: the timeline on or off, the day it opens on, Play's pace, and the steps:
 *   reordered, each framed by a rectangle dragged on the map, its words written;
 * - **Cards**: what a feature's card shows.
 *
 * The card writes nothing itself: each choice goes to `write(changes)`, which the map block
 * writes as its lines, one Undo step a choice (`editor/mapBlock.js`).
 */
import { button, icon } from './gridMenu.js';
import { openFigurePicker } from '../figureTemplatePicker.js';
import {
  BASES, CARD_PARTS, CROWDS, ESRI_TERMS, IMAGERY, LEGENDS, SIZES, SPEEDS, aboutArea, areaKm2, colourText, fitView, frameText, stepValue,
  viewBounds,
} from './mapText.js';

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export const TABS = [
  { id: 'look', label: 'Look' },
  { id: 'layers', label: 'Layers' },
  { id: 'draw', label: 'Draw' },
  { id: 'time', label: 'Time' },
  { id: 'cards', label: 'Cards' },
];
export const BASE_NAMES = { satellite: 'Satellite', map: 'Map', topographic: 'Topographic', dark: 'Dark' };
export const BASE_HINTS = {
  satellite: 'The imagery filed with the map',
  map: 'A street map from OpenStreetMap, filed once now',
  topographic: 'A topographic map from OpenTopoMap, filed once now',
  dark: 'The street map drawn dark, filed once now',
};
export const IMAGERY_NAMES = { sentinel: 'Sentinel-2 · free', esri: 'Esri · sharper' };
export const IMAGERY_HINTS = {
  sentinel: 'EOX’s cloudless mosaic of a year, free with its credit (CC BY-NC-SA 4.0)',
  esri: 'Esri World Imagery, credited on the map, under Esri’s terms',
};
/** Said under Sentinel-2 on a map framed closer than about 3 km across, where its 10 m pixels show. */
export const SENTINEL_BLUR = 'Sentinel-2 is 10 m: details this close will blur.';
const BLUR_KM = 3;
export const SIZE_NAMES = { half: 'Half', wide: 'Wide', full: 'Full height' };
export const LEGEND_NAMES = { shown: 'Shown', folded: 'Folded', hidden: 'Hidden' };
export const SIZE_HINTS = { half: 'Half the text’s width', wide: 'The article’s width', full: 'As tall as the screen' };
export const SCALE_HINTS = { off: 'No scale', '': 'A scale on the page', on: 'A scale on the page and on the PDF’s picture' };
export const LABEL_HINTS = { '': 'Each layer’s own choice of names', on: 'Every mark’s name on the map', off: 'No name on the map' };
export const SPEED_NAMES = { slow: 'Slow', normal: 'Normal', fast: 'Fast' };
export const CARD_NAMES = { picture: 'Picture', sentence: 'Sentence', source: 'Source', verify: 'Verify links' };
export const LABEL_NAMES = { '': 'As set', on: 'All', off: 'None' };
export const SCALE_NAMES = { off: 'Off', '': 'Page', on: 'Page + PDF' };
export const DRAW_TOOLS = [
  { tool: 'highlight', label: 'Area to highlight', iconName: 'mapArea', title: 'Outline an area and write on it, as “about 15 km²”' },
  { tool: 'point', label: 'Point', iconName: 'pin', title: 'Put a point on the map' },
  { tool: 'line', label: 'Line', iconName: 'line', title: 'Draw a line, corner by corner' },
  { tool: 'area', label: 'Area', iconName: 'polygon', title: 'Draw an area, corner by corner' },
];
const KIND_NAMES = { point: 'Point', line: 'Line', area: 'Area' };
/** An area to highlight starts orange, apart from the proofs' yellow and the lines' blue. */
export const HIGHLIGHT_COLOUR = '#d55e00';
const longDay = (day) => {
  const at = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? day : at.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
};

/** A row of choices, one pressed: `options` are `{ value, label, title }`. */
export function segmented(label, options, value, onChange, { busy = '' } = {}) {
  const row = element('div', 'cm-map-field');
  row.append(element('span', 'cm-map-field-name', label));
  const group = element('div', 'cm-chart-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = element('button', 'cm-chart-seg-btn', option.label);
    choice.type = 'button';
    choice.setAttribute('role', 'radio');
    choice.setAttribute('aria-checked', String(option.value === value));
    if (option.title) choice.title = option.title;
    choice.disabled = Boolean(busy);
    choice.addEventListener('mousedown', (event) => event.preventDefault());
    choice.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(choice);
  }
  row.append(group);
  if (busy) row.append(element('span', 'cm-map-busy', busy));
  return row;
}

/** A text field written on Enter or when it is left: `onCommit(value)` when it changed. */
export function textField(label, value, onCommit, { placeholder = '', className = '', size = 0 } = {}) {
  const field = element('input', `cm-map-input ${className}`.trim());
  field.type = 'text';
  field.value = value;
  field.placeholder = placeholder;
  field.setAttribute('aria-label', label);
  if (size) field.size = size;
  const commit = () => {
    const typed = field.value.replace(/\s+/g, ' ').trim();
    if (typed !== value) onCommit(typed);
  };
  field.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
    }
  });
  field.addEventListener('change', commit);
  return field;
}

function dateField(label, value, onCommit, { min = '', max = '' } = {}) {
  const field = element('input', 'cm-map-input cm-map-date');
  field.type = 'date';
  field.value = value;
  if (min) field.min = min;
  if (max) field.max = max;
  field.setAttribute('aria-label', label);
  field.addEventListener('change', () => {
    if (field.value !== value) onCommit(field.value);
  });
  return field;
}

/** A colour picked from the case's palette, the plain colours after it; `none` first when given. */
function colourField(label, value, palette, onChange, { none = '' } = {}) {
  const field = element('select', 'cm-map-select cm-map-colour');
  field.setAttribute('aria-label', label);
  const options = [...(none ? [{ colour: '', name: none }] : []), ...palette];
  if (value && !options.some((one) => one.colour === value)) options.push({ colour: value, name: `Its own (${value})` });
  for (const one of options) {
    const option = element('option', '', one.name);
    option.value = one.colour;
    field.append(option);
  }
  field.value = value;
  field.style.setProperty('--swatch', value || 'transparent');
  field.addEventListener('change', () => onChange(field.value));
  return field;
}

/** The plain colours a case offers until it names its own (`PLAIN_COLOURS` of the layer palette). */
const PLAIN = [['#0072b2', 'Blue'], ['#d55e00', 'Orange'], ['#009e73', 'Green'], ['#cc79a7', 'Purple'], ['#f0e442', 'Yellow'], ['#e53935', 'Red'], ['#ffffff', 'White']];

/** The case's named colours, then the plain ones it does not name. */
export function paletteOf(named = []) {
  const kept = named.map((one) => ({ colour: one.colour, name: one.name }));
  for (const [colour, name] of PLAIN) if (!kept.some((one) => one.colour === colour)) kept.push({ colour, name });
  return kept;
}

/**
 * The settings of a map, drawn in `panel`. `ctx` answers and does what the card asks:
 * `state()` the map as it stands, `{ map, described, busy }` (`readMap`, the describe
 * answer, the press under way); `write(changes)` one choice; `base(value)` the base filed
 * and written; `imagery(value)` a satellite map's imagery, its ground filed and written with
 * it; `arm(tool, done)` a tool armed on the map; `draw(kind, coords, extra)`,
 * `edit(row, changes)` and `remove(row)` what is drawn; `addLayer(name)` another layer;
 * `fromSheet()`, when the note can, a layer made from a sheet and put on the map;
 * `sizedBy`, when the map's host sets its width (an infographic's panel), the words said in
 * place of the Size choice, a template's size then left out.
 * Answers `{ refresh, focus, destroy, open(tab) }`.
 */
export function mapSettings(panel, ctx) {
  panel.setAttribute('role', 'group');
  panel.setAttribute('aria-label', 'Map settings');
  const tabs = element('div', 'cm-map-tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Map settings');
  const body = element('div', 'cm-map-tab-body');
  body.setAttribute('role', 'tabpanel');
  panel.replaceChildren(tabs, body);
  let current = ctx.tab ?? 'look';
  /** The step whose frame is shown on the map, while the Time tab is open. */
  let pickedStep = -1;
  /** Whether Esri was picked on this card: its terms are said under the choice, once, while it stays picked. */
  let esriPicked = false;

  function renderTabs() {
    tabs.replaceChildren(...TABS.map((tab) => {
      const node = element('button', 'cm-map-tab', tab.label);
      node.type = 'button';
      node.setAttribute('role', 'tab');
      node.setAttribute('aria-selected', String(tab.id === current));
      node.dataset.tab = tab.id;
      node.addEventListener('mousedown', (event) => event.preventDefault());
      node.addEventListener('click', () => open(tab.id));
      return node;
    }));
  }

  function open(id) {
    if (!TABS.some((tab) => tab.id === id)) return;
    current = id;
    ctx.onTab?.(id);
    render();
  }

  function render() {
    const { map, described, busy } = ctx.state() ?? {};
    if (!map) return;
    const focused = panel.contains(document.activeElement) ? document.activeElement.getAttribute('aria-label') : null;
    renderTabs();
    const parts = { look, layers, draw, time, cards }[current](map, described, busy ?? '');
    body.replaceChildren(...parts.filter(Boolean));
    body.setAttribute('aria-label', TABS.find((tab) => tab.id === current)?.label ?? '');
    ctx.overlay?.(current === 'look' && map.frame ? [{ kind: 'box', coords: map.frame, dashed: true, label: 'Frame' }]
      : current === 'time' && pickedStep >= 0 && stepsOf(map, described)[pickedStep]?.view
        ? [{ kind: 'box', coords: viewBounds(stepsOf(map, described)[pickedStep].view), colour: '#ffd640', label: `Step ${pickedStep + 1}` }] : []);
    if (focused) [...panel.querySelectorAll('[aria-label]')].find((node) => node.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
  }

  // -- Look --

  function look(map, described, busy) {
    const title = element('label', 'cm-map-field cm-map-title-field');
    title.append(element('span', 'cm-map-field-name', 'Title'),
      textField('Title', map.title, (value) => ctx.write({ title: value }), { placeholder: 'What the map shows' }));
    const base = segmented('Base', BASES.map((value) => ({ value, label: BASE_NAMES[value], title: BASE_HINTS[value] })),
      map.base || 'satellite', (value) => ctx.base(value), { busy: busy.startsWith('base') ? busy.slice(5) : '' });
    // an infographic's map panel is a live map on the web page as a note's map is, and its
    // imagery is the ground its picture is filed from: both take the same two choices
    const live = Boolean(ctx.imagery);
    const imagery = live && (map.base || 'satellite') === 'satellite' ? imageryField(map, described, busy) : null;
    const frame = element('div', 'cm-map-field');
    frame.append(element('span', 'cm-map-field-name', 'Frame'));
    const actions = element('div', 'cm-map-actions');
    const drag = button('cm-map-act', { label: 'Draw the frame', iconName: 'square', title: 'Drag a rectangle over the map: it shows that part' });
    drag.addEventListener('mousedown', (event) => event.preventDefault());
    drag.addEventListener('click', () => ctx.arm('frame', (box) => ctx.write({ frame: frameText(box) })));
    const fit = button('cm-map-act', { label: 'Fit to what it shows', iconName: 'maximize', title: 'Frame the map on its marks, lines and areas' });
    fit.disabled = !described?.extent;
    fit.addEventListener('mousedown', (event) => event.preventDefault());
    fit.addEventListener('click', () => described?.extent && ctx.write({ frame: frameText(described.extent) }));
    actions.append(drag, fit);
    if (map.frame) {
      const back = button('cm-map-act', { label: 'Its ground', iconName: 'reset', title: 'Show the whole ground again' });
      back.addEventListener('mousedown', (event) => event.preventDefault());
      back.addEventListener('click', () => ctx.write({ frame: '' }));
      actions.append(back);
    }
    if (live) {
      const keep = element('label', 'cm-map-check');
      keep.title = 'The live map stops at the frame’s edges';
      const box = element('input');
      box.type = 'checkbox';
      box.checked = map.bounds === 'ground';
      box.setAttribute('aria-label', 'Keep readers inside the frame');
      box.addEventListener('change', () => ctx.write({ bounds: box.checked ? 'ground' : '' }));
      keep.append(box, element('span', '', 'Keep readers inside'));
      actions.append(keep);
    }
    frame.append(actions);
    const said = frameSaid(map, described);
    if (said) {
      const note = element('p', 'cm-map-note', said.words);
      if (said.file) {
        const press = button('cm-chart-use', { label: 'File the ground for this frame' });
        press.addEventListener('mousedown', (event) => event.preventDefault());
        press.addEventListener('click', () => ctx.base(map.base || 'satellite', { reframe: true }));
        note.append(' ', press);
      }
      frame.append(note);
    }
    const grid = element('div', 'cm-map-grid');
    grid.append(
      ctx.sizedBy ? sizedBy(ctx.sizedBy)
        : segmented('Size', SIZES.map((value) => ({ value, label: SIZE_NAMES[value], title: SIZE_HINTS[value] })), map.size || 'wide', (value) => ctx.write({ size: value === 'wide' ? '' : value })),
      segmented('Legend', LEGENDS.map((value) => ({ value, label: LEGEND_NAMES[value] })), map.legend || 'shown', (value) => ctx.write({ legend: value === 'shown' ? '' : value })),
      segmented('North arrow', [{ value: 'off', label: 'Off' }, { value: 'on', label: 'On' }], map.north === 'on' ? 'on' : 'off', (value) => ctx.write({ north: value === 'on' ? 'on' : '' })),
      segmented('Scale', ['off', '', 'on'].map((value) => ({ value, label: SCALE_NAMES[value], title: SCALE_HINTS[value] })), map.scale, (value) => ctx.write({ scale: value })),
    );
    return [title, base, imagery, frame, grid, templateLine(map)];
  }

  /**
   * Imagery, under a satellite base: Sentinel-2 or Esri, its ground filed on the press. A map that
   * names none shows the one its ground came from. Esri's terms are said once it is picked; Sentinel-2
   * says it blurs on a map framed closer than about 3 km across.
   */
  function imageryField(map, described, busy) {
    const value = map.imagery || described?.imagery || '';
    const row = segmented('Imagery', IMAGERY.map((one) => ({ value: one, label: IMAGERY_NAMES[one], title: IMAGERY_HINTS[one] })),
      value, (one) => {
        esriPicked = one === 'esri';
        ctx.imagery(one);
      }, { busy: busy.startsWith('imagery') ? busy.slice(8) : '' });
    if (value === 'esri' && esriPicked) row.append(element('p', 'cm-map-note', ESRI_TERMS));
    else if (value === 'sentinel' && acrossKm(map.frame ?? described?.bounds) < BLUR_KM) row.append(element('p', 'cm-map-note', SENTINEL_BLUR));
    return row;
  }

  /** Size, where the host sets the map's width: what says so. */
  function sizedBy(words) {
    const row = element('div', 'cm-map-field cm-map-sized');
    row.append(element('span', 'cm-map-field-name', 'Size'), element('span', 'cm-map-note', words));
    return row;
  }

  /** The template picker this card opened, closed with it. */
  let closePicker = null;
  /** Apply a template…: a map template's look over this map, its layers, frame and steps kept. */
  function templateLine(map) {
    const row = element('div', 'cm-map-field');
    row.append(element('span', 'cm-map-field-name', 'Template'));
    const press = button('cm-map-act', { label: 'Apply a template…', iconName: 'layers', title: 'A map template’s look: base, legend, size, north arrow, scale, timeline and cards' });
    press.setAttribute('aria-haspopup', 'dialog');
    press.addEventListener('mousedown', (event) => event.preventDefault());
    press.addEventListener('click', () => (closePicker = openFigurePicker(press, {
      figure: 'map',
      onapply: (answer) => {
        const { base = '', ...look } = answer?.changes ?? {};
        if (ctx.sizedBy) delete look.size;
        ctx.write(look);
        // another base is a ground filed on the press, as picking it on the card files it
        if ((base || 'satellite') !== (map.base || 'satellite')) ctx.base(base || 'satellite');
      },
    })));
    row.append(press);
    return row;
  }

  /** What the frame says: drawn by hand, and whether the ground covers it. */
  function frameSaid(map, described) {
    if (!map.frame) return described?.ground ? { words: 'It shows its whole ground, as filed.' } : null;
    const ground = described?.ground?.bounds;
    const [west, south, east, north] = map.frame;
    const covered = ground && west >= ground[0] - 1e-6 && south >= ground[1] - 1e-6 && east <= ground[2] + 1e-6 && north <= ground[3] + 1e-6;
    if (covered) return { words: 'Framed by hand, inside its ground.' };
    return { words: ground ? 'Part of this frame has no ground and shows plain.' : 'This map has no ground yet.', file: true };
  }

  // -- Layers --

  function layers(map, described, busy) {
    const palette = paletteOf(described?.palette);
    const list = element('div', 'cm-map-list');
    list.setAttribute('role', 'group');
    list.setAttribute('aria-label', 'Layers');
    for (const layer of described?.layers ?? []) {
      const row = element('div', `cm-map-row${layer.on ? '' : ' cm-map-off'}`);
      const toggle = element('input');
      toggle.type = 'checkbox';
      toggle.checked = layer.on;
      toggle.setAttribute('aria-label', `Show ${layer.title}`);
      toggle.addEventListener('change', () => ctx.write({ hide: toggle.checked ? map.hidden.filter((name) => name !== layer.name) : [...map.hidden, layer.name] }));
      const name = element('span', 'cm-map-row-name', layer.title);
      name.title = layer.from === 'plate' ? `${layer.title}, from its plate` : layer.title;
      const count = element('small', 'cm-map-count', layer.missing ? 'no longer in the case' : String(layer.features));
      const swatches = element('span', 'cm-map-swatches');
      for (const colour of (layer.colour ? [layer.colour] : layer.colours).slice(0, 4)) {
        const dot = element('i', 'cm-map-dot');
        dot.style.background = colour;
        swatches.append(dot);
      }
      const colour = colourField(`Colour of ${layer.title}`, map.colours[layer.name] ?? '', palette, (value) => {
        const colours = { ...map.colours };
        if (value) colours[layer.name] = value; else delete colours[layer.name];
        ctx.write({ colour: Object.entries(colours).map(([named, hex]) => colourText(named, hex)) });
      }, { none: 'Its own colours' });
      row.append(toggle, swatches, name, count, colour);
      list.append(row);
    }
    if (!described?.layers?.length) list.append(element('p', 'cm-map-note', 'This map draws no layer yet.'));
    const parts = [list];
    if (described?.others?.length) {
      const add = element('select', 'cm-map-select');
      add.setAttribute('aria-label', 'Add a layer');
      const option = (words, value) => {
        const node = element('option', '', words);
        node.value = value;
        return node;
      };
      add.append(option('Add a layer…', ''), ...described.others.map((other) => option(`${other.title} (${other.features})`, other.name)));
      add.addEventListener('change', () => {
        if (add.value) ctx.write({ layer: [...map.layers, add.value] });
      });
      const row = element('div', 'cm-map-field');
      row.append(element('span', 'cm-map-field-name', 'Another layer'), add);
      parts.push(row);
    }
    // a sheet's rows with a place, as a new layer of the case put on this map (`components/SheetMapDialog.svelte`)
    if (ctx.fromSheet) {
      const row = element('div', 'cm-map-field');
      const press = button('cm-map-act', { label: '＋ From a sheet…', title: 'Make a layer of a sheet’s rows with a place, and show it here' });
      press.addEventListener('mousedown', (event) => event.preventDefault());
      press.addEventListener('click', () => ctx.fromSheet());
      row.append(element('span', 'cm-map-field-name', described?.others?.length ? '' : 'Another layer'), press);
      parts.push(row);
    }
    // the proofs of a period: off, all, or from a day to another
    const proofs = element('div', 'cm-map-field');
    proofs.append(element('span', 'cm-map-field-name', 'Proofs'));
    const line = element('div', 'cm-map-actions');
    const on = element('input');
    on.type = 'checkbox';
    on.checked = Boolean(map.proofs);
    on.disabled = !described?.proofs?.count && !map.proofs;
    on.setAttribute('aria-label', 'Show the proofs');
    const [from, to] = map.proofs === 'all' ? ['', ''] : map.proofs.includes('..') ? map.proofs.split('..') : [map.proofs, map.proofs];
    on.addEventListener('change', () => ctx.write({ proofs: on.checked ? periodOf(described?.proofs?.first ?? '', described?.proofs?.last ?? '') : '' }));
    const onLabel = element('label', 'cm-map-check');
    onLabel.append(on, element('span', '', described?.proofs?.count ? `Show them (${described.proofs.count} dated)` : 'None dated yet'));
    line.append(onLabel);
    if (map.proofs) {
      line.append(element('span', 'cm-map-note', 'From'),
        dateField('Proofs from', from, (value) => ctx.write({ proofs: periodOf(value, to) })),
        element('span', 'cm-map-note', 'to'),
        dateField('Proofs to', to, (value) => ctx.write({ proofs: periodOf(from, value) })));
    }
    proofs.append(line);
    parts.push(proofs);
    if (map.proofs) {
      parts.push(segmented('Proof points', [{ value: 'every', label: 'Every point' }, { value: 'filmed', label: 'Only where it was filmed' }],
        map.proofPoints || 'every', (value) => ctx.write({ 'proof points': value === 'every' ? '' : value })));
    }
    const grid = element('div', 'cm-map-grid');
    grid.append(
      segmented('Names', ['', 'on', 'off'].map((value) => ({ value, label: LABEL_NAMES[value], title: LABEL_HINTS[value] })), map.labels, (value) => ctx.write({ labels: value })),
      segmented('Crowds past', CROWDS.map((value) => ({ value, label: value === 'off' ? 'Off' : value })), map.crowds || '12',
        (value) => ctx.write({ crowds: value === '12' ? '' : value })),
    );
    parts.push(grid);
    return parts;
  }

  // -- Draw --

  function draw(map, described, busy) {
    const palette = paletteOf(described?.palette);
    const tools = element('div', 'cm-map-actions cm-map-draw-tools');
    tools.setAttribute('role', 'toolbar');
    tools.setAttribute('aria-label', 'Draw on the map');
    for (const one of DRAW_TOOLS) {
      const press = button('cm-map-act', { label: one.label, iconName: one.iconName, title: one.title });
      press.dataset.tool = one.tool;
      press.addEventListener('mousedown', (event) => event.preventDefault());
      press.addEventListener('click', () => ctx.arm(one.tool, (coords) => {
        const highlight = one.tool === 'highlight';
        const kind = highlight ? 'area' : one.tool;
        const name = highlight ? aboutArea(areaKm2(coords)) : '';
        ctx.draw(kind, coords, { name, highlight, label: highlight, colour: highlight ? HIGHLIGHT_COLOUR : palette[0]?.colour ?? '#0072b2' });
      }));
      tools.append(press);
    }
    const into = described?.layers?.find((layer) => layer.own && layer.from === 'line');
    const where = element('p', 'cm-map-note', into ? `Kept in the layer “${into.title}”, so it is case data like any other.`
      : `Kept in a new layer of the case, “${drawingsTitle(map)}”, made at the first drawing.`);
    const rows = element('div', 'cm-map-list cm-map-drawn');
    rows.setAttribute('role', 'group');
    rows.setAttribute('aria-label', 'Drawn on this map');
    const drawn = described?.drawings ?? [];
    for (const one of drawn) rows.append(drawnRow(one, palette));
    if (!drawn.length) rows.append(element('p', 'cm-map-note', 'Nothing drawn on this map yet.'));
    return [tools, where, busy.startsWith('draw') ? element('p', 'cm-map-busy', busy.slice(5)) : null, rows];
  }

  function drawnRow(one, palette) {
    const row = element('div', 'cm-map-row cm-map-drawn-row');
    row.dataset.key = one.key;
    const kind = element('span', 'cm-map-kind');
    kind.append(icon(one.highlight ? 'mapArea' : one.kind === 'point' ? 'pin' : one.kind === 'line' ? 'line' : 'polygon', 13));
    kind.title = one.highlight ? 'Area to highlight' : KIND_NAMES[one.kind];
    const name = textField(`Name of ${one.name || KIND_NAMES[one.kind]}`, one.name, (value) => ctx.edit(one, { name: value }),
      { placeholder: one.highlight ? 'about 15 km²' : 'Its name', className: 'cm-map-name' });
    const colour = colourField(`Colour of ${one.name || KIND_NAMES[one.kind]}`, one.colour, palette, (value) => ctx.edit(one, { colour: value }));
    const from = dateField(`First day of ${one.name || KIND_NAMES[one.kind]}`, one.from, (value) => ctx.edit(one, { start: value }));
    const until = dateField(`Last day of ${one.name || KIND_NAMES[one.kind]}`, one.until, (value) => ctx.edit(one, { end: value }), { min: one.from });
    const named = element('label', 'cm-map-check');
    const box = element('input');
    box.type = 'checkbox';
    box.checked = one.label;
    box.setAttribute('aria-label', `Write ${one.name || 'its name'} on the map`);
    box.addEventListener('change', () => ctx.edit(one, { label: box.checked }));
    named.append(box, element('span', '', 'On the map'));
    const drop = button('cm-map-icon-btn', { label: `Take ${one.name || KIND_NAMES[one.kind]} out`, iconName: 'trash', alone: true, title: 'Take it out' });
    drop.addEventListener('mousedown', (event) => event.preventDefault());
    drop.addEventListener('click', () => ctx.remove(one));
    row.append(kind, name, colour, from, element('span', 'cm-map-note', 'to'), until, named, drop);
    return row;
  }

  // -- Time --

  function time(map, described, busy) {
    const days = described?.days ?? [];
    const parts = [];
    const grid = element('div', 'cm-map-grid');
    grid.append(
      segmented('Timeline', [{ value: 'on', label: 'On' }, { value: 'off', label: 'Off' }], map.timeline === 'off' ? 'off' : 'on',
        (value) => ctx.write({ timeline: value === 'off' ? 'off' : '' })),
      segmented('Play speed', SPEEDS.map((value) => ({ value, label: SPEED_NAMES[value] })), map.speed || 'normal',
        (value) => ctx.write({ speed: value === 'normal' ? '' : value })),
    );
    parts.push(grid);
    const opens = element('div', 'cm-map-field');
    opens.append(element('span', 'cm-map-field-name', 'Opens on'));
    const line = element('div', 'cm-map-actions');
    line.append(dateField('Opens on', map.opensOn, (value) => ctx.write({ 'opens on': value }), { min: days[0] ?? '', max: days.at(-1) ?? '' }));
    line.append(element('span', 'cm-map-note', map.opensOn ? '' : days.length ? `Its last day, ${longDay(days.at(-1))}` : 'It has one day'));
    if (map.opensOn) {
      const reset = button('cm-chart-use', { label: 'Its last day' });
      reset.addEventListener('mousedown', (event) => event.preventDefault());
      reset.addEventListener('click', () => ctx.write({ 'opens on': '' }));
      line.append(reset);
    }
    opens.append(line);
    parts.push(opens);
    parts.push(stepsPart(map, described));
    return parts;
  }

  /** The steps the map plays: its own, else its plate's or its proofs', as the card can write them. */
  function stepsOf(map, described) {
    if (map.steps.length) return map.steps;
    return (described?.steps ?? []).map((step) => ({ day: step.day, label: step.label, view: step.view?.[2] != null ? step.view : null,
      proof: step.proof, words: step.text || '' }));
  }

  function stepsPart(map, described) {
    const steps = stepsOf(map, described);
    const box = element('div', 'cm-map-field cm-map-steps');
    const head = element('div', 'cm-map-steps-head');
    head.append(element('span', 'cm-map-field-name', 'Story steps'));
    head.append(element('span', 'cm-map-note', map.steps.length ? 'Its own, in this order.'
      : steps.length ? 'From its proofs or its plate. A change writes them into the map.' : 'None yet.'));
    box.append(head);
    // a change to steps not yet the map's own writes them all, the change made
    const save = (next) => ctx.write({ step: next.map(stepValue) });
    const list = element('ol', 'cm-map-step-list');
    list.setAttribute('aria-label', 'Story steps');
    steps.forEach((step, index) => {
      const item = element('li', `cm-map-step${index === pickedStep ? ' cm-map-step-on' : ''}`);
      const number = element('button', 'cm-map-step-n', String(index + 1));
      number.type = 'button';
      number.title = 'Show its frame on the map';
      number.setAttribute('aria-label', `Show step ${index + 1} on the map`);
      number.addEventListener('mousedown', (event) => event.preventDefault());
      number.addEventListener('click', () => { pickedStep = pickedStep === index ? -1 : index; render(); });
      const day = element('span', 'cm-map-step-day', step.day ? longDay(step.day) : 'No day');
      const label = textField(`Name of step ${index + 1}`, step.label, (value) => save(steps.map((one, at) => (at === index ? { ...one, label: value } : one))),
        { placeholder: 'Short name', className: 'cm-map-step-label' });
      const words = textField(`Words of step ${index + 1}`, step.words, (value) => save(steps.map((one, at) => (at === index ? { ...one, words: value } : one))),
        { placeholder: 'What it shows, in a sentence', className: 'cm-map-step-words' });
      const frame = button('cm-map-icon-btn', { label: `Frame step ${index + 1}`, iconName: 'square', alone: true, title: 'Drag a rectangle over what this step shows' });
      frame.addEventListener('mousedown', (event) => event.preventDefault());
      frame.addEventListener('click', () => {
        pickedStep = index;
        ctx.arm('step', (bounds) => save(steps.map((one, at) => (at === index ? { ...one, view: fitView(bounds) } : one))));
      });
      const up = button('cm-map-icon-btn', { label: `Move step ${index + 1} up`, iconName: 'chevronUp', alone: true });
      up.disabled = index === 0;
      up.addEventListener('mousedown', (event) => event.preventDefault());
      up.addEventListener('click', () => { pickedStep = index - 1; save(moved(steps, index, index - 1)); });
      const down = button('cm-map-icon-btn', { label: `Move step ${index + 1} down`, iconName: 'chevronDown', alone: true });
      down.disabled = index === steps.length - 1;
      down.addEventListener('mousedown', (event) => event.preventDefault());
      down.addEventListener('click', () => { pickedStep = index + 1; save(moved(steps, index, index + 1)); });
      const drop = button('cm-map-icon-btn', { label: `Take step ${index + 1} out`, iconName: 'x', alone: true });
      drop.addEventListener('mousedown', (event) => event.preventDefault());
      drop.addEventListener('click', () => { pickedStep = -1; save(steps.filter((_, at) => at !== index)); });
      item.append(number, day, label, words, frame, up, down, drop);
      list.append(item);
    });
    box.append(list);
    const add = button('cm-map-act', { label: 'Add a step', iconName: 'plus', title: 'A step framed by a rectangle dragged on the map' });
    add.addEventListener('mousedown', (event) => event.preventDefault());
    add.addEventListener('click', () => {
      pickedStep = steps.length;
      ctx.arm('step', (bounds) => save([...steps, { day: described?.day || '', label: '', view: fitView(bounds), proof: '', words: '' }]));
    });
    box.append(add);
    return box;
  }

  // -- Cards --

  function cards(map) {
    const shown = map.card ?? CARD_PARTS;
    const row = element('div', 'cm-map-field');
    row.append(element('span', 'cm-map-field-name', 'A card shows'));
    const ticks = element('div', 'cm-map-actions');
    ticks.setAttribute('role', 'group');
    ticks.setAttribute('aria-label', 'A card shows');
    for (const part of CARD_PARTS) {
      const label = element('label', 'cm-map-check');
      const box = element('input');
      box.type = 'checkbox';
      box.checked = shown.includes(part);
      box.setAttribute('aria-label', CARD_NAMES[part]);
      box.addEventListener('change', () => {
        const next = CARD_PARTS.filter((one) => (one === part ? box.checked : shown.includes(one)));
        ctx.write({ card: next.length === CARD_PARTS.length ? '' : next.length ? next.join(', ') : 'none' });
      });
      label.append(box, element('span', '', CARD_NAMES[part]));
      ticks.append(label);
    }
    row.append(ticks);
    return [row, element('p', 'cm-map-note', 'A card always says what it is and its day. Press a mark in the HTML page to read one.')];
  }

  render();
  return {
    refresh: render,
    open,
    get tab() {
      return current;
    },
    focus: () => tabs.querySelector('[aria-selected="true"]')?.focus({ preventScroll: true }),
    destroy: () => { ctx.overlay?.([]); closePicker?.(); },
  };
}

/** A period of proofs as the block writes it: `all`, one day, or `from..to`. */
export function periodOf(from, to) {
  if (!from && !to) return 'all';
  if (from && to && from === to) return from;
  const [first, last] = from && to && to < from ? [to, from] : [from, to];
  return `${first}..${last}`;
}

/** The steps with the one at `from` moved to `to`. */
export function moved(steps, from, to) {
  const next = steps.slice();
  const [one] = next.splice(from, 1);
  next.splice(to, 0, one);
  return next;
}

/** How wide `[west, south, east, north]` is across its middle, in km; Infinity when it is not known. */
export function acrossKm(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4) return Infinity;
  const [west, south, east, north] = bounds;
  return (east - west) * 111.32 * Math.cos((((south + north) / 2) * Math.PI) / 180);
}

/** The title a map's own layer of drawings takes. */
export function drawingsTitle(map) {
  return map.title ? `${map.title}, drawn` : 'Drawn on a map';
}
