/**
 * The one way into Post with something to post: a kind, and the case files the post
 * carries. Post's own New post gallery starts through the same composer road, and so do
 * the other tools' To Post (a plate's export, a Compare or Detect picture), so a post
 * started from anywhere opens on the same screen with its media already placed
 * (`lib/post.js` `startMediaPlan`: on the first post, except a geolocation's, which
 * keeps it for the proof).
 *
 * What Post had open is saved under its own name first and makes way, as it does for a
 * proof sent with To Post. Nothing is posted: the post opens to be read and published
 * by the analyst.
 */
import { uiState } from '../../lib/state.svelte.js';
import { normalizePostKind } from '../../lib/post.js';

/** Start a post of `kind` carrying `media` (case-relative paths), and show Post. */
export function startPost(kind, media = []) {
  uiState.postStart = {
    kind: normalizePostKind(kind),
    media: (media ?? []).filter((path) => typeof path === 'string' && path),
  };
  uiState.tool = 'post';
}
