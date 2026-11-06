/**
 * The notes panel's words and messages, with nothing that touches a browser API.
 *
 * Loaded three ways, so it is a classic script that leaves one global behind: by
 * the panel page (`notes.html`), by the Chrome worker (`importScripts`) and by the
 * Firefox event page (the manifest's `background.scripts`, listed first).
 *
 * The extension only ever sends facts to the note: an address, a title, the words
 * selected, the id of a picture it filed. The app writes the Markdown and puts it
 * in, so Undo, the toast and the landing light are the app's own. These helpers
 * make sure what crosses is what the app accepts (`note-put`, version 1), because
 * the app drops anything else without a word.
 */

// eslint-disable-next-line no-unused-vars
const AzimutNotes = (() => {
  /** The app refuses anything longer, silently, so nothing longer is ever sent. */
  const LIMITS = { url: 2048, title: 300, text: 5000 };
  const ACTIONS = new Set(["cite", "quote", "picture"]);
  /** What the app accepts as a message id and as an entity id. */
  const ID = /^[A-Za-z0-9_-]{1,64}$/;

  /** A page that can be cited: http or https, nothing else. */
  function isWeb(url) {
    try {
      const parsed = new URL(String(url));
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /** The paired app's origin, which is the only target a message is posted to. */
  function appOrigin(backendUrl) {
    try {
      const parsed = new URL(String(backendUrl));
      return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.origin : null;
    } catch {
      return null;
    }
  }

  /** Whether a page is the paired app itself, which is no source to cite. */
  function isApp(url, origin) {
    try {
      return Boolean(origin) && new URL(String(url)).origin === origin;
    } catch {
      return false;
    }
  }

  /**
   * The app's own note, alone and compact, for the panel's frame.
   *
   * The case is the one the extension last filed into; without one the app opens
   * the case it has open. A note is named only together with its case, since a
   * note id under another case would open nothing.
   */
  function panelUrl(backendUrl, { caseId = "", noteId = "" } = {}) {
    const origin = appOrigin(backendUrl);
    if (!origin) return null;
    const query = new URLSearchParams();
    if (caseId) {
      query.set("case", caseId);
      if (noteId) query.set("note", noteId);
    }
    query.set("solo", "1");
    query.set("panel", "1");
    return `${origin}/#notebook?${query}`;
  }

  // Hosts written with a prefix, and the other names a site goes by. The same
  // folding as the app's `engine/urltitles.py`, whose post titles these mirror.
  const PREFIXES = ["www.", "mobile.", "m."];
  const SAME_SITE = { "twitter.com": "x.com", "telegram.me": "t.me" };

  function siteOf(parsed) {
    let host = parsed.hostname.toLowerCase();
    const prefix = PREFIXES.find((p) => host.startsWith(p));
    if (prefix) host = host.slice(prefix.length);
    return SAME_SITE[host] || host;
  }

  /**
   * Whether a page is one post on a social site rather than a page.
   *
   * Only the label hangs on it: the app reads the address again and names the
   * source itself. The cases are the ones `engine/urltitles.py` calls a post.
   */
  function isPostUrl(url) {
    let parsed;
    try {
      parsed = new URL(String(url));
    } catch {
      return false;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const host = siteOf(parsed);
    let segs = parsed.pathname.split("/").filter(Boolean);
    const digits = (s) => /^\d+$/.test(s || "");
    if (host === "x.com") {
      const at = segs.indexOf("status");
      return at > 0 && digits(segs[at + 1]);
    }
    if (host === "t.me") {
      if (segs[0] === "s") segs = segs.slice(1);
      if (segs[0] === "c") return segs.length >= 3 && digits(segs[2]);
      return segs.length >= 2 && digits(segs[1]);
    }
    if (host === "bsky.app") return segs.length >= 4 && segs[0] === "profile" && segs[2] === "post";
    if (host === "instagram.com") {
      return (
        (segs.length >= 2 && ["p", "reel", "tv"].includes(segs[0])) ||
        (segs.length >= 3 && ["p", "reel"].includes(segs[1]))
      );
    }
    if (host === "tiktok.com") return segs.length >= 3 && segs[0].startsWith("@") && segs[1] === "video";
    if (host === "facebook.com") {
      return (
        (segs.length >= 3 && ["posts", "videos"].includes(segs[1])) ||
        ["watch", "reel", "share", "permalink.php", "story.php"].includes(segs[0])
      );
    }
    if (host === "reddit.com" || host.endsWith(".reddit.com")) {
      return segs.length >= 4 && segs[0] === "r" && segs[2] === "comments";
    }
    return false;
  }

  /** The right-click item's label for the page it would cite. */
  function citeLabel(url) {
    return isPostUrl(url) ? "Cite this post" : "Cite this page";
  }

  /** The same, short enough for the panel's narrow bar. */
  function citeButton(url) {
    return isPostUrl(url) ? "Cite post" : "Cite page";
  }

  /** At most `n` characters, never ending on half a surrogate pair. */
  function cut(text, n) {
    const s = String(text ?? "");
    return s.length <= n ? s : s.slice(0, n).replace(/[\uD800-\uDBFF]$/, "");
  }

  /** A title that fits, ending on an ellipsis when it had to be shortened. */
  function cutTitle(title) {
    const s = String(title ?? "").replace(/\s+/g, " ").trim();
    return s.length <= LIMITS.title ? s : `${cut(s, LIMITS.title - 1).trimEnd()}…`;
  }

  /**
   * One `note-put`, or an Error whose message is the sentence to show.
   *
   * The words of a quote keep their line breaks: the app quotes them verbatim.
   */
  function buildPut(id, facts = {}) {
    const action = facts.action;
    if (!ACTIONS.has(action)) throw new Error(`no such note action: ${action}`);
    if (!ID.test(String(id))) throw new Error(`not a message id: ${id}`);
    const url = String(facts.url || "");
    if (!isWeb(url)) throw new Error("Open a web page to cite it.");
    if (url.length > LIMITS.url) throw new Error("This address is too long to cite.");
    const message = { azimut: "note-put", v: 1, id: String(id), action, url, title: cutTitle(facts.title) };
    if (action === "quote") {
      const text = cut(String(facts.text ?? "").replace(/\r\n?/g, "\n").trim(), LIMITS.text);
      if (!text.trim()) throw new Error("Select the words to quote first.");
      message.text = text;
    }
    if (action === "picture") {
      if (!ID.test(String(facts.entityId ?? ""))) {
        throw new Error("The capture was filed, but this Azimut gave no picture to put in. Update Azimut.");
      }
      message.entityId = String(facts.entityId);
    }
    return message;
  }

  /** What the panel's Add may ask of the tab in front. */
  const TAB_ACTIONS = new Set(["capture", "cite", "quote", "allow"]);
  const ACCESS = new Set(["open", "closed", "none"]);

  /**
   * One `note-tab`: what the tab in front can give the note's Add. `closed` is a
   * tab the browser keeps from the extension, `none` one with nothing to add from
   * (not a web page, or the app itself); only an `open` tab says what it holds.
   */
  function buildTab(facts = {}) {
    const access = ACCESS.has(facts.access) ? facts.access : "closed";
    const message = { azimut: "note-tab", v: 1, access, url: "", title: "", selection: "", post: false };
    if (access !== "open") return message;
    const url = String(facts.url || "");
    if (!isWeb(url) || url.length > LIMITS.url) return { ...message, access: "none" };
    message.url = url;
    message.title = cutTitle(facts.title);
    message.selection = cut(String(facts.selection ?? "").replace(/\r\n?/g, "\n").trim(), LIMITS.text);
    message.post = isPostUrl(url);
    return message;
  }

  // What each browser says when it keeps a page from the extension: Chrome's
  // "Either the '<all_urls>' or 'activeTab' permission is required." and "Cannot
  // access contents of the page…", Firefox's "Missing activeTab permission" and
  // "Missing host permission for the tab", and the pages no extension may script.
  const REFUSED = /activeTab|<all_urls>|Cannot access|must request permission|cannot be scripted|Missing host permission/i;
  // Chrome allows two captures a second.
  const TOO_FAST = /MAX_CAPTURE_VISIBLE_TAB_CALLS_PER_SECOND/;

  /**
   * What to do instead, when the browser keeps a page from the extension.
   *
   * A right-click item is what opens a page to the extension, so each says which
   * right-click does the same thing.
   */
  const INSTEAD = {
    capture: "Right-click the map, or press Alt+Shift+S, to capture it.",
    quote: "Right-click the selection to quote it.",
    any: "Right-click the page to cite, quote or capture it.",
  };

  /**
   * The sentence the panel shows for an error, never the browser's own words.
   *
   * A refusal becomes what to do instead, for the action that was refused. Any
   * other sentence is passed on as it is: the extension's and the app's are
   * already written to be read.
   */
  function plain(error, action = "") {
    const said = String(error?.message ?? error ?? "").trim();
    if (REFUSED.test(said)) return INSTEAD[action] || INSTEAD.any;
    if (TOO_FAST.test(said)) return "Wait a second, then capture again.";
    return said;
  }

  /**
   * What the note's frame said, or null for anything that is not it.
   *
   * Only the frame this panel holds, from the paired app's origin, is listened
   * to: the panel page has no other child, and a message from anywhere else is
   * not the note's.
   */
  function readFrame(event, frameWindow, origin) {
    if (!event || !frameWindow || event.source !== frameWindow || !origin || event.origin !== origin) return null;
    const data = event.data;
    if (!data || typeof data !== "object" || data.v !== 1) return null;
    const text = (value, n) => (typeof value === "string" ? value.slice(0, n) : "");
    if (data.azimut === "note-panel") {
      return { kind: "panel", ready: data.state === "ready", caseId: text(data.caseId, 200) };
    }
    if (data.azimut === "note-put-done") {
      return { kind: "done", id: String(data.id ?? ""), ok: data.ok === true, error: text(data.error, 300) };
    }
    if (data.azimut === "note-tab-ask") return { kind: "tab-ask" };
    if (data.azimut === "note-tab-run" && TAB_ACTIONS.has(data.action)) return { kind: "tab-run", action: data.action };
    return null;
  }

  return {
    LIMITS, INSTEAD, isWeb, appOrigin, isApp, panelUrl, isPostUrl, citeLabel, citeButton, buildPut, buildTab, plain, readFrame,
  };
})();
