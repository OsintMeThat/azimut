/**
 * Words found in the `?` guide, for the search at the top of its menu and for Ctrl+K.
 *
 * Every place the guide says something is a row: a page and its lead, each number on a
 * page and on the screens its numbers open, the tips, a journey and each of its steps,
 * a shortcut and a fix. A row carries where the guide opens on it (`place`: the menu
 * entry, its tab, the numbers walked to reach the screen, the number to light, the
 * journey's step), and what it says for the list (`where`). The index is read from
 * `guide.js` once, at the first search, and nothing of it leaves the page.
 */
import { EXTENSION_SITES, FIXES, JOURNEYS, KEYMAP, MENU_ITEMS, PAGES, tabLabel, toolLabel } from './guide.js';
import { foldTerms, foldText } from './textFold.js';

/** The fewest letters a search reads, so one letter does not list the whole guide. */
export const GUIDE_SEARCH_MIN = 2;

/** Words a question is made of rather than about: dropped, unless nothing else is typed. */
const SMALL = new Set(('a an the of to in on at for with and or is are was were be been it its this that these those how what when '
  + 'where why who which do does did can could should would will i my me we our you your there from by as into about').split(' '));

let index = null;

const words = (...parts) => parts.flat().filter(Boolean).join(' ');
const capital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** A page's rows: the page, its numbers and its tips, then the screens the numbers open. */
function pageRows(rows, page, title, where, place) {
  rows.push({ title, where, text: page.lead, place: { ...place, path: [] }, kind: 'page' });
  const walk = (marks, tips, path, crumbs) => {
    const said = [title, ...crumbs].join(' › ');
    for (const mark of marks ?? []) {
      rows.push({
        title: mark.title,
        where: said,
        text: words(mark.text, mark.opens?.lead),
        place: { ...place, path, mark: mark.anchor },
        kind: 'mark',
      });
      if (mark.opens) walk(mark.opens.marks, mark.opens.tips, [...path, mark.anchor], [...crumbs, mark.title]);
    }
    for (const tip of tips ?? []) rows.push({ title: tip.title, where: `${said} · tip`, text: tip.text, place: { ...place, path }, kind: 'tip' });
  };
  walk(page.marks, page.tips, [], []);
}

/** What a journey's step says, a video's own words included, for the search to read. */
function stepWords(step) {
  const read = (one) => [
    one.text,
    one.tip,
    one.then,
    Object.values(one.does ?? {}),
    (one.marks ?? []).map((mark) => (typeof mark === 'string' ? '' : [mark.title, mark.tip])),
    (one.choices ?? []).map((choice) => [choice.label, choice.text]),
  ];
  return words(read(step), step.video ? read(step.video) : []);
}

function build() {
  const rows = [];
  for (const item of MENU_ITEMS) {
    if (item.kind === 'page') pageRows(rows, PAGES[item.id], item.label, 'Guide', { item: item.id, tool: null });
    else if (item.kind === 'workspace' || item.kind === 'tabs') {
      for (const tool of item.tools) {
        if (!PAGES[tool]) continue;
        const title = item.kind === 'tabs' ? tabLabel(tool) : toolLabel(tool);
        pageRows(rows, PAGES[tool], title, item.label, { item: item.id, tool });
      }
      if (item.tools.includes('extension-sites')) {
        rows.push({
          title: 'Where it works',
          where: item.label,
          text: words(EXTENSION_SITES.lead, EXTENSION_SITES.sites),
          place: { item: item.id, tool: 'extension-sites', path: [] },
          kind: 'page',
        });
      }
    } else if (item.kind === 'shortcuts') {
      for (const group of KEYMAP) {
        for (const key of group.keys) {
          rows.push({ title: capital(key.does), where: `${item.label} · ${group.where} · ${key.combo}`, text: key.combo, place: { item: item.id }, kind: 'key' });
        }
      }
    } else if (item.kind === 'trouble') {
      for (const fix of FIXES) rows.push({ title: fix.symptom, where: item.label, text: fix.fix, place: { item: item.id }, kind: 'fix' });
    }
  }
  for (const journey of JOURNEYS) {
    const item = `journey:${journey.id}`;
    rows.push({ title: journey.title, where: 'Journey', text: journey.lead, place: { item, step: 0 }, kind: 'journey' });
    journey.steps.forEach((step, at) => {
      rows.push({ title: step.label, where: journey.title, text: stepWords(step), place: { item, step: at }, kind: 'step' });
    });
  }
  return rows.map((row, at) => ({
    ...row,
    id: `guide:${at}`,
    folded: { title: foldText(row.title), where: foldText(row.where), text: foldText(row.text) },
  }));
}

/**
 * The rows that hold every word typed, best first: a word in the title counts most, and
 * one the title starts with more still; a page, a number or a tip comes before a step, a
 * key or a fix that says the same. A question's small words (`SMALL`) are read past, so
 * "when was this taken" looks for "taken". Empty below `GUIDE_SEARCH_MIN` letters.
 */
export function searchGuide(query, limit = 8) {
  const typed = foldTerms(query);
  const meant = typed.filter((term) => !SMALL.has(term));
  const terms = meant.length ? meant : typed;
  if (terms.join('').length < GUIDE_SEARCH_MIN) return [];
  index ??= build();
  const whole = terms.join(' ');
  const found = [];
  for (const row of index) {
    const { title, where, text } = row.folded;
    if (!terms.every((term) => title.includes(term) || where.includes(term) || text.includes(term))) continue;
    let score = 0;
    for (const term of terms) {
      if (title.includes(term)) score += 4;
      if (title.startsWith(term) || title.includes(` ${term}`)) score += 2;
      if (where.includes(term)) score += 1;
    }
    if (title.includes(whole)) score += 4;
    if (row.kind === 'page' || row.kind === 'mark' || row.kind === 'tip') score += 1;
    found.push({ row, score });
  }
  found.sort((a, b) => b.score - a.score || a.row.title.length - b.row.title.length);
  return found.slice(0, limit).map(({ row }) => ({ id: row.id, title: row.title, where: row.where, kind: row.kind, place: row.place }));
}

/**
 * The screens to walk through from a page to reach a number's own screen: what each
 * number on `path` opens, in order, as pressing them does. Stops where a number opens none.
 */
export function trailTo(page, path = []) {
  const trail = [];
  let marks = PAGES[page]?.marks ?? [];
  for (const anchor of path) {
    const mark = marks.find((one) => one.anchor === anchor && one.opens);
    if (!mark) break;
    trail.push({ ...mark.opens, from: mark.title });
    marks = mark.opens.marks ?? [];
  }
  return trail;
}
