/**
 * Ready to publish?: what the check before export says of one note, gathered in one
 * panel, grouped by what each line is about, each with its own fix where one exists.
 *
 * It is the same check as the export dialog's (`POST notes/pdf/check`), in the format
 * and edition the export would write, asked with `ready: true`: the server then writes
 * each warning's group on it and adds what only the panel lists (`engine/noteready.py`):
 * pictures a reader is told nothing about or whose owner nothing names, Claims cited
 * that cite nothing, pages the last Archive every link run found gone, the marking and
 * the style. Nothing is counted here that the server did not say: a grouped warning's
 * links stay one line, a count read as exact is one line per count, each as the check
 * lists it, so the badge and the dialog always agree.
 *
 * Reading the panel writes nothing. A fix is the action that already exists elsewhere:
 * *Say “at least”* writes the words before a count, *Add “at least” to the title* the
 * chart's own fix, each as one Undo step (`atLeastChange`, `chartFixChange`); a chart's
 * rows follow their source by themselves (`editor/follow.js`) and are drawn from it as it
 * is now, so nothing here reads them again; *Archive every link…*
 * opens the archive dialog, the one press that reaches the network; *Bookmark them*
 * files each page as a bookmark, nothing fetched; *Round them* rounds the points of view
 * in the export, the note never rewritten.
 */
import { api } from '../api.js';
import { HTML_BUDGET, PDF, PUBLIC_ONLY, WEB, WORDPRESS, weightWords } from './formats.js';
import { PUBLIC } from './editions.svelte.js';
import { readWarning } from './warnings.js';
import { chartBlockAt, fixLabel, withSettings } from './editor/chartText.js';

/** The panel's groups, in its order. */
export const GROUPS = [
  { id: 'words', label: 'Words' },
  { id: 'sources', label: 'Sources' },
  { id: 'figures', label: 'Figures' },
  { id: 'edition', label: 'Edition' },
  { id: 'reach', label: 'Weight and reach' },
];
const GROUP_IDS = GROUPS.map((group) => group.id);

/** What each format is called where the panel says what it checked. */
const CHECKED_AS = { pdf: 'the PDF', html: 'the HTML page', web: 'the web folder' };

/** The format the panel checks for an export of `format`: WordPress, which checks nothing itself, as its page. */
export function checkFormat(format) {
  return format === WORDPRESS ? 'html' : [PDF, 'html', WEB].includes(format) ? format : PDF;
}

/** The edition checked: a page put online is public whatever the note keeps. */
export function checkEdition(format, edition) {
  return PUBLIC_ONLY.includes(format) ? PUBLIC : edition === PUBLIC ? PUBLIC : 'internal';
}

/** Ask the check for one note, as the export would write it, with what the panel reads. */
export async function checkReady(caseId, noteId, { format = PDF, edition = 'internal', address = '', signal } = {}) {
  const made = checkFormat(format);
  const body = { notes: [noteId], edition: checkEdition(format, edition), format: made, ready: true };
  if (made === WEB && address) body.base_url = address;
  const answer = await api.post(`/api/cases/${encodeURIComponent(caseId)}/notes/pdf/check`, body, { signal });
  const note = (Array.isArray(answer?.notes) ? answer.notes : []).find((item) => item?.note === noteId) ?? null;
  return readReady(note, made);
}

const count = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);
const lineOf = (value) => (Number.isInteger(value) && value >= 0 ? value : null);
const plural = (number, one, many = `${one}s`) => `${number} ${number === 1 ? one : many}`;

