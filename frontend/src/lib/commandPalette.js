import { foldTerms, foldText } from './textFold.js';
import { TOOL_HOVERS, workspaceOf } from './workspaces.js';
import { HORIZON_GROUPS, HORIZON_SETTINGS } from './horizon/panelIndex.js';
import { isPicture, openScenes, queueName } from './sceneQueue.js';

export function isPaletteKey(event) {
  return Boolean(
    (event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey &&
    !event.repeat && !event.isComposing && !event.defaultPrevented &&
    event.key?.toLowerCase() === 'k'
  );
}

/**
 * `label` cut into runs, each marked with whether a search term matched it.
 *
 * Folded one character at a time so a match found in folded text points back at the
 * characters the analyst sees. Where that per-character fold differs from folding the
 * whole label (a mark that belongs to its letter), nothing is marked rather than the
 * wrong letters.
 */
export function matchRuns(label, query) {
  const text = String(label ?? '');
  const terms = foldTerms(query);
  if (!terms.length || !text) return [{ text, hit: false }];
  const chars = [...text];
  const owner = [];
  let folded = '';
  chars.forEach((char, index) => {
    const part = foldText(char);
    folded += part;
    for (let unit = 0; unit < part.length; unit += 1) owner.push(index);
  });
  if (folded !== foldText(text)) return [{ text, hit: false }];
  const hits = new Array(chars.length).fill(false);
  for (const term of terms) {
    for (let at = folded.indexOf(term); at !== -1; at = folded.indexOf(term, at + term.length)) {
      for (let unit = at; unit < at + term.length; unit += 1) hits[owner[unit]] = true;
    }
  }
  const runs = [];
  chars.forEach((char, index) => {
    const last = runs[runs.length - 1];
    if (last && last.hit === hits[index]) last.text += char;
    else runs.push({ text: char, hit: hits[index] });
  });
  return runs;
}

/** Find tools by their displayed name, workspace or stable id, and a renamed one by
 *  the name its hover says it had (Post is found as Geo Report). */
export function paletteTools(tools, query) {
  const terms = foldTerms(query);
  return tools.map(({ id, label }) => {
    const workspace = workspaceOf(id);
    return {
      kind: 'tool', id, label,
      detail: workspace?.label ?? label,
      icon: workspace?.icon ?? 'settings',
    };
  }).filter((row) => {
    const text = foldText(`${row.label} ${row.detail} ${row.id} ${TOOL_HOVERS[row.id] ?? ''}`);
    return terms.every((term) => text.includes(term));
  }).sort((a, b) => {
    const queryText = foldText(query.trim());
    return Number(foldText(b.label).startsWith(queryText)) - Number(foldText(a.label).startsWith(queryText));
  });
}

/** What the palette does rather than opens, by the words each goes by. To geolocate
 *  opens the sidebar's To-do, and offers itself unasked only while scenes wait there. */
const ACTIONS = [
  { id: 'note-side', label: 'Note on the side', detail: 'Notebook', icon: 'panelRight', words: 'note side pin panel dock write beside', needsCase: true },
  {
    id: 'to-geolocate', label: 'To geolocate', detail: 'To-do', icon: 'crosshair', needsCase: true, whileWaiting: true,
    words: 'geolocate scenes locate place where find todo to-do queue pictures videos',
  },
];

/** `To-do`, or `2 scenes · To-do` while some wait. */
const waitingDetail = (n) => (n > 0 ? `${n === 1 ? '1 scene' : `${n} scenes`} · To-do` : 'To-do');

/**
 * The actions on offer: every one while nothing is typed, the ones the words find
 * after. `toGeolocate` is how many scenes wait to be geolocated, null if unknown.
 */
export function paletteActions(query, { caseOpen = false, toGeolocate = null } = {}) {
  const terms = foldTerms(query);
  return ACTIONS
    .filter((one) => caseOpen || !one.needsCase)
    .filter((one) => terms.length || !one.whileWaiting || toGeolocate > 0)
    .filter((one) => terms.every((term) => foldText(`${one.label} ${one.words}`).includes(term)))
    .map(({ id, label, detail, icon }) => ({
      kind: 'action', id, label, icon, detail: id === 'to-geolocate' ? waitingDetail(toGeolocate) : detail,
    }));
}

/** Scenes listed before the rest are left to the To-do. */
const SCENES_SHOWN = 6;

/**
 * The scenes still to geolocate that the words name, by their label or their file's
 * title, once something is typed: a row opens the scene in Inspect, as its name does
 * in the To-do. `files` is the queue (`GET /scenes/queue`).
 */
export function paletteScenes(files, query) {
  const terms = foldTerms(query);
  if (!terms.length) return [];
  const rows = [];
  for (const file of openScenes(files)) {
    for (const scene of file.scenes) {
      const label = queueName(scene);
      if (!terms.every((term) => foldText(`${label} ${file.title}`).includes(term))) continue;
      rows.push({
        kind: 'scene', id: `${scene.video}#${scene.id}`, label, detail: file.title,
        icon: isPicture(file) ? 'image' : 'video', video: scene.video, draft: scene.id,
      });
      if (rows.length === SCENES_SHOWN) return rows;
    }
  }
  return rows;
}

/**
 * Find Horizon's settings by name or by the words they go by, once something
 * is typed: a row opens Horizon on the setting (lib/horizon/panelIndex.js).
 */
export function paletteSettings(query) {
  const terms = foldTerms(query);
  if (!terms.length) return [];
  return HORIZON_SETTINGS.filter((one) => {
    const text = foldText(`${one.label} ${one.words}`);
    return terms.every((term) => text.includes(term));
  }).map((one) => ({ kind: 'setting', id: one.id, label: one.label, detail: HORIZON_GROUPS[one.group], icon: 'horizon' }));
}
