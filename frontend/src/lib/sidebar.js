/**
 * Case sidebar width — the shared panel helpers (lib/panelWidth.js) bound to
 * the sidebar's own key and range. The pointer glue lives in CaseSidebar.svelte.
 */
import { panelWidth } from './panelWidth.js';

export const MIN_W = 240;
export const MAX_W = 640;
export const DEFAULT_W = 320;

export const { maxWidth, clampWidth, loadWidth, saveWidth } = panelWidth({
  key: 'azimut:sidebarW',
  min: MIN_W,
  max: MAX_W,
  def: DEFAULT_W,
});