/** One note's answer as the panel reads it; null when the check said nothing of it. */
export function readReady(note, format = PDF) {
  if (!note) return null;
  const ready = note.ready && typeof note.ready === 'object' ? note.ready : {};
  const warnings = (Array.isArray(note.warnings) ? note.warnings : [])
    .map((item) => {
      const warning = readWarning(item);
      const group = GROUP_IDS.includes(item?.group) ? item.group : 'words';
      const fix = Array.isArray(item?.fix) ? item.fix.filter((pair) => Array.isArray(pair) && pair.length === 2).map(([key, value]) => [String(key), String(value)]) : [];
      return { ...warning, group, ...(fix.length ? { fix } : {}) };
    })
    .filter((warning) => warning.text);
  const listed = (value) => (Array.isArray(value) ? value : [])
    .map((item) => ({ text: String(item?.text ?? '').trim(), url: typeof item?.url === 'string' ? item.url : '', line: lineOf(item?.line), ...(item?.id ? { id: String(item.id) } : {}),
      ...('alt' in (item ?? {}) ? { alt: Boolean(item.alt), credit: Boolean(item.credit) } : {}) }))
    .filter((item) => item.text);
  return {
    note: String(note.note ?? ''),
    title: String(note.title ?? ''),
    format: ['pdf', 'html', 'web'].includes(ready.format) ? ready.format : format,
    edition: ready.edition === PUBLIC ? PUBLIC : 'internal',
    style: String(ready.style ?? ''),
    tlp: String(ready.tlp ?? ''),
    internal: count(note.internal),
    weight: count(note.weight),
    links: listed(note.links),
    pov: listed(note.pov),
    warnings,
    pictures: listed(ready.pictures),
    claims: listed(ready.claims),
    gone: listed(ready.gone),
    unarchived: listed(ready.unarchived),
    unseen: listed(ready.unseen),
  };
}

/**
 * The check's warnings with a style's one line per link (`link_check: each`) folded back
 * into one line per kind, its links under it, so the panel says each kind once, in the
 * words of the check's own grouped line.
 */
function folded(ready) {
  const merged = new Map();
  for (const kind of ['unarchived', 'unseen']) {
    const lines = ready.warnings.filter((warning) => warning.kind === kind && !warning.items);
    if (lines.length < 2) continue;
    const said = kind === 'unarchived' ? `${lines.length} outside links have no archived copy.`
      : `${lines.length} links are not in the case, so no day says when they were read.`;
    const links = ready[kind].length === lines.length ? ready[kind] : lines.map((warning) => ({ text: warning.text, url: '', line: warning.line }));
    merged.set(kind, { first: lines[0], warning: { ...lines[0], text: said, items: links } });
  }
  if (!merged.size) return ready.warnings;
  return ready.warnings.flatMap((warning) => {
    const one = merged.get(warning.kind);
    if (!one || warning.items) return [warning];
    return warning === one.first ? [one.warning] : [];
  });
}

/** `TLP:AMBER+STRICT` for a look's marking. */
export function tlpLabel(tlp) {
  return tlp ? `TLP:${String(tlp).toUpperCase().replace('-STRICT', '+STRICT')}` : '';
}

/**
 * The panel's lines, by group: each `{ key, text, line, kind, items?, fix?, issue }`.
 * `issue` is what the badge counts: something to look at, as against what the panel
 * only says (the edition, the marking, the weight under its budget). `fix` is
 * `{ id, label, title, ... }`; a fix that edits the note is offered only while it is
 * open in the editor (`canEdit`), else the line keeps its Go to. Without the app's
 * `tools` around the note (the extension's panel), the two fixes only the Notebook can
 * do are not offered: *Round them*, which its export does, and *Open the claim*, in Details.
 */
