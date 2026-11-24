// The press of a reverse-search engine button, wherever one is offered: the
// Reverse Search tool, and the zone search over Inspect's viewer. Azimut never
// runs the search itself (`lib/reverseSearch.js`): a press opens the engine's
// page and hands the picture over, on the clipboard for a paste engine, as a
// saved file for a drag one, or straight into the engine's uploader through the
// capture extension when it is installed and Settings allows it.
//
// Which road a press takes is decided **before** anything is awaited: the
// button is a real link, so nothing is popup-blocked, and a preventDefault that
// comes back after a promise comes back too late to stop it.
//
// A picture is `{ png, name, what }`: `png()` answers a promise of its PNG and is
// called once per press, `name` is the file a drag engine is given, `what` is the
// word the toasts call it by ("frame", "image", "zone").
import { handOffReverse } from './extBridge.js';
import { shortcut } from './keys.js';
import { MAX_HANDOFF_BYTES, UPLOAD_PAGES } from './reverseSearch.js';
import { toast } from './state.svelte.js';

/**
 * The engines a press hands the picture to itself: the extension has to be
 * there and the switch on. An engine it cannot fill keeps its old road.
 */
export function filledEngines(prefill, installed) {
  return prefill && installed ? UPLOAD_PAGES.filter((e) => e.fill) : [];
}

/** The road a press on `engine` takes: `fill`, `paste` or `drag`. */
export function engineRoad(engine, filled) {
  if (filled.includes(engine)) return 'fill';
  return engine.paste ? 'paste' : 'drag';
}

/** Put a PNG on the clipboard. `note` is the toast when it lands; a refusal is
 *  always reported, since every road leans on the clipboard. */
export async function copyPng(pending, note) {
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': pending })]);
    if (note) toast(note, 'ok', 4500);
    return true;
  } catch (e) {
    toast(e.message || 'Could not copy the image', 'warn');
    return false;
  }
}

function savePng(blob, name, note) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
  toast(note, 'ok', 4500);
}

/** Copy the picture, saying where it goes next. */
export function copyPicture(picture, note = `Copied the ${picture.what}. Paste it in the tab with ${shortcut('Ctrl+V')}`) {
  return copyPng(picture.png(), note);
}

async function savePicture(picture) {
  try {
    savePng(await picture.png(), picture.name, `Saved the ${picture.what}. Drag it into the tab`);
  } catch (e) {
    toast(e.message || 'Could not save the image', 'warn');
  }
}

/** Base64 of a blob: a message carries no blob, so the bytes cross as a string
 *  and the extension rebuilds the file inside the engine's page. */
async function base64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000; // fromCharCode takes an argument list: chunk it or blow the stack
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/**
 * Press an engine the extension can fill.
 *
 * The link was stopped, so the tab is the extension's to open and every refusal
 * has to open it here instead. The picture goes on the clipboard first, while
 * this tab still has focus: it is what the extension's own notice promises if the
 * engine's page has moved on, and the encode is shared with the hand-off rather
 * than run a second time.
 */
async function fillEngine(engine, picture) {
  let blob;
  const pending = picture.png();
  copyPng(pending);
  try {
    blob = await pending;
  } catch (e) {
    toast(e.message || 'Could not read the image', 'warn');
    return;
  }
  if (blob.size <= MAX_HANDOFF_BYTES) {
    try {
      await handOffReverse({
        url: engine.url,
        image: { name: picture.name, type: 'image/png', data: await base64(blob) },
      });
      toast(`${engine.label} is opening with the ${picture.what}.`, 'info', 4200);
      return;
    } catch {
      // Absent, switched off mid-press, not permitted on that site, silent: one
      // answer, one fallback. Nothing to explain that the toast below does not
      // say by doing the old thing.
    }
  }
  window.open(engine.url, '_blank', 'noopener,noreferrer');
  if (engine.paste) toast(`Opened ${engine.label}. Paste the ${picture.what} with ${shortcut('Ctrl+V')}`, 'info', 4500);
  else savePng(blob, picture.name, `Opened ${engine.label}. Drag the saved ${picture.what} in`);
}

/** Every engine button's one handler: a real link, whose road is chosen here. */
export function pressEngine(event, engine, picture, filled) {
  const road = engineRoad(engine, filled);
  if (road === 'paste') copyPicture(picture);
  else if (road === 'drag') savePicture(picture);
  else {
    event.preventDefault();
    fillEngine(engine, picture);
  }
}
