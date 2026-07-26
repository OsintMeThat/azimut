/**
 * Naming and encoding for images pasted into a proof.
 *
 * An asset is named after its own bytes. That is what lets the composer hand an
 * image to the server exactly once: the API refuses a name that does not match
 * its content, two pastes of the same screenshot collapse into one file, and a
 * paste the case already holds needs no resend on the next save.
 */

export const PASTE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
export const MAX_PASTE_BYTES = 20 * 1024 * 1024; // mirrors the API's own cap
export const MAX_PASTES = 12;

/** File extension for a pasted image's type; anything unexpected reads as PNG. */
export function assetExtension(type) {
  if (type === 'image/jpeg') return 'jpg';
  if (type === 'image/webp') return 'webp';
  return 'png';
}

/** First 16 hex digits of the bytes' sha256, plus the extension. */
export async function assetName(bytes, type) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 16)}.${assetExtension(type)}`;
}

/** base64 of the bytes, chunked so a large image cannot blow the call stack. */
export function base64Of(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(out);
}