export function readyLines(ready, { canEdit = false, rounded = false, tools = true } = {}) {
  const groups = Object.fromEntries(GROUP_IDS.map((id) => [id, []]));
  if (!ready) return groups;
  const add = (group, line) => groups[group].push({ issue: true, line: null, ...line });
  for (const [index, warning] of folded(ready).entries()) {
    const key = `w${index}`;
    if (warning.kind === 'count' && warning.items?.length) {
      // one line per count, as many as the check counts, each with its own fix
      for (const [at, item] of warning.items.entries()) {
        add(warning.group, {
          key: `${key}-${at}`, kind: 'count', text: `“${item.text}” reads as exact.`, line: item.line,
          fix: canEdit && item.line !== null ? { id: 'atleast', label: 'Say “at least”', title: `Write “at least ${item.text}”`, phrase: item.text } : null,
        });
      }
      continue;
    }
    if (warning.kind === 'internal') {
      add('edition', { key, kind: 'internal', text: `${warning.text.replace(/\.$/, '')} of the public edition.`, issue: false });
      continue;
    }
    const line = { key, kind: warning.kind, text: warning.text, line: warning.line, items: warning.items ?? null };
    if (warning.kind === 'unarchived') line.fix = { id: 'archive', label: 'Archive every link…', title: 'Send each outside link to the Internet Archive and keep its copy' };
    else if (warning.kind === 'unseen' && ready.unseen.some((link) => link.url)) {
      const links = ready.unseen.filter((link) => link.url);
      line.fix = { id: 'bookmark', label: links.length > 1 ? 'Bookmark them' : 'Bookmark it', links,
        title: links.length > 1 ? `File these ${links.length} pages as bookmarks of the case, seen today. Nothing is fetched`
          : 'File the page as a bookmark of the case, seen today. Nothing is fetched' };
    } else if (warning.fix && canEdit) line.fix = { id: 'chart', label: fixLabel(warning.fix), title: warning.fix.map(([name, value]) => `${name}: ${value}`).join('\n'), pairs: warning.fix };
    add(warning.group, line);
  }
  for (const [index, claim] of ready.claims.entries()) {
    add('words', {
      key: `c${index}`, kind: 'claim', text: `The claim “${claim.text}” cites no source.`, line: claim.line,
      fix: claim.id && tools ? { id: 'claim', label: 'Open the claim', title: 'Open it in Details, to say what it rests on', entity: claim.id } : null,
    });
  }
  if (ready.gone.length) {
    const one = ready.gone.length === 1;
    add('sources', {
      key: 'gone', kind: 'gone', line: ready.gone[0].line, items: one ? null : ready.gone,
      text: one ? `“${ready.gone[0].text}” no longer answered when its links were last archived.`
        : `${ready.gone.length} pages no longer answered when the links were last archived.`,
    });
  }
  for (const [index, picture] of ready.pictures.entries()) {
    const lacks = [!picture.alt && 'no alt text', !picture.credit && 'no credit'].filter(Boolean).join(' and ');
    add('figures', { key: `p${index}`, kind: 'picture', text: `Picture “${picture.text}” has ${lacks}.`, line: picture.line });
  }
  if (ready.pov.length) {
    const one = ready.pov.length === 1;
    add('figures', {
      key: 'pov', kind: 'pov', line: ready.pov[0].line, items: ready.pov, issue: !rounded,
      text: rounded ? `${plural(ready.pov.length, 'point of view', 'points of view')} rounded to about 150 m in the export.`
        : `${one ? 'A point of view is' : `${ready.pov.length} points of view are`} shown to the metre.`,
      fix: !tools ? null : rounded ? { id: 'unround', label: 'Keep them exact', title: 'Show them to the metre, as written' }
        : { id: 'round', label: 'Round them', title: 'Round them to about 150 m in the export; the note keeps them as written' },
    });
  }
  // what the panel says of the edition, once, beside a marking setting missing
  if (ready.edition === PUBLIC) add('edition', { key: 'edition', kind: 'edition', text: 'Public edition.', issue: false });
  else if (ready.internal) {
    add('edition', { key: 'edition', kind: 'edition', issue: false,
      text: `Internal edition: ${plural(ready.internal, 'internal passage')} ${ready.internal === 1 ? 'prints' : 'print'} in marked boxes, and stay out of the public one.` });
  } else add('edition', { key: 'edition', kind: 'edition', text: 'One edition: the note holds no internal passage.', issue: false });
  add('edition', { key: 'tlp', kind: 'tlp', issue: false, text: ready.tlp ? `Marked ${tlpLabel(ready.tlp)} on every page.` : 'No TLP marking.' });
  if (ready.format === PDF) {
    add('reach', { key: 'reach', kind: 'reach', issue: false, text: 'A PDF holds every picture and clip still; the weight is said for an HTML page or a web folder.' });
  } else {
    if (ready.weight && ready.weight <= HTML_BUDGET) {
      add('reach', { key: 'weight', kind: 'weight', issue: false, text: `About ${weightWords(ready.weight)}, under the ${weightWords(HTML_BUDGET)} it aims for.` });
    }
    if (ready.links.length) {
      add('reach', { key: 'clips', kind: 'clips', issue: false, items: ready.links, line: ready.links[0].line,
        text: `${plural(ready.links.length, 'clip')} ${ready.links.length === 1 ? 'plays' : 'play'} from a link, not inside the ${ready.format === WEB ? 'folder' : 'file'}.` });
    }
  }
  return groups;
}

