/**
 * The startup update pop-up's one decision: given the update check and the tag
 * the user muted, should we surface the notice?
 *
 * Kept pure (no runes, no fetch) so it's the part worth unit-testing — the
 * network call and the modal state live in state.svelte.js around it.
 */

/**
 * @param {{ update_available?: boolean, latest?: string|null } | null} check
 *   The GET /api/settings/update?check=true payload.
 * @param {string} dismissedVersion  The tag "don't show again" muted, or ''.
 * @returns {boolean}
 */
export function shouldShowUpdate(check, dismissedVersion) {
  if (!check || !check.update_available || !check.latest) return false;
  return check.latest !== dismissedVersion;
}
