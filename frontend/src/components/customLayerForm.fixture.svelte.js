/**
 * A reactive draft for the layer form's tests.
 *
 * The form mutates the object its caller hands it, and the callers hold that
 * object in `$state` — so a plain one from `startForm` would let every edit
 * land silently and the tests would watch a form that never moved. This wraps
 * it the way the callers do, which a `.test.js` file cannot.
 */
import { startForm } from '../lib/customLayers.js';

export function draftForm(options) {
  const form = $state(startForm(options));
  return form;
}
