import { toast } from './state.svelte.js';

/** Said when the browser keeps the clipboard shut: the page lost focus, or a
 *  permission was refused. */
export const REFUSED = 'The browser refused the clipboard';

/**
 * Put text on the clipboard and say so, or say the browser refused. Returns whether
 * it landed, so a caller with more to do (Publish) carries on either way.
 */
export async function copyText(text, { said = 'Copied', quiet = false } = {}) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    toast(REFUSED, 'warn');
    return false;
  }
  if (!quiet) toast(said, 'ok', 1600);
  return true;
}
