/**
 * Two map tabs pointed at the same ground.
 *
 * Once the view is in the address (`view.js`), making a second tab follow the
 * first costs almost nothing — and it buys a first version of Compare without
 * writing Compare: two tabs, two providers, two screens, one camera. That is
 * what this is for.
 *
 * **It never touches the network.** A `BroadcastChannel` carries a camera
 * between tabs of the same browser, which is exactly as far as this has to
 * reach: the tabs are the same app on the same machine, and a view is not case
 * state — nothing here is written down, and the app's own nudge channel stays
 * for the things that are.
 *
 * The hard part is not the channel, it is the echo. A tab that applies a view
 * settles, and a settle is what makes it send: two linked tabs would then push
 * one camera back and forth for ever, each landing a rounding error from where
 * the other put it. So a tab never sends back the view it was just given, which
 * `sameView` is the whole of — a comparison loose enough to catch a camera that
 * came back changed only by the projection it went through.
 *
 * The channel also answers "is there anybody else?", because a button offering
 * to link one tab to nothing is a button that does nothing when pressed. Nobody
 * can ask a `BroadcastChannel` who is listening, so each map tab says hello when
 * it opens, answers somebody else's hello, and says goodbye when it goes — on
 * teardown and on `pagehide`, since a closed tab runs no teardown. A tab killed
 * outright leaves its name behind until the next hello, which costs a button
 * that is lit with nothing behind it: exactly what it was before this existed.
 *
 * **Maps outside the app join through the extension.** Its map tools panel
 * follows a camera on Google, Bing, Earth and the rest by writing it into their
 * address bar, and it cannot hear this channel from another origin, so the
 * extension's worker is the hub for those and the bridge on this page is this
 * tab's end of it (`extBridge.js`, `mapLinkRelay`). What arrives that way is
 * treated exactly like a peer tab's camera, and counted as a peer.
 *
 * **A map lands as close as it goes.** One tab's imagery stops at 19 while the
 * one it follows is at 21: the view it settles on is not the one it was handed,
 * and sending that back would pull the leader out to 19. So the first settle
 * after a view arrives is taken as the landing whatever its zoom, as long as it
 * is on the same spot.
 */

/** Under a tenth of this and two cameras are pointed at the same thing. */
const PLACES = 5; // ~1 m
const BEARING_EPSILON = 0.5; // degrees
/** How long after a view arrives the map's settle is its landing. Long enough
 *  for an eased camera, short enough that a zoom the analyst makes on the same
 *  spot afterwards is theirs. */
const LANDING_MS = 2000;

/** The channel every map tab of this app speaks on. */
export const CHANNEL = 'azimut:map-view';

/** Is this the same camera, allowing for what a round trip does to it? */
export function sameView(a, b) {
  return samePlace(a, b) && Math.round(a.zoom) === Math.round(b.zoom);
}

/** The same spot and heading, whatever the zoom: where a map that stopped short
 *  of a view still is. */
export function samePlace(a, b) {
  if (!a || !b) return false;
  return (
    a.lat.toFixed(PLACES) === b.lat.toFixed(PLACES) &&
    a.lon.toFixed(PLACES) === b.lon.toFixed(PLACES) &&
    Math.abs((a.bearing ?? 0) - (b.bearing ?? 0)) < BEARING_EPSILON
  );
}

/** A camera worth sending: anything else would move a peer to nowhere. */
export function readable(view) {
  return Boolean(
    view &&
      Number.isFinite(view.lat) &&
      Number.isFinite(view.lon) &&
      Number.isFinite(view.zoom) &&
      Math.abs(view.lat) <= 90 &&
      Math.abs(view.lon) <= 180
  );
}

/** What a tab says on the channel: a camera, or which tabs are here. */
const VIEW = 'view';
const HELLO = 'hello'; // a tab opened and is asking who else is there
const HERE = 'here'; // the answer to somebody else's hello
const BYE = 'bye'; // that tab is going

/**
 * The link itself: send this tab's camera, hear the others', know they exist.
 *
 * `BroadcastChannel` does not deliver to the tab that posted, so a tab never
 * hears itself — what it can hear is its own view coming back off a peer, which
 * is what `sameView` stops.
 *
 * `onPeers` is called with how many other maps are open, whenever that
 * changes, so the caller can grey a button that would link to nobody.
 *
 * `relay` is the extension's end, when there is one (`extBridge.js`): it is
 * given `{ view, peers }` to call, and is sent this tab's camera. `peers` there
 * reports the extension's panels, which the app's own tabs cannot see.
 *
 * Returns a link that is `alive: false` where the browser has no channel and no
 * extension (an old build, a hardened profile). The caller then simply has a
 * button that links nothing, which is better than a tool that will not mount.
 */
export function createViewLink(onView, { channel = CHANNEL, onPeers = null, relay = null } = {}) {
  const bus = typeof BroadcastChannel === 'function' ? new BroadcastChannel(channel) : null;
  if (!bus && !relay) {
    return { alive: false, get peers() { return 0; }, send() {}, close() {} };
  }
  const me = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  /** The other map tabs, by the name each of them announced itself under. */
  const peers = new Set();
  /** How many of the extension's map panels are open. */
  let panels = 0;
  /** The last camera this tab was handed, so it is never handed back. */
  let given = null;
  /** Until when a settle on `given`'s spot is this map landing there. */
  let landingUntil = 0;

  const count = () => peers.size + panels;
  const say = (kind, extra) => bus?.postMessage({ from: me, kind, ...extra });

  const receive = (view) => {
    if (!readable(view)) return;
    given = view;
    landingUntil = Date.now() + LANDING_MS;
    onView(view);
  };

  if (bus) {
    bus.onmessage = (event) => {
      const message = event.data;
      if (!message?.from || message.from === me) return;
      if (message.kind === BYE) {
        if (peers.delete(message.from)) onPeers?.(count());
        return;
      }
      // Anything a tab says proves it is there, which is what keeps this honest
      // through a reload: the new tab's hello arrives under a new name.
      if (!peers.has(message.from)) {
        peers.add(message.from);
        onPeers?.(count());
      }
      if (message.kind === HELLO) say(HERE); // so the newcomer can count this tab
      if (message.kind === VIEW) receive(message.view);
    };
  }

  relay?.listen({
    view: receive,
    peers: (n) => {
      const next = Number.isInteger(n) && n > 0 ? n : 0;
      if (next === panels) return;
      panels = next;
      onPeers?.(count());
    },
  });

  const leave = () => say(BYE);
  window.addEventListener('pagehide', leave);
  say(HELLO);

  return {
    alive: true,
    /** How many other maps are open right now, tabs and panels together. */
    get peers() {
      return count();
    },
    /** Tell the peers where this tab is now, unless they are why it is there. */
    send(view) {
      if (!readable(view)) return false;
      if (Date.now() < landingUntil && samePlace(view, given)) {
        // where it was sent, perhaps short of the zoom it was handed: not news
        given = view;
        landingUntil = 0;
        return false;
      }
      if (sameView(view, given)) return false;
      given = null; // the camera moved on its own; the next peer view is news
      landingUntil = 0;
      const out = { lat: view.lat, lon: view.lon, zoom: view.zoom, bearing: view.bearing ?? 0 };
      say(VIEW, { view: out });
      relay?.send(out);
      return true;
    },
    close() {
      window.removeEventListener('pagehide', leave);
      leave();
      relay?.close();
      if (bus) {
        bus.onmessage = null;
        bus.close();
      }
    },
  };
}
