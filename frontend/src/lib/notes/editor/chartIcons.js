/**
 * The glyphs a chart of pictograms or silhouette rows is drawn with, set on its card
 * (`chartCard.js`, in the note and in an infographic's panel card alike):
 *
 * - **Icon**: *One for all* is the chart's `icon` line, one button that opens the picker.
 *   *One per category* gives each value the chart draws (a pictogram's parts, a silhouette
 *   row's categories, as the engine lists them) its own, written as `icons: Streit Cougar =
 *   own:…, Oshkosh M-ATV = armoured vehicle` (`engine/notes_chart_kinds.py`). Pressed, it
 *   first gives each value the icon named like it, else the chart's icon, and says which.
 * - **Flag**, for silhouette rows: none, or one per category, written as `flags:`.
 * - **The picker**: the analyst's library by group, the app's badges by group and three
 *   plain shapes, with a search, and **Import SVG…**: the same import as Settings › Icons
 *   (`iconImport.js` through `iconLibrary`), its icon taken at once.
 *
 * Every choice is one `write(changes)`, the block's lines only, one Undo step.
 */
import symbols from '../../map/layerSymbols.json';
import { BADGE_GLYPHS } from '../../map/markerGlyphs.js';
import { libraryIconUrl } from '../../map/ownIcons.js';
import { iconLibrary } from '../../iconLibrary.svelte.js';
import { setting } from './chartText.js';
import './chartIcons.css';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** The plain shapes the engine draws (`notes_chart_kinds._PLAIN_SHAPES`), and the words that name them. */
export const SHAPES = {
  dot: { label: 'Dot', d: 'M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Z' },
  square: { label: 'Square', d: 'M5 5h14v14H5Z' },
  star: { label: 'Star', d: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-2.9-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3Z' },
};
const SHAPE_WORDS = { dot: 'dot', circle: 'dot', disc: 'dot', square: 'square', star: 'star' };
const SPELLINGS = [['armored', 'armoured'], ['defense', 'defence'], ['harbor', 'harbour']];
const OWN = /^own:\s*([0-9a-f]{16})$/i;
/** The badges' groups in the order a chart wants them: the vehicles a count is mostly of first. */
const BADGE_ORDER = ['Vehicles', 'Forces', 'Events', 'Places', 'Markers', 'Sources'];
export const BADGES = symbols.filter((entry) => entry.id.startsWith('badge-') && BADGE_GLYPHS[entry.id]);

/**
 * The glyph a word of a block names, as the engine reads it (`glyph_key`): `{ kind: 'own',
 * id }` for an icon of the library, `{ kind: 'badge', id }`, `{ kind: 'shape', id }`, or null.
 */
export function readGlyph(word) {
  const text = String(word ?? '').split(/\s+/).join(' ').trim();
  const own = OWN.exec(text);
  if (own) return { kind: 'own', id: own[1].toLowerCase() };
  let name = text.toLowerCase().replace(/[\s_]+/g, '-');
  for (const [us, uk] of SPELLINGS) name = name.replaceAll(us, uk);
  if (SHAPE_WORDS[name]) return { kind: 'shape', id: SHAPE_WORDS[name] };
  for (const id of [name, `badge-${name}`]) if (BADGE_GLYPHS[id]) return { kind: 'badge', id };
  return null;
}

/** The word a glyph is written as: `own:<key>`, a badge by its name (`armoured vehicle`), a shape. */
export function glyphWord(glyph) {
  if (!glyph) return '';
  if (glyph.kind === 'own') return `own:${glyph.id}`;
  if (glyph.kind === 'badge') return glyph.id.replace(/^badge-/, '').replaceAll('-', ' ');
  return glyph.id;
}

const sameGlyph = (a, b) => Boolean(a && b && a.kind === b.kind && a.id === b.id);

/** A glyph's name, as the picker shows it. */
export function glyphLabel(glyph, library = iconLibrary) {
  if (!glyph) return 'Dot';
  if (glyph.kind === 'own') return library.find(glyph.id)?.name || 'An icon not in your library';
  if (glyph.kind === 'badge') return BADGES.find((entry) => entry.id === glyph.id)?.label ?? glyph.id;
  return SHAPES[glyph.id]?.label ?? glyph.id;
}

// -- `icons:` and `flags:` -------------------------------------------------------------------

/**
 * `Streit Cougar = own:…, Oshkosh M-ATV = armoured vehicle` read as `[value, word]` pairs, as
 * the engine reads them (`glyph_pairs`): a value's own commas kept.
 */
export function readPairs(text) {
  const pairs = [];
  let pending = '';
  for (const piece of String(text ?? '').split(',')) {
    pending = pending ? `${pending},${piece}` : piece;
    if (!piece.includes('=')) continue;
    const at = pending.lastIndexOf('=');
    const name = pending.slice(0, at).split(/\s+/).join(' ').trim();
    if (name) pairs.push([name, pending.slice(at + 1).split(/\s+/).join(' ').trim()]);
    pending = '';
  }
  return pairs;
}

/** Pairs written back, in the order given; a value holding `=` cannot be named, and is left out. */
export function writePairs(pairs) {
  return pairs.filter(([name, word]) => name && word && !name.includes('=')).map(([name, word]) => `${name} = ${word}`).join(', ');
}

/**
 * The pairs with `value`'s word set, or taken out with '': in its place when it is written,
 * else before the first pair the chart draws after it (`values`, the chart's order).
 */
export function withPair(pairs, value, word, values = []) {
  const same = (name) => name.toLowerCase() === value.toLowerCase();
  const others = pairs.filter(([name]) => !same(name));
  const at = pairs.findIndex(([name]) => same(name));
  if (!word) return others;
  if (at >= 0) return [...others.slice(0, at), [pairs[at][0], word], ...others.slice(at)];
  const rank = (name) => {
    const found = values.findIndex((one) => one.toLowerCase() === name.toLowerCase());
    return found < 0 ? values.length : found;
  };
  const before = others.findIndex(([name]) => rank(name) > rank(value));
  return before < 0 ? [...others, [value, word]] : [...others.slice(0, before), [value, word], ...others.slice(before)];
}

const fold = (text) => String(text ?? '').normalize('NFKD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The glyph whose name names `value` (`UAE` for a flag named "UAE"), among `choices`,
 * `[{ glyph, label }]` in the order they are preferred: the same name first, else the one
 * whose name stands whole in the value's, or the value's in its; null when none or two do.
 */
export function matchByName(value, choices) {
  const wanted = fold(value);
  if (!wanted) return null;
  const named = choices.map((choice) => ({ ...choice, folded: fold(choice.label) })).filter((choice) => choice.folded.length >= 2);
  const same = named.find((choice) => choice.folded === wanted);
  if (same) return same.glyph;
  const whole = (outer, inner) => ` ${outer} `.includes(` ${inner} `);
  const near = named.filter((choice) => whole(wanted, choice.folded) || whole(choice.folded, wanted));
  if (!near.length) return null;
  const longest = Math.max(...near.map((choice) => choice.folded.length));
  const best = near.filter((choice) => choice.folded.length === longest);
  return new Set(best.map((choice) => glyphWord(choice.glyph))).size === 1 ? best[0].glyph : null;
}

/** The library's icons and the app's badges as named choices, the library first. */
export function namedChoices(library = iconLibrary, { badges = true } = {}) {
  const own = library.icons.map((icon) => ({ glyph: { kind: 'own', id: icon.key }, label: icon.name }));
  return badges ? [...own, ...BADGES.map((entry) => ({ glyph: { kind: 'badge', id: entry.id }, label: entry.label }))] : own;
}

/**
 * One glyph per value: each the one named like it, else `fallback` (a word, or '' for
 * none). Answers `{ pairs, matched }`, `matched` the values a name gave their glyph.
 */
export function perCategory(values, fallback, choices) {
  const pairs = [];
  const matched = [];
  for (const value of values) {
    const found = matchByName(value, choices);
    if (found) matched.push(value);
    const word = found ? glyphWord(found) : fallback;
    if (word) pairs.push([value, word]);
  }
  return { pairs, matched };
}

/** What a One per category press says it did, in one sentence. */
export function matchedSaid(matched, total, { flags = false } = {}) {
  const thing = flags ? 'flag' : 'icon';
  if (!total) return '';
  if (!matched.length) return flags ? 'No icon of your library is named like these: pick each flag.' : `No ${thing} is named like these: each starts on the chart’s icon.`;
  const names = matched.length <= 3 ? matched.join(', ') : `${matched.length} of ${total}`;
  return matched.length === total ? `Each took the ${thing} named like it.` : `${names} took the ${thing} named like ${matched.length === 1 ? 'it' : 'them'}; ${flags ? 'pick the others' : 'the others keep the chart’s icon'}.`;
}

// -- drawing a glyph ---------------------------------------------------------------------------

function svgNode(tag, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

/** A glyph drawn small: a badge's layers or a shape in the text's colour, an icon as the library draws it. */
export function glyphNode(glyph, library = iconLibrary) {
  if (glyph?.kind === 'own') {
    const icon = library.find(glyph.id);
    if (icon?.mode === 'disc') {
      const mask = document.createElement('span');
      mask.className = 'cm-glyph-ink cm-glyph-mask';
      const url = `url("${libraryIconUrl(glyph.id)}")`;
      mask.style.maskImage = url;
      mask.style.webkitMaskImage = url;
      return mask;
    }
    const image = document.createElement('img');
    image.className = 'cm-glyph-ink';
    image.alt = '';
    image.src = libraryIconUrl(glyph.id);
    return image;
  }
  const svg = svgNode('svg', { viewBox: '0 0 24 24', class: 'cm-glyph-ink', 'aria-hidden': 'true' });
  if (glyph?.kind === 'badge') {
    for (const [mode, d, { width, rotate = 0 } = {}] of BADGE_GLYPHS[glyph.id] ?? []) {
      const solid = mode === 'fill' || mode === 'cut';
      const ink = mode === 'fill' || mode === 'line' ? 'currentColor' : 'var(--cm-glyph-paper)';
      svg.append(svgNode('path', {
        d, fill: solid ? ink : 'none', stroke: solid ? 'none' : ink, 'stroke-width': width ?? (mode === 'line' ? 2.2 : 1.3),
        'stroke-linecap': 'round', 'stroke-linejoin': 'round', ...(rotate ? { transform: `rotate(${rotate} 12 12)` } : {}),
      }));
    }
  } else {
    svg.append(svgNode('path', { d: SHAPES[glyph?.id]?.d ?? SHAPES.dot.d, fill: 'currentColor' }));
  }
  return svg;
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function caret() {
  const svg = svgNode('svg', { viewBox: '0 0 24 24', width: 12, height: 12, class: 'cm-glyph-caret', 'aria-hidden': 'true' });
  svg.append(svgNode('path', { d: 'm6 9 6 6 6-6', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round' }));
  return svg;
}

/** A button showing a glyph and its name; `empty` is what it says with none. */
function glyphButton(glyph, { label, empty = '', library, onPress }) {
  const node = element('button', `cm-glyph-button${glyph ? '' : ' cm-glyph-empty'}`);
  node.type = 'button';
  node.dataset.key = label;
  const name = glyph ? glyphLabel(glyph, library) : empty;
  node.setAttribute('aria-label', `${label}: ${name}`);
  node.setAttribute('aria-haspopup', 'dialog');
  node.title = 'Pick it from your icons or the app’s, or import an SVG';
  if (glyph) node.append(glyphNode(glyph, library));
  node.append(element('span', 'cm-glyph-name', name), caret());
  node.addEventListener('mousedown', (event) => event.preventDefault());
  node.addEventListener('click', () => onPress(node));
  return node;
}

// -- the picker --------------------------------------------------------------------------------

/** The picker's groups: the library's by group, then the badges', then the shapes. */
export function pickerGroups(library = iconLibrary) {
  const own = [];
  for (const icon of library.icons) {
    const group = icon.group || 'My icons';
    let section = own.find((one) => one.group === group);
    if (!section) own.push(section = { from: 'library', group, items: [] });
    section.items.push({ glyph: { kind: 'own', id: icon.key }, label: icon.name, words: `${icon.name} ${group}` });
  }
  const badges = BADGE_ORDER.map((group) => ({
    from: 'app', group,
    items: BADGES.filter((entry) => entry.group === group)
      .map((entry) => ({ glyph: { kind: 'badge', id: entry.id }, label: entry.label, words: [entry.label, group, ...(entry.keywords ?? [])].join(' ') })),
  })).filter((section) => section.items.length);
  const shapes = { from: 'app', group: 'Shapes', items: Object.entries(SHAPES).map(([id, shape]) => ({ glyph: { kind: 'shape', id }, label: shape.label, words: `${shape.label} shape` })) };
  return [...own, ...badges, shapes];
}

/** The groups holding what `query` names, every word of it. */
export function searchGroups(groups, query) {
  const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return groups;
  return groups.map((section) => ({ ...section, items: section.items.filter((item) => words.every((word) => item.words.toLowerCase().includes(word))) }))
    .filter((section) => section.items.length);
}

/** The tallest the picker stands, in pixels. */
const PICKER_HEIGHT = 470;
let shown = null;

/** Close the picker open now, if any. */
export function closeGlyphPicker() {
  shown?.(false);
}

/**
 * The picker under `anchor`. `onPick(glyph)` gets the glyph picked (null for `none`, the
 * choice a flag slot offers to have none); `current` is marked. Import SVG… imports through
 * `library.importFiles`, the Settings › Icons import, and picks what it filed. Answers its close.
 */
export function openGlyphPicker(anchor, { title = 'Icon', current = null, none = '', library = iconLibrary, onPick }) {
  closeGlyphPicker();
  const panel = element('div', 'cm-glyph-picker');
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', title);
  const head = element('div', 'cm-glyph-head');
  const search = element('input', 'cm-glyph-search');
  search.type = 'search';
  search.placeholder = 'Find an icon';
  search.setAttribute('aria-label', 'Find an icon');
  const importer = element('button', 'cm-glyph-import', 'Import SVG…');
  importer.type = 'button';
  importer.title = 'An SVG file of your own, added to Settings › Icons and picked here';
  const file = element('input');
  file.type = 'file';
  file.accept = '.svg,image/svg+xml';
  file.hidden = true;
  file.setAttribute('aria-label', 'An SVG file to import');
  head.append(search, importer, file);
  const status = element('p', 'cm-glyph-status');
  status.setAttribute('role', 'status');
  const body = element('div', 'cm-glyph-groups');
  const foot = element('p', 'cm-glyph-foot', 'An icon imported here joins Settings › Icons, for every chart and map.');
  panel.append(head, status, body, foot);

  const pick = (glyph) => {
    close(true);
    onPick?.(glyph);
  };
  const render = () => {
    const groups = searchGroups(pickerGroups(library), search.value);
    const parts = [];
    if (none && !search.value.trim()) {
      const clear = element('button', 'cm-glyph-none', none);
      clear.type = 'button';
      clear.setAttribute('aria-pressed', String(!current));
      clear.addEventListener('click', () => pick(null));
      parts.push(clear);
    }
    let from = '';
    for (const section of groups) {
      if (section.from !== from) {
        from = section.from;
        parts.push(element('p', 'cm-glyph-from', from === 'library' ? 'Your icons' : 'The app’s'));
      }
      const block = element('section', 'cm-glyph-section');
      block.setAttribute('aria-label', section.group);
      block.append(element('h5', 'cm-glyph-group', section.group));
      const grid = element('div', 'cm-glyph-grid');
      for (const item of section.items) {
        const choice = element('button', 'cm-glyph-item');
        choice.type = 'button';
        choice.title = item.label;
        choice.setAttribute('aria-label', item.label);
        choice.setAttribute('aria-pressed', String(sameGlyph(item.glyph, current)));
        choice.dataset.word = glyphWord(item.glyph);
        choice.append(glyphNode(item.glyph, library));
        choice.addEventListener('click', () => pick(item.glyph));
        grid.append(choice);
      }
      block.append(grid);
      parts.push(block);
    }
    if (!library.icons.length && !search.value.trim()) {
      parts.splice(none ? 1 : 0, 0, element('p', 'cm-glyph-said', 'Your library is empty: Import SVG… adds an icon, Settings › Icons a whole pack.'));
    }
    if (!groups.length) parts.push(element('p', 'cm-glyph-said', 'No icon matches that.'));
    body.replaceChildren(...parts);
  };

  importer.addEventListener('click', () => file.click());
  file.addEventListener('change', async () => {
    const picked = [...(file.files ?? [])];
    file.value = '';
    if (!picked.length) return;
    status.textContent = 'Importing…';
    importer.disabled = true;
    try {
      const answer = await library.importFiles(picked);
      const key = answer?.filed?.[0]?.key ?? answer?.added?.[0]?.key;
      if (key) {
        pick({ kind: 'own', id: key });
        return;
      }
      const skipped = answer?.skipped?.[0];
      status.textContent = skipped ? `Not imported: ${skipped.reason}.` : 'Nothing was imported.';
    } catch (error) {
      status.textContent = `Could not import it: ${error.message}`;
    } finally {
      importer.disabled = false;
    }
  });
  search.addEventListener('input', render);
  panel.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true, true);
      return;
    }
    const items = [...body.querySelectorAll('button.cm-glyph-item, button.cm-glyph-none')];
    const at = items.indexOf(document.activeElement);
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: 8, ArrowUp: -8 }[event.key];
    if (step === undefined) return;
    if (at < 0 && event.key !== 'ArrowDown') return;
    event.preventDefault();
    items[at < 0 ? 0 : Math.max(0, Math.min(items.length - 1, at + step))]?.focus();
  });

  // under its button, or over it when there is more room there, never taller than the room
  const place = () => {
    const box = anchor.getBoundingClientRect();
    const below = window.innerHeight - box.bottom - 10;
    const above = box.top - 10;
    panel.style.maxHeight = `${Math.max(160, Math.min(PICKER_HEIGHT, Math.max(below, above)))}px`;
    const width = panel.offsetWidth || 360;
    const height = panel.offsetHeight || 0;
    panel.style.left = `${Math.max(6, Math.min(box.left, window.innerWidth - width - 6))}px`;
    panel.style.top = `${height <= below || below >= above ? box.bottom + 4 : Math.max(6, box.top - height - 4)}px`;
  };
  const outside = (event) => {
    if (!panel.contains(event.target) && event.target !== anchor && !anchor.contains(event.target)) close(false);
  };
  function close(done, giveBack = false) {
    if (shown !== close) return;
    shown = null;
    panel.remove();
    document.removeEventListener('mousedown', outside, true);
    window.removeEventListener('scroll', place, true);
    window.removeEventListener('resize', place);
    anchor.setAttribute('aria-expanded', 'false');
    if (giveBack || done) anchor.focus?.({ preventScroll: true });
  }
  shown = close;
  render();
  document.body.append(panel);
  place();
  anchor.setAttribute('aria-expanded', 'true');
  document.addEventListener('mousedown', outside, true);
  window.addEventListener('scroll', place, true);
  window.addEventListener('resize', place);
  search.focus({ preventScroll: true });
  // the library is read once; the picker draws again when it comes
  Promise.resolve(library.load?.()).then(() => {
    if (shown === close) {
      render();
      place();
    }
  });
  return close;
}

// -- the card's rows ---------------------------------------------------------------------------

function segmented(label, options, value, onChange) {
  const group = element('div', 'cm-glyph-seg');
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', label);
  for (const option of options) {
    const choice = element('button', 'cm-glyph-seg-btn', option.label);
    choice.type = 'button';
    choice.setAttribute('role', 'radio');
    choice.setAttribute('aria-checked', String(option.value === value));
    choice.dataset.key = `${label}:${option.value}`;
    if (option.title) choice.title = option.title;
    choice.addEventListener('mousedown', (event) => event.preventDefault());
    choice.addEventListener('click', () => {
      if (option.value !== value) onChange(option.value);
    });
    group.append(choice);
  }
  return group;
}

/** Whether `word` names one of the table's columns, which the engine reads first. */
function namesColumn(chart, word) {
  const wanted = String(word ?? '').trim().toLowerCase();
  return Boolean(wanted && chart.table?.header?.some((header) => String(header).trim().toLowerCase() === wanted));
}

/**
 * The Icon row, and the Flag row for silhouette rows, drawn in `host` from `state()` (`{
 * chart, drawn }`, as the card reads it); `write(changes)` writes one choice. Hidden for a
 * kind that draws no glyph. Answers `{ node, refresh }`.
 */
export function chartIcons(host, { state, write, library = iconLibrary }) {
  host.classList.add('cm-chart-icons');
  host.setAttribute('role', 'group');
  host.setAttribute('aria-label', 'Icons');
  /** What the last One per category press said, and whether a flag list stands open with none picked yet. */
  let said = { icons: '', flags: '' };
  let flagsOpen = false;
  let asked = false;

  const open = (anchor, title, current, onPick, none = '') => openGlyphPicker(anchor, { title, current, none, library, onPick });

  function iconRow(chart, values) {
    const written = setting(chart, 'icon');
    const column = namesColumn(chart, written) ? written : '';
    const pairs = readPairs(setting(chart, 'icons'));
    const mode = column ? 'column' : setting(chart, 'icons') ? 'each' : 'one';
    const one = column ? null : readGlyph(written);
    const row = element('div', 'cm-chart-field cm-glyph-row');
    row.append(element('span', 'cm-chart-field-name', 'Icon'));
    const line = element('div', 'cm-glyph-line');
    line.append(segmented('Icon', [
      { value: 'one', label: 'One for all', title: 'Every glyph the same icon' },
      { value: 'each', label: 'One per category', title: 'Each category its own icon: a silhouette per model' },
    ], mode, (next) => {
      if (next === 'one') {
        said.icons = '';
        write({ icons: '' });
        return;
      }
      const made = perCategory(values, glyphWord(one) || 'dot', namedChoices(library));
      said.icons = matchedSaid(made.matched, values.length);
      write({ icons: writePairs(made.pairs), ...(column ? { icon: '' } : {}) });
    }));
    if (mode === 'one') {
      line.append(glyphButton(one ?? { kind: 'shape', id: 'dot' }, {
        label: 'Icon', library,
        onPress: (anchor) => open(anchor, 'Icon', one, (glyph) => write({ icon: glyphWord(glyph) })),
      }));
    }
    row.append(line);
    if (mode === 'column') row.append(element('p', 'cm-glyph-said', `Each row’s icon is named in its “${column}” column.`));
    if (mode === 'each') {
      const fallback = one ?? { kind: 'shape', id: 'dot' };
      row.append(valueList(values, pairs, {
        label: (value) => `Icon of ${value}`,
        glyphOf: (word) => readGlyph(word) ?? fallback,
        empty: '',
        title: (value) => `Icon of ${value}`,
        choose: (value, glyph) => {
          said.icons = '';
          write({ icons: writePairs(withPair(pairs, value, glyphWord(glyph), values)) });
        },
      }));
    }
    if (said.icons && mode === 'each') row.append(element('p', 'cm-glyph-said', said.icons));
    return row;
  }

  function flagRow(chart, values) {
    const written = setting(chart, 'flag');
    const column = namesColumn(chart, written) ? written : '';
    const pairs = readPairs(setting(chart, 'flags'));
    if (pairs.length) flagsOpen = false;
    const mode = column ? 'column' : pairs.length || flagsOpen ? 'each' : 'none';
    const row = element('div', 'cm-chart-field cm-glyph-row');
    row.append(element('span', 'cm-chart-field-name', 'Flag'));
    const line = element('div', 'cm-glyph-line');
    line.append(segmented('Flag', [
      { value: 'none', label: 'None', title: 'No flag before the rows' },
      { value: 'each', label: 'One per category', title: 'Each row its flag, before its name' },
    ], mode === 'column' ? '' : mode, (next) => {
      if (next === 'none') {
        flagsOpen = false;
        said.flags = '';
        if (pairs.length || column) write({ flags: '', ...(column ? { flag: '' } : {}) });
        else refresh();
        return;
      }
      const made = perCategory(values, '', namedChoices(library, { badges: false }));
      said.flags = matchedSaid(made.matched, values.length, { flags: true });
      if (made.pairs.length) write({ flags: writePairs(made.pairs), ...(column ? { flag: '' } : {}) });
      else {
        flagsOpen = true;
        refresh();
      }
    }));
    row.append(line);
    if (mode === 'column') row.append(element('p', 'cm-glyph-said', `Each row’s flag is named in its “${column}” column.`));
    if (mode === 'each') {
      row.append(valueList(values, pairs, {
        label: (value) => `Flag of ${value}`,
        glyphOf: (word) => readGlyph(word),
        empty: 'No flag',
        none: 'No flag',
        title: (value) => `Flag of ${value}`,
        choose: (value, glyph) => {
          said.flags = '';
          write({ flags: writePairs(withPair(pairs, value, glyphWord(glyph), values)), ...(column ? { flag: '' } : {}) });
        },
      }));
    }
    if (said.flags && mode === 'each') row.append(element('p', 'cm-glyph-said', said.flags));
    return row;
  }

  /** One line per value: its name and its glyph's button. */
  function valueList(values, pairs, { label, glyphOf, empty, none = '', title, choose }) {
    const list = element('ul', 'cm-glyph-list');
    list.setAttribute('aria-label', 'One per category');
    if (!values.length) list.append(element('li', 'cm-glyph-said', 'Drawing the chart…'));
    for (const value of values) {
      const word = pairs.find(([name]) => name.toLowerCase() === value.toLowerCase())?.[1] ?? '';
      const glyph = word ? glyphOf(word) : glyphOf('');
      const item = element('li', 'cm-glyph-value');
      item.append(element('span', 'cm-glyph-value-name', value));
      item.lastChild.title = value;
      item.append(glyphButton(glyph, {
        label: label(value), empty, library,
        onPress: (anchor) => open(anchor, title(value), word ? glyph : null, (picked) => choose(value, picked), none),
      }));
      list.append(item);
    }
    return list;
  }

  function refresh() {
    const { chart, drawn } = state() ?? {};
    const keys = drawn?.kind?.keys ?? [];
    if (!chart || !keys.includes('icon')) {
      host.hidden = true;
      host.replaceChildren();
      return;
    }
    host.hidden = false;
    if (!asked) {
      asked = true;
      // the library names its icons: drawn again once it has been read
      Promise.resolve(library.load?.()).then(() => refresh());
    }
    const values = drawn?.kind?.values ?? [];
    // the rows are drawn again on every change: the keyboard stays on the control it was on
    const focused = host.contains(document.activeElement) ? document.activeElement.dataset.key : null;
    const rows = [iconRow(chart, values)];
    if (keys.includes('flags')) rows.push(flagRow(chart, values));
    host.replaceChildren(...rows);
    if (focused) [...host.querySelectorAll('[data-key]')].find((node) => node.dataset.key === focused)?.focus({ preventScroll: true });
  }

  return { node: host, refresh };
}
