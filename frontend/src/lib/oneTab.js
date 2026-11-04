/**
 * One document, one tab. A document open in two tabs would be saved by both, each
 * write undoing the other's work, so a tab that opens one says so on a channel the
 * app's tabs share, and a tab holding it writes what it has and lets it go. Like the
 * map's link (`lib/map/link.js`), nothing leaves the browser.
 *
 * Each kind of document has its own channel: a plate (`lib/plate/oneTab.js`) and a
 * note (`lib/notes/noteDoc.svelte.js`) never answer each other.
 */

/**
 * `onlost(held)`: another tab opened the document this tab holds. `onsaved(held)`:
 * the tab that let it go has written it, so this tab, which opened it a moment
 * before, reads it again. `held` is `{ caseId, name }`.
 */
export function docTabs(channelName, { onlost, onsaved, Channel = globalThis.BroadcastChannel } = {}) {
  if (typeof Channel !== 'function') return { hold() {}, saved() {}, close() {} };
  const me = Math.random().toString(36).slice(2);
  const channel = new Channel(channelName);
  let held = null;
  channel.onmessage = ({ data }) => {
    if (!data || data.from === me || !held || data.caseId !== held.caseId || data.name !== held.name) return;
    if (data.type === 'open') onlost?.({ ...held });
    else if (data.type === 'saved') onsaved?.({ ...held });
  };
  return {
    /** This tab holds the document now, and says so; nothing for none. */
    hold(caseId, name) {
      held = caseId && name ? { caseId, name } : null;
      if (held) channel.postMessage({ type: 'open', from: me, ...held });
    },
    /** The document this tab let go is written. */
    saved(caseId, name) {
      channel.postMessage({ type: 'saved', from: me, caseId, name });
    },
    close() { channel.close(); },
  };
}
