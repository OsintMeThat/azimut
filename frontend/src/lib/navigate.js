/**
 * Opening a saved artifact back in its tool — the "navigation follows the
 * object" glue (docs/UI.md). Every jump is a cross-tool handoff written onto
 * uiState; the target tool consumes it on mount. Shared so the case sidebar and
 * the Details editor send an analyst to the same place.
 */
import { caseState, toast, uiState } from './state.svelte.js';
import { api } from './api.js';
import { mediaKindOf } from './entityIcon.js';
import { GUIDE, guideFor } from './guide.js';
import { revealMediaFolder } from './reveal.js';
import { normalizeReverseTarget } from './reverseSearch.js';

/**
 * A number an entity actually recorded, or NaN when it recorded nothing.
 *
 * `Number(null)` is 0, and a zoom of 0 is the whole globe — so a place minted
 * from a photo's EXIF (which knows coordinates but no zoom) would fly the map
 * all the way out instead of falling back to the Satellite tool's own default.
 */
function recorded(value) {
  return value === null || value === undefined || value === '' ? NaN : Number(value);
}

/**
 * The name a tool reopens an artifact by, read off the path the case recorded.
 *
 * Tools are handed a bare stem — the same one the save route slugified — never a
 * path. Deriving it by stripping a hard-coded folder prefix meant the three
 * artifact folders that later moved (`proofs/.meta/`, `.drafts/`, `.inspect/`)
 * silently handed over a name with a directory still glued to it, which no route
 * could match. Taking the last segment tracks the layout wherever it goes.
 */
function specName(path) {
  if (typeof path !== 'string') return '';
  return path.split('/').pop().replace(/\.json$/, '');
}

/** A saved comparison, from a Saved-panel row, reopened in Compare. */
export function openComparison(row) {
  if (!row?.session) return;
  uiState.openCompare = row.session;
  uiState.tool = 'compare';
}

/** Tool a given entity type opens in (also gates the "Open in tool" button). */
export const ENTITY_TOOL = {
  media: 'media',
  proof: 'proof',
  place: 'satellite',
  post: 'post',
  'inspect-session': 'inspect',
  collage: 'collage',
  'compare-session': 'compare',
  'analysis-zones': 'detect',
  'analysis-area': 'detect',
  'analysis-follow-up': 'detect',
  'analysis-run': 'detect',
};

/**
 * Whether the app has to hand this one back to the desktop.
 *
 * Azimut displays images, video and audio, and nothing else: a PDF, a scan bundle,
 * a spreadsheet or a plan has no viewer here and no tool to be reopened in. The
 * browser's answer for those is a download, which quietly makes a second copy in
 * Downloads and invites the analyst to work on the file the case no longer knows
 * about. Showing the folder hands over the original instead.
 */
export function opensInFileManager(entity) {
  return entity?.type === 'media' && mediaKindOf(entity) === 'file';
}

/** Show a file's own folder, and say so when the desktop refuses. */
export function showInFolder(entity) {
  const caseId = caseState.current?.id;
  const path = entity?.attrs?.path;
  if (!caseId || !path) return Promise.resolve();
  return revealMediaFolder(caseId, path).catch((e) => toast(e.message, 'warn', 5000));
}

/** The window a Claim's entry is read in: the entry, with as much again on either
 *  side and never less than half a day, so its neighbours are in view. */
export function claimWindow(item) {
  const first = new Date(item?.earliest ?? '').getTime();
  const last = new Date(item?.latest ?? '').getTime();
  if (!Number.isFinite(first) || !Number.isFinite(last)) return null;
  const pad = Math.max((last - first) * 2, 12 * 3600 * 1000);
  return { from: new Date(first - pad).toISOString(), to: new Date(last + pad).toISOString() };
}

/**
 * Where a Claim is read: on the Timeline, at its own entry.
 *
 * A dated one opens the window around it with the entry selected; an undated one
 * opens the Undated queue, and one whose clock is unknown the "Not on UTC axis" list,
 * with the entry selected either way. The row comes from the route that says where a
 * Claim sits, so a Claim past the first page still lands.
 */
export function openClaim(item) {
  if (!item?.id) return;
  const window = item.sortable ? claimWindow(item) : null;
  if (window) uiState.timelineRange = { ...window, itemId: item.id, item };
  else uiState.timelineQueue = { queue: item.earliest || !item.raw ? 'undated' : 'unplaced', itemId: item.id, item };
  uiState.tool = 'timeline';
}

