/**
 * One plate, one tab: the plate's own channel on the shared guard (`lib/oneTab.js`).
 */
import { docTabs } from '../oneTab.js';

export const CHANNEL = 'azimut:plate-open';

/** `onlost(held)` and `onsaved(held)` as `docTabs` has them; `held` is `{ caseId, name }`. */
export function plateTabs(options = {}) {
  return docTabs(CHANNEL, options);
}
