/**
 * A diagram made with the form (`editor/diagramForm.js`), as the Mermaid it writes and
 * reads back. Nothing here touches the editor.
 *
 * Six kinds, each its own Mermaid: a **flow** (steps and decisions), a **network** (who
 * is linked to whom) and an **organisation** (a tree) are flowcharts; a **timeline**, a
 * **mind map** and a **sequence** are Mermaid's own. A model is
 * `{ kind, title, direction, style, legend, boxes, links, events, colours }`:
 *
 * - `boxes`: `{ id, text, shape, category, parent }`, a sequence's people included, `parent`
 *   the box an organisation's or a mind map's box stands under ('' for none);
 * - `links`: `{ from, to, text, dashed, arrow }`, in order (a sequence's messages);
 * - `events`: a timeline's `{ id, when, text, category }`, `category` its phase, said on the
 *   event a phase starts at and left '' on the ones that carry it on;
 * - `colours`: each category's colour (`#rrggbb`), a phase's, a mind map's branch's, a
 *   sequence's group's.
 *
 * **What it writes is plain Mermaid**, drawn the same anywhere: a flowchart's categories are
 * `classDef` lines, named by a `%% legend c1: …` comment the app draws as the legend under
 * it (`lib/mermaid.js`); a sequence's groups are its `box`es; a timeline's phases and a mind
 * map's branches are coloured through `cScale` in its config. A look other than Report is
 * its theme's colours in the front matter, with `theme: base` so Mermaid works out the rest
 * from them. A network and an organisation say their kind in a `%% kind:` comment.
 *
 * **What it reads back is only what it could have written**: a line it does not know (a
 * subgraph, a style, a note, a directive, a config of its own) and the diagram opens as its
 * source rather than in a form that would drop it. A plain flowchart typed by hand reads
 * back when it keeps to boxes, the four links and classes.
 *
 * Mermaid cannot hold every character in a label, so a few are written as look-alikes and
 * read back as themselves: `<` `>` as ‹ ›, a line break as `<br>`, a sequence's `;` as ;
 * (a Greek question mark), a timeline's `:` as ꞉. A straight quote is written curly.
 */

/** The six kinds, in the gallery's order: what each is called and what it needs, in one line. */
export const DIAGRAM_KINDS = [
  { kind: 'flow', label: 'Flow', needs: 'Steps and decisions, joined by arrows' },
  { kind: 'network', label: 'Network', needs: 'Who is linked to whom, and how' },
  { kind: 'org', label: 'Organisation', needs: 'A tree: each box under the one it answers to' },
  { kind: 'timeline', label: 'Timeline', needs: 'Dated events in order, in phases if you like' },
  { kind: 'mindmap', label: 'Mind map', needs: 'One idea in the middle, its branches around it' },
  { kind: 'sequence', label: 'Sequence', needs: 'Who sends what to whom, in order' },
];

export const KIND_NAMES = Object.fromEntries(DIAGRAM_KINDS.map(({ kind, label }) => [kind, label]));

/** A box's shapes, as the form names them. */
export const SHAPE_NAMES = {
  box: 'Box', round: 'Round', diamond: 'Diamond', cylinder: 'Cylinder', person: 'Person', circle: 'Circle', cloud: 'Cloud',
};
/** What a shape says it is for, where it says anything. */
export const SHAPE_HINTS = { diamond: 'a decision', cylinder: 'records kept' };

/** The shapes each kind offers, its first the shape a new box takes. */
export const KIND_SHAPES = {
  flow: ['box', 'round', 'diamond', 'cylinder', 'person'],
  network: ['round', 'box', 'person', 'cylinder', 'diamond'],
  org: ['box', 'round', 'person', 'diamond', 'cylinder'],
  mindmap: ['box', 'round', 'circle', 'cloud'],
  sequence: ['box', 'person'],
  timeline: [],
};

/** The kinds drawn as a Mermaid flowchart, and the kinds whose boxes stand under one another. */
const FLOWCHARTS = new Set(['flow', 'network', 'org']);
const TREES = new Set(['org', 'mindmap']);
/** The kinds drawn left to right or top down, and the way each starts. */
export const DIRECTED = { flow: 'LR', network: 'LR', org: 'TD', timeline: 'LR' };
/** The kinds whose boxes take a category, and the kinds a title is written for. */
export const CATEGORISED = new Set(['flow', 'network', 'org', 'sequence']);
const TITLED = new Set(['flow', 'network', 'org', 'sequence', 'timeline']);

export const DIAGRAM_STYLES = ['report', 'book', 'dark'];
export const DIAGRAM_STYLE_NAMES = { report: 'Report', book: 'Book', dark: 'Dark' };

/**
 * The colours a category takes, in order, when the case names none for it: the charts' own
 * (`notes_charts.CATEGORICAL`), so a chart and a diagram of the same case agree.
 */
export const DIAGRAM_COLOURS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

/**
 * Each look: the page it is drawn on, its ink, how much of a category's colour a box's fill
 * takes, and the theme's colours a look other than Report writes. Report is the app's own
 * look (`lib/mermaid.js`), written as nothing.
 */
const LOOKS = {
  report: { paper: '#ffffff', ink: '#202124', box: '#fdf3e6', tint: 0.16, group: 0.14, root: '#52514e', vars: null },
  book: {
    paper: '#efe6d3', ink: '#1d1d1b', box: '#f7f1e3', tint: 0.2, group: 0.16, root: '#3d3a33',
    vars: [
      ['background', '#efe6d3'], ['primaryColor', '#f7f1e3'], ['primaryBorderColor', '#57534a'], ['primaryTextColor', '#1d1d1b'],
      ['lineColor', '#3d3a33'], ['textColor', '#1d1d1b'], ['edgeLabelBackground', '#efe6d3'],
      ['fontFamily', '"Noto Serif", Georgia, "Times New Roman"'],
    ],
  },
  dark: {
    paper: '#12161b', ink: '#e8ebef', box: '#1e252d', tint: 0.32, group: 0.24, root: '#4a525d',
    vars: [
      ['darkMode', true], ['background', '#12161b'], ['primaryColor', '#1e252d'], ['primaryBorderColor', '#8a929c'],
      ['primaryTextColor', '#e8ebef'], ['lineColor', '#b9c0c8'], ['textColor', '#e8ebef'], ['edgeLabelBackground', '#12161b'],
    ],
  },
};