/**
 * Read an entity on the Timeline: what is dated about it, with `item` (one of its
 * entries) selected when given.
 */
export function openInTimeline(entity, item = null) {
  uiState.timelineFocus = {
    entityId: entity.id,
    entityLabel: entity.label,
    entityType: entity.type,
    entityAttrs: entity.attrs ?? {},
    itemId: item?.id ?? null,
    producedHere: item?.produced_here === true,
  };
  uiState.tool = 'timeline';
}

/** Reopen an artifact in its tool, loading whatever spec/draft it carries. */
export function openEntity(entity, resolved = false) {
  // Places navigate by coordinates, so resolve an old snapshot's id before flying.
  // Other mergeable subjects open Details, whose chain read resolves the id.
  if (entity?.type === 'place' && entity.id && caseState.current?.id && !resolved) {
    const cid = caseState.current.id;
    return api.get(`/api/cases/${cid}/entities/${entity.id}/chain`).then((chain) => {
      if (caseState.current?.id !== cid) return;
      if (chain.merged_from) toast(`Merged into ${chain.entity.label}`, 'info');
      openEntity(chain.entity, true);
    }).catch((error) => toast(error.message, 'danger'));
  }
  // A file the app cannot show is opened where it actually lives. This runs before
  // the type branches below, so every surface that follows an entity — a relation
  // row, a chain row, the sidebar — makes the same call.
  if (opensInFileManager(entity)) {
    void showInFolder(entity);
    return;
  }
  // A Claim is an event, and events are read on the Timeline. The Board still lists
  // it with the rest of the case, and its Details are one click from the entry.
  if (entity?.type === 'claim' && entity.id && caseState.current?.id) {
    const cid = caseState.current.id;
    return api.get(`/api/cases/${cid}/timeline/claims/${entity.id}`).then((body) => {
      if (caseState.current?.id !== cid) return;
      openClaim(body.item);
    }).catch(() => {
      if (caseState.current?.id !== cid) return;
      uiState.openBoardEntity = entity.id;
      uiState.tool = 'board';
    });
  }
  if (entity.type === 'note') {
    uiState.openNotebook = { noteId: entity.id };
    uiState.tool = 'notebook';
    return;
  }
  if (entity.type === 'sheet' && entity.id) {
    uiState.openSheet = entity.id;
    uiState.tool = 'sheet';
    return;
  }
  if (entity.type === 'proof') {
    const name = specName(entity.attrs?.spec);
    if (name) uiState.openProof = name;
    uiState.tool = 'proof';
    return;
  }
  if (entity.type === 'post') {
    const name = specName(entity.attrs?.draft);
    if (name) uiState.openDraft = name;
    uiState.tool = 'post';
    return;
  }
  if (entity.type === 'inspect-session') {
    const name = specName(entity.attrs?.spec);
    if (name) uiState.openInspect = name;
    uiState.tool = 'inspect';
    return;
  }
  if (entity.type === 'collage') {
    const name = specName(entity.attrs?.spec);
    if (name) uiState.openCollage = name;
    uiState.tool = 'collage';
    return;
  }
  if (entity.type === 'compare-session') {
    const name = specName(entity.attrs?.spec);
    if (name) uiState.openCompare = name;
    uiState.tool = 'compare';
    return;
  }
  if (['analysis-area', 'analysis-zones', 'analysis-follow-up', 'analysis-run'].includes(entity.type)) {
    uiState.openAnalyzer = specName(entity.attrs?.spec);
    uiState.tool = 'detect';
    return;
  }
  if (entity.type === 'place') {
    const lat = Number(entity.attrs?.lat);
    const lon = Number(entity.attrs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      uiState.gotoCoords = {
        lat,
        lon,
        zoom: recorded(entity.attrs?.zoom),
        bearing: recorded(entity.attrs?.bearing),
      };
    }
    uiState.tool = 'satellite';
    return;
  }
  if (entity.type === 'bookmark' && entity.attrs?.url) {
    window.open(entity.attrs.url, '_blank', 'noopener,noreferrer');
    return;
  }
  if (entity.type === 'capture') {
    if (entity.attrs?.source_url) {
      window.open(entity.attrs.source_url, '_blank', 'noopener,noreferrer');
      return;
    }
    const lat = Number(entity.attrs?.lat);
    const lon = Number(entity.attrs?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      uiState.gotoCoords = {
        lat,
        lon,
        zoom: recorded(entity.attrs?.zoom),
        bearing: recorded(entity.attrs?.bearing),
        provider: entity.attrs?.provider,
      };
      uiState.focusCapture = entity.attrs?.path ?? null;
      uiState.tool = 'satellite';
    }
    return;
  }
  if (entity.type === 'media') {
    if (entity.attrs?.path) uiState.focusMedia = entity.attrs.path;
    uiState.tool = 'media';
    return;
  }
  const tool = ENTITY_TOOL[entity.type];
  if (tool) {
    uiState.tool = tool;
    return;
  }
  // A person, an account, a place-less subject: the graph-only types have no tool
  // that reopens them, and until the board existed this call ended here doing nothing
  // at all — a relation row on the map said "Open …" and swallowed the click. The
  // board is where they are read, so that is where the jump lands.
  if (entity.id) {
    uiState.openBoardEntity = entity.id;
    uiState.tool = 'board';
  }
}