/** How many lines of the panel are something to look at: what the badge says. */
export function issueCount(groups) {
  return Object.values(groups ?? {}).reduce((sum, lines) => sum + lines.filter((line) => line.issue).length, 0);
}

/** The badge's words: `3 to look at`, or `Ready` once nothing is. */
export function badgeWords(issues) {
  return issues > 0 ? `${issues} to look at` : 'Ready';
}

/** What the panel says it checked: `As the HTML page, public edition`. */
export function checkedWords(ready) {
  if (!ready) return '';
  return `Checked as ${CHECKED_AS[ready.format] ?? 'the PDF'}, ${ready.edition === PUBLIC ? 'public' : 'internal'} edition.`;
}

// -- the fixes that edit the note ----------------------------------------------------

/** A hedge before a count makes it a minimum or a range (`engine/notes_markdown.py`, `HEDGES`, its main words). */
const HEDGED = /(?:\bat\s+least|\bat\s+most|\babout|\baround|\bapproximately|\broughly|\bsome|\bup\s+to|\bmore\s+than|\bless\s+than|\bfewer\s+than|\bover|\bunder|\bnearly|\balmost|\bestimated|\bbetween|~|≥|≤|>|<|\d\s*(?:to|or|-|–|—)\s*)\s*[*_]*$/i;

/**
 * Where *Say “at least”* writes, for the count `phrase` (`54 vehicles`) the check found on
 * line `line` (0-based) of `text`: `{ from, to, insert, expected }`, the words put before
 * its number, or null when the paragraph no longer holds it bare.
 */
export function atLeastChange(text, line, phrase) {
  const lines = String(text ?? '').split('\n');
  const [number, ...rest] = String(phrase ?? '').trim().split(/\s+/);
  if (!/^\d+$/.test(number ?? '') || !rest.length || !Number.isInteger(line) || line < 0 || line >= lines.length) return null;
  const noun = rest.join(' ').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(?<![\\w.,:/#+~≥≤>–—-])([*_]*)${number}(?![\\w.,:/%°×+–—-])[*_]*[ \\t]+[*_]*${noun}\\b`, 'g');
  let offset = lines.slice(0, line).reduce((sum, one) => sum + one.length + 1, 0);
  // the paragraph the check names starts on its line and runs to the next blank one
  for (let at = line; at < lines.length && (at === line || lines[at].trim()); at += 1) {
    const here = lines[at];
    for (const match of here.matchAll(pattern)) {
      if (HEDGED.test(here.slice(Math.max(0, match.index - 24), match.index))) continue;
      const from = offset + match.index + match[1].length;
      return { from, to: from, insert: 'at least ', expected: '' };
    }
    offset += here.length + 1;
  }
  return null;
}

/** The chart fix the check offers (`pairs`, settings to write) for its warning on line `line`, as the chart's own bar writes it. */
export function chartFixChange(text, line, pairs) {
  const block = Number.isInteger(line) ? chartBlockAt(text, line) : null;
  if (!block || !Array.isArray(pairs) || !pairs.length) return null;
  const next = withSettings(block.source, Object.fromEntries(pairs));
  return next === block.source ? null : { from: block.from, to: block.to, insert: next, expected: block.source };
}

/**
 * Do the fix of one line with the actions the Notebook already has (`actions`):
 * `text()` the note in the editor, `write(change, missing)` one Undo step,
 * `archive()` the Archive every link dialog, `bookmark(links)`
 * the pages filed, `round(on)` the export's rounding, `open(id)` a record in Details.
 * Answers whether the check should be asked again.
 */
export async function runFix(line, { text = () => '', write, archive, bookmark, round, open } = {}) {
  const fix = line?.fix;
  switch (fix?.id) {
    case 'atleast':
      write(atLeastChange(text(), line.line, fix.phrase), `“${fix.phrase}” is no longer written there as it was`);
      return true;
    case 'chart':
      write(chartFixChange(text(), line.line, fix.pairs), 'That chart has changed since the check');
      return true;
    case 'archive':
      archive();
      return false;
    case 'bookmark':
      await bookmark(fix.links);
      return true;
    case 'round':
    case 'unround':
      round(fix.id === 'round');
      return false;
    case 'claim':
      open(fix.entity);
      return false;
    default:
      return false;
  }
}
