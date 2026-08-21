/**
 * Opening a saved artifact back in its tool — the "navigation follows the
 * object" glue (docs/UI.md). Every jump is a cross-tool handoff written onto
 * uiState; the target tool consumes it on mount. Shared so the case sidebar and
 * the Details editor send an analyst to the same place.
 */
import { caseState, toast, uiState } from './state.svelte.js';
import { mediaKindOf } from './entityIcon.js';
import { revealMediaFolder } from './reveal.js';

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

/** Tool a given entity type opens in (also gates the "Open in tool" button). */
export const ENTITY_TOOL = {
  media: 'media',
  proof: 'proof',
  place: 'satellite',
  post: 'post',
  'inspect-session': 'inspect',
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

/** Reopen an artifact in its tool, loading whatever spec/draft it carries. */
export function openEntity(entity) {
  // A file the app cannot show is opened where it actually lives. This runs before
  // the type branches below, so every surface that follows an entity — a relation
  // row, a chain row, the sidebar — makes the same call.
  if (opensInFileManager(entity)) {
    void showInFolder(entity);
    return;
  }
  if (entity.type === 'note') {
    uiState.openNotebook = { noteId: entity.id };
    uiState.tool = 'notebook';
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
  // A person, an account, a claim: the graph-only types have no tool that reopens
  // them, and until the board existed this call ended here doing nothing at all —
  // a relation row on the map said "Open …" and swallowed the click. The board is
  // where they are read, so that is where the jump lands.
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