const ID = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
/** Words a flowchart reads as its own, never a box's id. */
const RESERVED = new Set(['end', 'graph', 'flowchart', 'subgraph', 'style', 'class', 'classdef', 'click', 'linkstyle', 'default', 'direction']);
const HEX = /^#[0-9a-f]{6}$/i;
const GREEK_QUESTION = '\u037e';
const RAISED_COLON = '\ua789';
const WIDE_HASH = '\uff03';

// -- characters ---------------------------------------------------------------------------------

/** Straight quotes made curly: an opening one at the start or after a space or a bracket. */
function curly(text) {
  return text.replace(/"/g, (_, at) => (at === 0 || /[\s([{‹]/.test(text[at - 1]) ? '“' : '”'));
}

/**
 * A label as a flowchart, a mind map or a sequence holds it: one line per line (`<br>`), no
 * angle brackets (an HTML tag to Mermaid), no straight quote, no `#word;` (an entity),
 * no backtick (a Markdown string).
 */
function label(text) {
  return curly(String(text ?? '').trim())
    .replace(/</g, '‹').replace(/>/g, '›').replace(/`/g, 'ˋ')
    .replace(/#(?=\w+;)/g, '#\u200b')
    .replace(/\s*\n\s*/g, '<br>');
}

/** A label read back: `<br>` a line break again, the look-alikes their own characters. */
function unlabel(text) {
  return String(text ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/\u200b/g, '')
    .replace(/‹/g, '<').replace(/›/g, '>').replace(/ˋ/g, '`');
}

/** A sequence's words: a `;` would end the line there. */
function sequenceWords(text) {
  return label(text).replace(/;/g, GREEK_QUESTION);
}

function unsequenceWords(text) {
  return unlabel(text).replace(new RegExp(GREEK_QUESTION, 'g'), ';');
}

/** A timeline's day: neither `:` nor `#` (an event, a comment). */
function when(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().replace(/:/g, RAISED_COLON).replace(/#/g, WIDE_HASH);
}

function unwhen(text) {
  return String(text ?? '').trim().replace(new RegExp(RAISED_COLON, 'g'), ':').replace(new RegExp(WIDE_HASH, 'g'), '#');
}

/** A timeline's event, or its phase's name: `: ` would start the next event. */
function timelineWords(text, { phase = false } = {}) {
  const said = label(text);
  return phase ? said.replace(/:/g, RAISED_COLON) : said.replace(/:(?=\s|$)/g, RAISED_COLON);
}

function untimelineWords(text) {
  return unlabel(text).replace(new RegExp(RAISED_COLON, 'g'), ':');
}

/** One line of words, for a title or a category's name. */
function oneLine(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/** A box's, a link's or an event's words as the model keeps them: trimmed, a line break kept, quotes curly. */
function tidy(text) {
  return curly(String(text ?? '').trim().replace(/[ \t]*\n[ \t]*/g, '\n'));
}

// -- colours ------------------------------------------------------------------------------------

function rgb(hex) {
  const value = parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function toHex(parts) {
  return `#${parts.map((part) => Math.round(Math.max(0, Math.min(255, part))).toString(16).padStart(2, '0')).join('')}`;
}

/** `colour` laid over `paper` at `share`. */
function mix(colour, paper, share) {
  const top = rgb(colour);
  const bottom = rgb(paper);
  return toHex(top.map((value, at) => value * share + bottom[at] * (1 - share)));
}

/** The ink that reads on `colour`: white on a dark one, the page's ink on a light one. */
function inkOn(colour) {
  const [red, green, blue] = rgb(colour).map((value) => {
    const unit = value / 255;
    return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue > 0.36 ? '#1d1d1b' : '#ffffff';
}

/** What a category's boxes are drawn with, in a look: a tint of its colour, its colour round it, the look's ink. */
function categoryPaint(colour, style = 'report') {
  const look = LOOKS[style] ?? LOOKS.report;
  return { fill: mix(colour, look.paper, look.tint), stroke: colour, ink: look.ink };
}

/** Every category the diagram's boxes (or a timeline's phases) use, in the order they first come. */
export function categoriesOf(model) {
  const seen = [];
  const add = (name) => {
    const said = oneLine(name);
    if (said && !seen.some((one) => one.toLowerCase() === said.toLowerCase())) seen.push(said);
  };
  if (model.kind === 'timeline') for (const event of model.events) add(event.category);
  else if (model.kind === 'mindmap') for (const branch of branchesOf(model)) add(branch.text);
  else for (const box of model.boxes) add(box.category);
  return seen;
}

/** A name looked up whatever its case. */
function named(map, name) {
  const wanted = String(name ?? '').toLowerCase();
  const key = Object.keys(map ?? {}).find((one) => one.toLowerCase() === wanted);
  return key === undefined ? undefined : map[key];
}

/**
 * The colour `name` takes: the one the diagram gave it, else the case's for that name
 * (`palette`, `[{ name, colour }]`), else the next of `DIAGRAM_COLOURS` neither the diagram
 * nor the case already uses.
 */
export function colourFor(model, name, palette = []) {
  const own = named(model.colours, name);
  if (own) return own;
  const casePaint = palette.find((entry) => entry.name?.toLowerCase() === String(name).toLowerCase() && HEX.test(entry.colour ?? ''));
  if (casePaint) return casePaint.colour.toLowerCase();
  const used = new Set([...Object.values(model.colours ?? {}), ...palette.map((entry) => String(entry.colour).toLowerCase())]);
  return DIAGRAM_COLOURS.find((colour) => !used.has(colour))
    ?? DIAGRAM_COLOURS[Object.keys(model.colours ?? {}).length % DIAGRAM_COLOURS.length];
}

/** The model with a colour for each category it uses and none for the ones it no longer does. */
export function withColours(model, palette = []) {
  const colours = {};
  let working = { ...model, colours: {} };
  for (const name of categoriesOf(model)) {
    const colour = named(model.colours, name) ?? colourFor(working, name, palette);
    colours[name] = colour;
    working = { ...working, colours: { ...colours } };
  }
  // a timeline in no phases is drawn in one colour, kept under ''
  if (model.kind === 'timeline' && !Object.keys(colours).length && named(model.colours, '')) colours[''] = named(model.colours, '');
  return { ...model, colours };
}

// -- the model ------------------------------------------------------------------------------------

/** A box as the model holds it, its missing parts filled. */
function box(fields) {
  return { id: fields.id, text: tidy(fields.text), shape: fields.shape ?? 'box', category: oneLine(fields.category), parent: fields.parent ?? '' };
}

function link(fields) {
  return { from: fields.from, to: fields.to, text: tidy(fields.text), dashed: Boolean(fields.dashed), arrow: fields.arrow !== false };
}

function event(fields) {
  return { id: fields.id, when: oneLine(fields.when), text: tidy(fields.text), category: oneLine(fields.category) };
}

/** A model with every part a kind reads, in its defaults. */
export function newModel(kind, parts = {}) {
  return {
    kind,
    title: curly(oneLine(parts.title)),
    direction: DIRECTED[kind] ? (parts.direction === 'TD' || parts.direction === 'LR' ? parts.direction : DIRECTED[kind]) : '',
    style: DIAGRAM_STYLES.includes(parts.style) ? parts.style : 'report',
    legend: parts.legend !== false,
    boxes: (parts.boxes ?? []).map(box),
    links: (parts.links ?? []).map(link),
    events: (parts.events ?? []).map(event),
    colours: { ...(parts.colours ?? {}) },
  };
}

/** What each kind starts with, picked from the gallery: a small example whose words are there to be written over. */
export function starterModel(kind) {
  if (kind === 'network') {
    return newModel(kind, {
      boxes: [
        { id: 'n1', text: 'Account A', shape: 'person', category: 'Account' },
        { id: 'n2', text: 'Account B', shape: 'person', category: 'Account' },
        { id: 'n3', text: 'Channel', shape: 'round', category: 'Channel' },
      ],
      links: [
        { from: 'n1', to: 'n3', text: 'posts in', arrow: false },
        { from: 'n2', to: 'n3', text: 'posts in', arrow: false },
        { from: 'n2', to: 'n1', text: 'reposts', dashed: true, arrow: false },
      ],
    });
  }
  if (kind === 'org') {
    return newModel(kind, {
      boxes: [
        { id: 'n1', text: 'Command' },
        { id: 'n2', text: 'Unit A', parent: 'n1' },
        { id: 'n3', text: 'Unit B', parent: 'n1' },
        { id: 'n4', text: 'Team', parent: 'n2' },
      ],
    });
  }
  if (kind === 'timeline') {
    return newModel(kind, {
      events: [
        { id: 'n1', when: '1 Oct', text: 'First report' },
        { id: 'n2', when: '5 Oct', text: 'Offensive begins' },
        { id: 'n3', when: '15 Nov', text: 'Withdrawal' },
      ],
    });
  }
  if (kind === 'mindmap') {
    return newModel(kind, {
      boxes: [
        { id: 'n1', text: 'The question', shape: 'circle' },
        { id: 'n2', text: 'Who', parent: 'n1' },
        { id: 'n3', text: 'Where', parent: 'n1' },
        { id: 'n4', text: 'When', parent: 'n1' },
      ],
    });
  }
  if (kind === 'sequence') {
    return newModel(kind, {
      boxes: [
        { id: 'n1', text: 'Source', shape: 'person' },
        { id: 'n2', text: 'Analyst', shape: 'person' },
        { id: 'n3', text: 'Editor' },
      ],
      links: [
        { from: 'n1', to: 'n2', text: 'Sends a video' },
        { from: 'n2', to: 'n3', text: 'Geolocates it' },
        { from: 'n3', to: 'n2', text: 'Approves', dashed: true },
      ],
    });
  }
  return newModel('flow', {
    boxes: [
      { id: 'n1', text: 'What was seen' },
      { id: 'n2', text: 'Can it be checked?', shape: 'diamond' },
      { id: 'n3', text: 'Confirmed', shape: 'round' },
      { id: 'n4', text: 'Left open' },
    ],
    links: [
      { from: 'n1', to: 'n2' },
      { from: 'n2', to: 'n3', text: 'Yes' },
      { from: 'n2', to: 'n4', text: 'No', dashed: true },
    ],
  });
}

/** A mind map's root (the box under none) and its branches (the boxes right under it). */
function rootOf(model) {
  return model.boxes.find((one) => !one.parent) ?? null;
}

function branchesOf(model) {
  const root = rootOf(model);
  return root ? model.boxes.filter((one) => one.parent === root.id) : [];
}

/** Each box of a tree with its depth, parents before their children, siblings in the model's order. */
function walkTree(model) {
  const out = [];
  const visit = (parent, depth) => {
    for (const one of model.boxes.filter((item) => item.parent === parent)) {
      if (out.some((seen) => seen.box.id === one.id)) continue;
      out.push({ box: one, depth });
      visit(one.id, depth + 1);
    }
  };
  visit('', 0);
  return out;
}

// -- writing ------------------------------------------------------------------------------------

function quoted(value) {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

/** The front matter: a title, then the config the look, the phases or the branches need. */
function frontMatter(model, { title = '', vars = [], timeline = null } = {}) {
  const look = LOOKS[model.style] ?? LOOKS.report;
  const variables = [...(look.vars ?? []), ...vars];
  const lines = [];
  if (title) lines.push(`title: ${quoted(label(title))}`);
  if (variables.length || timeline) {
    lines.push('config:', '  theme: base');
    if (timeline) lines.push('  timeline:', `    disableMulticolor: ${timeline.single}`);
    if (variables.length) {
      lines.push('  themeVariables:');
      for (const [key, value] of variables) lines.push(`    ${key}: ${quoted(value)}`);
    }
  }
  return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
}

const FLOW_SHAPES = {
  box: (id, text) => `${id}["${text}"]`,
  round: (id, text) => `${id}("${text}")`,
  diamond: (id, text) => `${id}{"${text}"}`,
  cylinder: (id, text) => `${id}[("${text}")]`,
  circle: (id, text) => `${id}(("${text}"))`,
  person: (id, text) => `${id}@{ shape: person, label: "${text}" }`,
};

const MIND_SHAPES = {
  box: (id, text) => `${id}["${text}"]`,
  round: (id, text) => `${id}("${text}")`,
  circle: (id, text) => `${id}(("${text}"))`,
  cloud: (id, text) => `${id})"${text}"(`,
};

/** A box's words, or a space: Mermaid draws no box for a label of nothing. */
function boxWords(text) {
  return label(text) || ' ';
}

function flowArrow({ dashed, arrow }) {
  if (dashed) return arrow ? '-.->' : '-.-';
  return arrow ? '-->' : '---';
}

function writeFlowchart(model) {
  const categories = categoriesOf(model);
  const classOf = new Map(categories.map((name, at) => [name.toLowerCase(), `c${at + 1}`]));
  const lines = [`flowchart ${model.direction || DIRECTED[model.kind]}`];
  if (model.kind !== 'flow') lines.push(`  %% kind: ${model.kind}`);
  for (const one of model.boxes) {
    const draw = FLOW_SHAPES[one.shape] ?? FLOW_SHAPES.box;
    lines.push(`  ${draw(one.id, boxWords(one.text))}`);
  }
  const ids = new Set(model.boxes.map((one) => one.id));
  if (model.kind === 'org') {
    for (const one of model.boxes) if (one.parent && ids.has(one.parent)) lines.push(`  ${one.parent} --- ${one.id}`);
  } else {
    for (const one of model.links) {
      if (!ids.has(one.from) || !ids.has(one.to)) continue;
      const words = label(one.text);
      lines.push(`  ${one.from} ${flowArrow(one)}${words ? `|"${words}"|` : ''} ${one.to}`);
    }
  }
  // a category is a class: its colours, then its boxes (a person's shape takes no `:::`)
  categories.forEach((name, at) => {
    const paint = categoryPaint(named(model.colours, name) ?? DIAGRAM_COLOURS[at % DIAGRAM_COLOURS.length], model.style);
    lines.push(`  classDef c${at + 1} fill:${paint.fill},stroke:${paint.stroke},color:${paint.ink}`);
  });
  categories.forEach((name, at) => {
    const members = model.boxes.filter((one) => classOf.get(one.category.toLowerCase()) === `c${at + 1}`).map((one) => one.id);
    lines.push(`  class ${members.join(',')} c${at + 1}`);
  });
  categories.forEach((name, at) => lines.push(`  %% legend c${at + 1}: ${label(name)}`));
  if (categories.length && !model.legend) lines.push('  %% legend: off');
  return frontMatter(model, { title: model.title }) + lines.join('\n');
}

function sequenceArrow({ dashed, arrow }) {
  return `${dashed ? '--' : '-'}${arrow ? '>>' : '>'}`;
}

function writeSequence(model) {
  const look = LOOKS[model.style] ?? LOOKS.report;
  const lines = ['sequenceDiagram'];
  let group = null;
  model.boxes.forEach((one, at) => {
    const name = one.category;
    if (group !== null && name.toLowerCase() !== group.toLowerCase()) {
      lines.push('  end');
      group = null;
    }
    if (name && group === null) {
      const [red, green, blue] = rgb(named(model.colours, name) ?? DIAGRAM_COLOURS[at % DIAGRAM_COLOURS.length]);
      lines.push(`  box rgba(${red},${green},${blue},${look.group}) ${sequenceWords(name)}`);
      group = name;
    }
    const keyword = one.shape === 'person' ? 'actor' : 'participant';
    lines.push(`${group !== null ? '    ' : '  '}${keyword} ${one.id} as ${sequenceWords(one.text) || '\u00a0'}`);
  });
  if (group !== null) lines.push('  end');
  const ids = new Set(model.boxes.map((one) => one.id));
  for (const one of model.links) {
    if (!ids.has(one.from) || !ids.has(one.to)) continue;
    lines.push(`  ${one.from}${sequenceArrow(one)}${one.to}: ${sequenceWords(one.text)}`.trimEnd());
  }
  return frontMatter(model, { title: model.title }) + lines.join('\n');
}

/** A timeline's phases, as they start: each event says the phase it starts, or '' when it carries the one above on. */
function phasesFrom(events) {
  let current = '';
  return events.map((one) => {
    const phase = oneLine(one.category);
    if (!phase || phase.toLowerCase() === current.toLowerCase()) return { ...one, category: '' };
    current = phase;
    return { ...one, category: phase };
  });
}

/** The colours a run of `names` takes, as `cScale<first + at>` and its words' ink. */
function scale(model, names, first) {
  const vars = [];
  names.forEach((name, at) => {
    if (first + at > 11) return;
    const colour = named(model.colours, name) ?? DIAGRAM_COLOURS[at % DIAGRAM_COLOURS.length];
    vars.push([`cScale${first + at}`, colour], [`cScaleLabel${first + at}`, inkOn(colour)]);
  });
  return vars;
}

function writeTimeline(model) {
  const events = phasesFrom(model.events);
  const phases = events.filter((one) => one.category).map((one) => one.category);
  const lines = [model.direction === 'TD' ? 'timeline TD' : 'timeline'];
  if (model.title) lines.push(`  title ${timelineWords(model.title, { phase: true })}`);
  let open = null;
  let indent = '  ';
  for (const one of events) {
    if (one.category) {
      lines.push(`  section ${timelineWords(one.category, { phase: true })}`);
      indent = '    ';
      open = null;
    }
    const day = when(one.when) || '–';
    const words = timelineWords(one.text) || ' ';
    // the next event of the same day joins its line, as the timeline draws it
    if (open && open.day === day && !one.category) {
      lines[open.line] += ` : ${words}`;
      continue;
    }
    open = { day, line: lines.length };
    lines.push(`${indent}${day} : ${words}`);
  }
  const single = phases.length === 0;
  const names = single ? [''] : phases;
  const vars = single
    ? [['cScale0', named(model.colours, '') ?? DIAGRAM_COLOURS[0]], ['cScaleLabel0', inkOn(named(model.colours, '') ?? DIAGRAM_COLOURS[0])]]
    : scale(model, names, 0);
  return frontMatter(model, { vars, timeline: { single } }) + lines.join('\n');
}

function writeMindmap(model) {
  const look = LOOKS[model.style] ?? LOOKS.report;
  const lines = ['mindmap'];
  for (const { box: one, depth } of walkTree(model)) {
    const draw = MIND_SHAPES[one.shape] ?? MIND_SHAPES.box;
    lines.push(`${'  '.repeat(depth + 1)}${draw(one.id, boxWords(one.text))}`);
  }
  const branches = branchesOf(model).map((one) => oneLine(one.text));
  const vars = [['git0', look.root], ['gitBranchLabel0', inkOn(look.root)], ...scale(model, branches, 1)];
  return frontMatter(model, { vars }) + lines.join('\n');
}

/** The Mermaid a model writes: what goes between the fence's lines. */
export function writeDiagram(model) {
  const sure = withColours(newModel(model.kind, model));
  if (FLOWCHARTS.has(sure.kind)) return writeFlowchart(sure);
  if (sure.kind === 'sequence') return writeSequence(sure);
  if (sure.kind === 'timeline') return writeTimeline(sure);
  if (sure.kind === 'mindmap') return writeMindmap(sure);
  throw new Error(`No diagram of the kind ${sure.kind}`);
}

/** The whole fence, as the note holds it. */
export function diagramFence(model) {
  return `\`\`\`mermaid\n${writeDiagram(model)}\n\`\`\``;
}

/** What a fence holds between its two lines. */
export function fenceSource(fence) {
  return String(fence ?? '').replace(/^\s*(```|~~~)[^\n]*\n/, '').replace(/\n\s*(```|~~~)\s*$/, '');
}

// -- reading ------------------------------------------------------------------------------------

/** The keys a written config may hold, and the look its background says. */
const STYLE_BY_PAPER = { '#efe6d3': 'book', '#12161b': 'dark' };
const KNOWN_VARS = new Set([
  ...Object.values(LOOKS).flatMap((look) => (look.vars ?? []).map(([key]) => key)),
  'git0', 'gitBranchLabel0',
  ...Array.from({ length: 12 }, (_, at) => [`cScale${at}`, `cScaleLabel${at}`]).flat(),
]);

function unquote(value) {
  const raw = value.trim();
  if (/^"/.test(raw)) {
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (raw === 'true' || raw === 'false') return raw === 'true';
  return raw.replace(/^'(.*)'$/, '$1');
}

/** The front matter read: `{ title, style, vars, single, body }`, or null when it holds what the form would not write. */
function readFront(source) {
  const text = String(source ?? '').replace(/\r\n/g, '\n');
  const found = /^\s*---[ \t]*\n([\s\S]*?)\n---[ \t]*\n/.exec(text);
  const out = { title: '', style: 'report', vars: {}, single: null, body: found ? text.slice(found[0].length) : text };
  if (!found) return out;
  let section = '';
  for (const line of found[1].split('\n')) {
    if (!line.trim()) continue;
    const pair = /^( *)([A-Za-z0-9]+):[ \t]*(.*)$/.exec(line);
    if (!pair) return null;
    const [, spaces, key, value] = pair;
    const depth = spaces.length;
    if (depth === 0) {
      if (key === 'title') {
        const title = unquote(value);
        if (typeof title !== 'string') return null;
        out.title = oneLine(unlabel(title));
        section = '';
      } else if (key === 'config' && !value.trim()) section = 'config';
      else return null;
    } else if (depth === 2 && section.startsWith('config')) {
      if (key === 'theme' && unquote(value) === 'base') section = 'config';
      else if ((key === 'themeVariables' || key === 'timeline') && !value.trim()) section = `config.${key}`;
      else return null;
    } else if (depth === 4 && section === 'config.themeVariables') {
      if (!KNOWN_VARS.has(key)) return null;
      out.vars[key] = unquote(value);
    } else if (depth === 4 && section === 'config.timeline' && key === 'disableMulticolor') {
      out.single = unquote(value) === true;
    } else return null;
  }
  if (out.vars.background !== undefined) {
    out.style = STYLE_BY_PAPER[String(out.vars.background).toLowerCase()];
    if (!out.style) return null;
  }
  return out;
}

/** The lines of a diagram's body that say something, trimmed. */
function bodyLines(body) {
  return body.split('\n').map((line) => line.trim()).filter(Boolean);
}

const QUOTED = '"([^"]*)"';
/** A flowchart box's shape after its id, quoted or not, most specific first. */
const FLOW_NODE = [
  ['cylinder', new RegExp(`^\\[\\(${QUOTED}\\)\\]`), /^\[\(([^"()[\]]*)\)\]/],
  ['circle', new RegExp(`^\\(\\(${QUOTED}\\)\\)`), /^\(\(([^"()]*)\)\)/],
  ['box', new RegExp(`^\\[${QUOTED}\\]`), /^\[([^"[\]()]*)\]/],
  ['round', new RegExp(`^\\(${QUOTED}\\)`), /^\(([^"()[\]]*)\)/],
  ['diamond', new RegExp(`^\\{${QUOTED}\\}`), /^\{([^"{}]*)\}/],
];
const SHAPE_WORDS = {
  rect: 'box', rectangle: 'box', proc: 'box', process: 'box', rounded: 'round', event: 'round', diam: 'diamond', diamond: 'diamond',
  decision: 'diamond', question: 'diamond', cyl: 'cylinder', cylinder: 'cylinder', db: 'cylinder', database: 'cylinder',
  circle: 'circle', circ: 'circle', person: 'person',
};

/** A box written at the start of `text`: `{ id, shape, text, cls, rest }`, its shape null when only its id is written. */
function readFlowNode(text) {
  const head = /^([A-Za-z0-9_]+)/.exec(text);
  if (!head || RESERVED.has(head[1].toLowerCase())) return null;
  const id = head[1];
  let rest = text.slice(id.length);
  let shape = null;
  let words = null;
  for (const [name, withQuotes, bare] of FLOW_NODE) {
    const found = withQuotes.exec(rest) ?? bare.exec(rest);
    if (found) {
      shape = name;
      words = found[1];
      rest = rest.slice(found[0].length);
      break;
    }
  }
  if (!shape && rest.startsWith('@{')) {
    const end = rest.indexOf('}');
    if (end < 0) return null;
    const fields = {};
    for (const part of rest.slice(2, end).matchAll(/([A-Za-z]+)\s*:\s*("(?:[^"\\]|\\.)*"|[^,]+)/g)) {
      fields[part[1]] = part[2].trim().startsWith('"') ? unquote(part[2]) : part[2].trim();
    }
    if (Object.keys(fields).some((key) => key !== 'shape' && key !== 'label')) return null;
    shape = SHAPE_WORDS[String(fields.shape ?? '').toLowerCase()];
    if (!shape || typeof fields.label !== 'string') return null;
    words = fields.label;
    rest = rest.slice(end + 1);
  }
  let cls = '';
  const classed = /^:::([A-Za-z0-9_]+)/.exec(rest);
  if (classed) {
    cls = classed[1];
    rest = rest.slice(classed[0].length);
  }
  return { id, shape, text: words === null ? null : unlabel(words).replace(/^ $/, ''), cls, rest };
}

const FLOW_ARROWS = { '-->': { dashed: false, arrow: true }, '---': { dashed: false, arrow: false }, '-.->': { dashed: true, arrow: true }, '-.-': { dashed: true, arrow: false } };
const CLASS_DEF = /^classDef\s+(c\d+)\s+fill:(#[0-9a-fA-F]{6}),stroke:(#[0-9a-fA-F]{6}),color:(#[0-9a-fA-F]{6});?$/;

function readFlowchart(lines, front) {
  const head = /^(?:flowchart|graph)(?:\s+(LR|TD|TB))?;?$/.exec(lines[0]);
  if (!head) return null;
  const boxes = new Map();
  const links = [];
  const classes = new Map();
  const legend = new Map();
  let kind = 'flow';
  let shown = true;
  const meet = (node) => {
    const known = boxes.get(node.id) ?? { id: node.id, text: node.id, shape: 'box', category: '', cls: '' };
    if (node.shape) {
      known.shape = node.shape;
      known.text = node.text;
    }
    if (node.cls) known.cls = node.cls;
    boxes.set(node.id, known);
  };
  for (const line of lines.slice(1)) {
    const kindLine = /^%%\s*kind:\s*(flow|network|org)$/.exec(line);
    const legendLine = /^%%\s*legend\s+(c\d+):\s*(.+)$/.exec(line);
    const classDef = CLASS_DEF.exec(line);
    const classLine = /^class\s+([A-Za-z0-9_,\s]+?)\s+(c\d+);?$/.exec(line);
    if (kindLine) kind = kindLine[1];
    else if (legendLine) legend.set(legendLine[1], oneLine(unlabel(legendLine[2])));
    else if (/^%%\s*legend:\s*off$/.test(line)) shown = false;
    else if (classDef) classes.set(classDef[1], classDef[3].toLowerCase());
    else if (classLine) {
      for (const id of classLine[1].split(',').map((one) => one.trim())) {
        if (!ID.test(id)) return null;
        meet({ id, shape: null, cls: classLine[2] });
      }
    } else if (line.startsWith('%%')) return null;
    else {
      const first = readFlowNode(line);
      if (!first) return null;
      const rest = first.rest.trim().replace(/;$/, '');
      if (!rest) {
        meet(first);
        continue;
      }
      const arrow = /^(-\.->|-\.-|-->|---)(?:\|(?:"([^"]*)"|([^|"]*))\|)?\s*/.exec(rest);
      if (!arrow) return null;
      const second = readFlowNode(rest.slice(arrow[0].length));
      if (!second || second.rest.trim().replace(/;$/, '')) return null;
      meet(first);
      meet(second);
      links.push({ from: first.id, to: second.id, text: unlabel(arrow[2] ?? arrow[3] ?? '').trim(), ...FLOW_ARROWS[arrow[1]] });
    }
  }
  const colours = {};
  const names = new Map();
  for (const [cls, stroke] of classes) {
    const name = legend.get(cls) ?? cls;
    names.set(cls, name);
    colours[name] = stroke;
  }
  const list = [...boxes.values()].map((one) => {
    if (one.cls && !names.has(one.cls)) throw new Error('unread class');
    return box({ ...one, category: one.cls ? names.get(one.cls) : '' });
  });
  const direction = head[1] === 'LR' ? 'LR' : 'TD';
  const parts = { title: front.title, direction, style: front.style, legend: shown, boxes: list, links, colours };
  if (kind === 'org') {
    // a tree, said with plain lines: each box under the one line that reaches it
    const parents = new Map();
    const tree = links.every((one) => !one.text && !one.dashed && !one.arrow && !parents.has(one.to) && parents.set(one.to, one.from));
    if (tree) {
      return newModel('org', { ...parts, boxes: list.map((one) => ({ ...one, parent: parents.get(one.id) ?? '' })), links: [] });
    }
    kind = 'flow';
  }
  return newModel(kind, parts);
}

const SEQUENCE_ARROWS = { '->>': { dashed: false, arrow: true }, '-->>': { dashed: true, arrow: true }, '->': { dashed: false, arrow: false }, '-->': { dashed: true, arrow: false } };

function readSequence(lines, front) {
  if (!/^sequenceDiagram;?$/.test(lines[0])) return null;
  const boxes = new Map();
  const links = [];
  const colours = {};
  let group = null;
  for (const line of lines.slice(1)) {
    const groupLine = /^box\s+rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*[\d.]+\s*\)\s+(.+)$/.exec(line);
    const person = /^(participant|actor)\s+([A-Za-z0-9_]+)(?:\s+as(?:\s+(.*))?)?$/.exec(line);
    const message = /^([A-Za-z0-9_]+)\s*(-->>|->>|-->|->)\s*([A-Za-z0-9_]+)\s*:(.*)$/.exec(line);
    if (groupLine) {
      if (group !== null) return null;
      group = oneLine(unsequenceWords(groupLine[4]));
      colours[group] = toHex(groupLine.slice(1, 4).map(Number));
    } else if (line === 'end') {
      if (group === null) return null;
      group = null;
    } else if (person) {
      if (!ID.test(person[2]) || boxes.has(person[2])) return null;
      const said = /\sas\b/.test(line) ? unsequenceWords(person[3] ?? '').trim() : person[2];
      boxes.set(person[2], box({ id: person[2], text: said, shape: person[1] === 'actor' ? 'person' : 'box', category: group ?? '' }));
    } else if (message) {
      if (group !== null) return null;
      for (const id of [message[1], message[3]]) {
        if (!ID.test(id)) return null;
        if (!boxes.has(id)) boxes.set(id, box({ id, text: id }));
      }
      links.push({ from: message[1], to: message[3], text: unsequenceWords(message[4]).trim(), ...SEQUENCE_ARROWS[message[2]] });
    } else return null;
  }
  if (group !== null) return null;
  return newModel('sequence', { title: front.title, style: front.style, boxes: [...boxes.values()], links, colours });
}

function readTimeline(lines, front) {
  const head = /^timeline(?:\s+(LR|TD))?$/.exec(lines[0]);
  if (!head) return null;
  const events = [];
  let title = '';
  let phase = '';
  let phaseCount = 0;
  let count = 0;
  for (const line of lines.slice(1)) {
    const titled = /^title\s+(.+)$/.exec(line);
    const section = /^section\s+([^:\n]+)$/.exec(line);
    if (titled) {
      if (title || events.length) return null;
      title = oneLine(untimelineWords(titled[1]));
    } else if (section) {
      phase = oneLine(untimelineWords(section[1]));
      phaseCount += 1;
    } else {
      const parts = line.split(/\s:\s|\s:$/);
      if (parts.length < 2 || /[#:]/.test(parts[0])) return null;
      const day = unwhen(parts[0]);
      for (const words of parts.slice(1)) {
        count += 1;
        events.push(event({ id: `n${count}`, when: day === '–' ? '' : day, text: untimelineWords(words).trim(), category: phase }));
        phase = '';
      }
    }
  }
  if (phaseCount !== events.filter((one) => one.category).length) return null;
  const colours = {};
  const phases = events.filter((one) => one.category).map((one) => one.category);
  if (phases.length) phases.forEach((name, at) => { if (HEX.test(front.vars[`cScale${at}`] ?? '')) colours[name] = front.vars[`cScale${at}`].toLowerCase(); });
  else if (HEX.test(front.vars.cScale0 ?? '') && front.vars.cScale0.toLowerCase() !== DIAGRAM_COLOURS[0]) colours[''] = front.vars.cScale0.toLowerCase();
  return newModel('timeline', { title, direction: head[1] === 'TD' ? 'TD' : 'LR', style: front.style, events, colours });
}

const MIND_NODE = [
  ['circle', new RegExp(`^\\(\\(${QUOTED}\\)\\)$`), /^\(\(([^"()]*)\)\)$/],
  ['cloud', new RegExp(`^\\)${QUOTED}\\($`), /^\)([^"()]*)\($/],
  ['box', new RegExp(`^\\[${QUOTED}\\]$`), /^\[([^"[\]]*)\]$/],
  ['round', new RegExp(`^\\(${QUOTED}\\)$`), /^\(([^"()]*)\)$/],
];

function readMindmap(rawLines, front) {
  const lines = rawLines.filter((line) => line.trim());
  if (!/^\s*mindmap\s*$/.test(lines[0])) return null;
  const boxes = [];
  const stack = [];
  let count = 0;
  for (const line of lines.slice(1)) {
    const indent = line.length - line.trimStart().length;
    const text = line.trim();
    if (text.startsWith('%%') || text.startsWith('::')) return null;
    const head = /^([A-Za-z0-9_]+)(?=[[()])/.exec(text);
    let id = head?.[1] ?? '';
    let shape = 'box';
    let words = null;
    const rest = head ? text.slice(id.length) : text;
    for (const [name, withQuotes, bare] of MIND_NODE) {
      const found = withQuotes.exec(rest) ?? bare.exec(rest);
      if (found) {
        shape = name;
        words = found[1];
        break;
      }
    }
    if (words === null) {
      if (head || /[[\](){}]/.test(text)) return null;
      words = text;
      id = '';
    }
    count += 1;
    if (!id || !ID.test(id) || boxes.some((one) => one.id === id)) id = `n${count}`;
    while (stack.length && stack[stack.length - 1].indent >= indent) stack.pop();
    if (!stack.length && boxes.length) return null;
    boxes.push(box({ id, text: unlabel(words).replace(/^ $/, ''), shape, parent: stack[stack.length - 1]?.id ?? '' }));
    stack.push({ indent, id });
  }
  if (!boxes.length) return null;
  const model = newModel('mindmap', { style: front.style, boxes });
  const colours = {};
  branchesOf(model).forEach((one, at) => {
    const colour = front.vars[`cScale${at + 1}`];
    if (HEX.test(colour ?? '')) colours[oneLine(one.text)] = colour.toLowerCase();
  });
  return { ...model, colours };
}

/**
 * The model a diagram's Mermaid reads as, or null when it holds what the form would not
 * write (it then opens as its source).
 */
export function readDiagram(source) {
  const front = readFront(source);
  if (!front) return null;
  const raw = front.body.replace(/\r\n/g, '\n');
  const lines = bodyLines(raw);
  if (!lines.length) return null;
  try {
    if (/^(flowchart|graph)\b/.test(lines[0])) return front.single === null ? readFlowchart(lines, front) : null;
    if (/^sequenceDiagram\b/.test(lines[0])) return front.single === null ? readSequence(lines, front) : null;
    if (/^timeline\b/.test(lines[0])) {
      if (front.title) return null;
      return readTimeline(lines, front);
    }
    if (/^mindmap\b/.test(lines[0])) return front.title || front.single !== null ? null : readMindmap(raw.split('\n'), front);
  } catch {
    return null;
  }
  return null;
}

// -- gestures ------------------------------------------------------------------------------------

/** An id no box or event of the model holds yet: `n` and the next number. */
export function nextId(model) {
  const taken = [...model.boxes, ...model.events].map((one) => /^n(\d+)$/.exec(one.id)?.[1]).filter(Boolean).map(Number);
  return `n${Math.max(0, ...taken) + 1}`;
}

/** A box added at the end, its words to write: under the root of a tree, the kind's first shape. */
export function addBox(model, fields = {}) {
  const id = nextId(model);
  const parent = TREES.has(model.kind) ? (fields.parent ?? rootOf(model)?.id ?? '') : '';
  const shape = fields.shape ?? (model.kind === 'mindmap' && !rootOf(model) ? 'circle' : KIND_SHAPES[model.kind]?.[0] ?? 'box');
  return { model: { ...model, boxes: [...model.boxes, box({ id, text: fields.text ?? '', shape, category: fields.category ?? '', parent })] }, id };
}

/** A link added at the end: from the box before the last to the last, or from the last to itself when there is one. */
export function addLink(model) {
  const ids = model.boxes.map((one) => one.id);
  if (!ids.length) return { model, index: -1 };
  const from = ids.length > 1 ? ids[ids.length - 2] : ids[0];
  const to = ids[ids.length - 1];
  const arrow = model.kind !== 'network';
  const links = [...model.links, link({ from, to, arrow })];
  return { model: { ...model, links }, index: links.length - 1 };
}

/** An event added at the end of a timeline. */
export function addEvent(model) {
  const id = nextId(model);
  return { model: { ...model, events: [...model.events, event({ id })] }, id };
}

/** One box changed. */
export function changeBox(model, id, changes) {
  return { ...model, boxes: model.boxes.map((one) => (one.id === id ? box({ ...one, ...changes }) : one)) };
}

export function changeLink(model, index, changes) {
  return { ...model, links: model.links.map((one, at) => (at === index ? link({ ...one, ...changes }) : one)) };
}

export function changeEvent(model, id, changes) {
  return { ...model, events: model.events.map((one) => (one.id === id ? event({ ...one, ...changes }) : one)) };
}

/** A box taken out, with its links; the boxes under it go under the one it stood under. */
export function removeBox(model, id) {
  const gone = model.boxes.find((one) => one.id === id);
  if (!gone) return model;
  // a mind map keeps one root: the first box under the one taken out takes its place
  const heir = model.kind === 'mindmap' && !gone.parent ? model.boxes.find((one) => one.parent === id) : null;
  if (heir) {
    return {
      ...model,
      boxes: model.boxes.filter((one) => one.id !== id)
        .map((one) => (one.id === heir.id ? { ...one, parent: '' } : one.parent === id ? { ...one, parent: heir.id } : one)),
    };
  }
  return {
    ...model,
    boxes: model.boxes.filter((one) => one.id !== id).map((one) => (one.parent === id ? { ...one, parent: gone.parent } : one)),
    links: model.links.filter((one) => one.from !== id && one.to !== id),
  };
}

export function removeLink(model, index) {
  return { ...model, links: model.links.filter((_, at) => at !== index) };
}

export function removeEvent(model, id) {
  return { ...model, events: model.events.filter((one) => one.id !== id) };
}

/** An item of `list` (`boxes`, `links`, `events`) moved `by` places, held at the ends. */
export function moveItem(model, list, at, by) {
  const items = [...model[list]];
  const to = Math.max(0, Math.min(items.length - 1, at + by));
  if (to === at || at < 0 || at >= items.length) return model;
  const [moved] = items.splice(at, 1);
  items.splice(to, 0, moved);
  return { ...model, [list]: items };
}

/** Whether `child` may stand under `parent`: never under itself or one of its own. */
export function canStandUnder(model, child, parent) {
  for (let at = parent, steps = 0; at && steps <= model.boxes.length; steps += 1) {
    if (at === child) return false;
    at = model.boxes.find((one) => one.id === at)?.parent ?? '';
  }
  return true;
}

/** The categories the model's boxes may take, as the form offers them: its own, then the case's names. */
export function categoryChoices(model, palette = []) {
  const own = categoriesOf(model);
  const fromCase = palette.map((entry) => entry.name).filter((name) => name && !own.some((one) => one.toLowerCase() === name.toLowerCase()));
  return [...own, ...fromCase];
}

/** Whether a kind's form draws its boxes under one another, and whether it says a title. */
export function isTree(kind) {
  return TREES.has(kind);
}

export function hasTitle(kind) {
  return TITLED.has(kind);
}

/**
 * The model drawn as another kind, its boxes and links kept, or null when it cannot be: a
 * timeline is made of dated events, which no other kind holds. A tree's lines become links
 * from the box above; a kind of tree puts each box under the first box a link reaches it
 * from, never under itself or one of its own (a mind map's other roots under its first).
 */
export function convertModel(model, kind) {
  if (kind === model.kind) return model;
  if (kind === 'timeline' || model.kind === 'timeline' || !KIND_NAMES[kind]) return null;
  const links = TREES.has(model.kind)
    ? model.boxes.filter((one) => one.parent).map((one) => link({ from: one.parent, to: one.id, arrow: kind !== 'network' }))
    : model.links;
  const shapes = KIND_SHAPES[kind];
  const boxes = model.boxes.map((one) => ({ ...one, shape: shapes.includes(one.shape) ? one.shape : shapes[0], parent: '' }));
  const base = newModel(kind, { ...model, direction: DIRECTED[kind] ?? '', boxes, links: TREES.has(kind) ? [] : links });
  if (!TREES.has(kind)) return base;
  let next = base;
  for (const one of links) {
    const child = next.boxes.find((item) => item.id === one.to);
    if (child && !child.parent && one.from !== one.to && canStandUnder(next, one.to, one.from)) next = changeBox(next, one.to, { parent: one.from });
  }
  if (kind === 'mindmap') {
    const roots = next.boxes.filter((one) => !one.parent);
    for (const one of roots.slice(1)) next = changeBox(next, one.id, { parent: roots[0].id });
  }
  return next;
}
