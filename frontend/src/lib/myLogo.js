/**
 * Where every tool reads the analyst's logo (Settings › Publishing). The address
 * changes whenever the logo does: with the file on disk (`logo_rev`, read with the
 * settings) and with a save in this tab (`picturesRev`). A browser that kept an
 * older logo under another address never hands it to a proof or a plate, and a
 * tool that reads this inside an effect loads the new logo as soon as it is saved.
 */
import { prefs } from './state.svelte.js';

export function myLogoUrl() {
  return `/api/settings/signature.png?rev=${prefs.logoRev || 0}.${prefs.picturesRev}`;
}
