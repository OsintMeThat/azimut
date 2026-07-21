/**
 * Opening a saved artifact back in its tool — the "navigation follows the
 * object" glue (docs/UI.md). Every jump is a cross-tool handoff written onto
 * uiState; the target tool consumes it on mount. Shared so the case sidebar and
 * the Details editor send an analyst to the same place.
 */
import { uiState } from './state.svelte.js';

/** Tool a given entity type opens in (also gates the "Open in tool" button). */
export const ENTITY_TOOL = {
  media: 'media',
  proof: 'proof',
  place: 'satellite',
  post: 'post',
  'inspect-session': 'inspect',
};

/** Reopen an artifact in its tool, loading whatever spec/draft it carries. */
export function openEntity(entity) {
  if (entity.type === 'note') {
    uiState.openNotebook = { noteId: entity.id };
    uiState.tool = 'notebook';
    return;
  }
  if (entity.type === 'proof') {
    const spec = entity.attrs?.spec ?? '';
    const name = spec.replace(/^proofs\//, '').replace(/\.json$/, '');
    if (name) uiState.openProof = name;
    uiState.tool = 'proof';
    return;
  }
  if (entity.type === 'post') {
    const draft = entity.attrs?.draft ?? '';
    const name = draft.replace(/^exports\//, '').replace(/\.json$/, '');
    if (name) uiState.openDraft = name;
    uiState.tool = 'post';
    return;
  }
  if (entity.type === 'inspect-session') {
    const spec = entity.attrs?.spec ?? '';
    const name = spec.replace(/^inspect\//, '').replace(/\.json$/, '');
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
        zoom: Number(entity.attrs?.zoom),
        bearing: Number(entity.attrs?.bearing),
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
        zoom: Number(entity.attrs?.zoom),
        bearing: Number(entity.attrs?.bearing),
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
  if (tool) uiState.tool = tool;
}

/** Open the case-wide note (null) or one filed note in the shared Notebook. */
export function openNotebook(noteId = null) {
  uiState.openNotebook = { noteId };
  uiState.tool = 'notebook';
}

/** Fly the Satellite map to a capture's recorded coordinates (its marker). */
export function gotoCapture(entity) {
  const lat = Number(entity.attrs?.lat);
  const lon = Number(entity.attrs?.lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
  uiState.gotoCoords = {
    lat,
    lon,
    zoom: Number(entity.attrs?.zoom),
    bearing: Number(entity.attrs?.bearing),
  };
  uiState.tool = 'satellite';
}