/** Open the case-wide note (null) or one filed note in the shared Notebook. */
export function openNotebook(noteId = null) {
  uiState.openNotebook = { noteId };
  uiState.tool = 'notebook';
}

/**
 * Fly the Satellite map to a bare point.
 *
 * For a position a file states about itself rather than one the case has filed:
 * the map is where "is this plausible?" gets answered, and enrichment's proposed
 * place is already waiting there as a mark.
 */
export function gotoPoint(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  uiState.gotoCoords = { lat, lon };
  uiState.tool = 'satellite';
}

/**
 * Open another map tab on a point, at the zoom it was looked at.
 *
 * The right-click menu's Open in…: Satellite flies there, Compare and Detect
 * move their camera and keep their own pictures and work. A fullscreen map is
 * left on the way, as every change of tool leaves it (App.svelte).
 */
export function openMapAt(tool, { lat, lon, zoom }) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  const at = { lat, lon, ...(Number.isFinite(zoom) ? { zoom } : {}) };
  if (tool === 'satellite') uiState.gotoCoords = at;
  else if (tool === 'compare' || tool === 'detect') uiState.lookAt = { tool, ...at };
  else return;
  uiState.tool = tool;
}

/**
 * Open the Guide on whatever covers a tool.
 *
 * The press means "what is this tab", so it lands on the section written about that
 * tab. A tool no section covers — Settings, and the two home tabs themselves — opens
 * the guide at the top, which is where somebody with a general question belongs
 * anyway.
 */
export function openGuide(tool) {
  uiState.guideSection = guideFor(tool)?.id ?? GUIDE[0].id;
  uiState.tool = 'guide';
}

/**
 * Hand a picture to Reverse Search and go there.
 *
 * The press is made where the picture is being looked at, so the tab opens on it
 * rather than on an empty picker. `target` is a case file (`{ path, kind, label,
 * time? }`) or a picture held only in memory (`{ blob, label }`); see
 * `normalizeReverseTarget`. Returns whether the tab was changed.
 */
export function openInReverseSearch(target) {
  const picture = normalizeReverseTarget(target);
  if (!picture) {
    toast('This picture cannot be searched', 'warn');
    return false;
  }
  uiState.reverseTarget = picture;
  uiState.tool = 'reverse';
  return true;
}

/** Fly the Satellite map to a capture's recorded coordinates (its marker). */
export function gotoCapture(entity) {
  const lat = Number(entity.attrs?.lat);
  const lon = Number(entity.attrs?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  uiState.gotoCoords = {
    lat,
    lon,
    zoom: recorded(entity.attrs?.zoom),
    bearing: recorded(entity.attrs?.bearing),
  };
  uiState.tool = 'satellite';
}

/**
 * Open Settings on the Copernicus card, open.
 *
 * Detect and Compare send the analyst here when Copernicus is missing, and a
 * tab of eight cards with the right one shut would make them look for it.
 */
export function openCopernicusSettings() {
  uiState.settingsTab = 'imagery:sentinelhub';
  uiState.tool = 'settings';
}
