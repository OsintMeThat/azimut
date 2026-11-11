/**
 * Read the link of the post the analyst just sent, and nothing else.
 *
 * After a hand-off, X says "Your post was sent · View" in a toast, and the View is
 * a link to the post. This reads that link where the site shows it, so the app can
 * offer it for the post's Link field and a reply in several posts can go on under
 * the one just sent (`background.js`, "a reply in several posts").
 *
 * It reads and never presses. The words of a toast are translated, so they are not
 * read at all: what is looked for is a link to a post inside a toast. It is taken
 * only when two things the page states agree with it: the handle in the link is the
 * account signed in on this page, and the post's own id says it was made in the
 * last five minutes. A link that fails either is ignored. Nothing of the page but
 * that one address leaves it, and that goes to the worker only.
 *
 * Two lives, one file. The worker loads it (`importScripts` on Chrome, listed
 * before `background.js` on Firefox) for the checks it repeats on what it is
 * told, and injects it into a composer tab it opened itself, in the extension's
 * own world, where `watch` follows the page until the hand-off ends.
 */

(() => {
  if (globalThis.AzimutPostLink) return; // injected again into the same page

  const api = typeof browser !== "undefined" ? browser : typeof chrome !== "undefined" ? chrome : null;

  /** How old a post may be and still be the one just sent. */
  const FRESH_MS = 5 * 60 * 1000;
  /** How far the site's clock may run behind this one. */
  const SKEW_MS = 60 * 1000;

  // X's ids count milliseconds from its own epoch, above 22 bits of machine and
  // sequence (its "snowflake" ids).
  const X_EPOCH = 1288834974657n;
  // A Bluesky record key is a TID: microseconds since 1970 above 10 bits of
  // clock id, written in this base-32 alphabet, which sorts the way the time does.
  const TID = /^[2-7a-j][2-7a-z]{12}$/;
  const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";

  /** When an X post was made, from its id, or null. */
  function statusTime(id) {
    if (!/^\d{1,25}$/.test(String(id))) return null;
    return Number((BigInt(id) >> 22n) + X_EPOCH);
  }

  /** When a Bluesky post was made, from its record key, or null. */
  function tidTime(key) {
    if (!TID.test(String(key))) return null;
    let value = 0n;
    for (const char of key) value = value * 32n + BigInt(TID_ALPHABET.indexOf(char));
    return Number((value >> 10n) / 1000n);
  }

  /**
   * Per site: where a toast is, what a link to a post looks like, and where the
   * page names the account signed in.
   *
   * A toast never holds a post, so a region that does is a feed that happens to be
   * live and is skipped: the analyst's own last post sits in one, fresh enough to
   * pass for the post just sent.
   */
  const SITES = {
    x: {
      hosts: /^(?:www\.|mobile\.)?(?:x|twitter)\.com$/,
      toasts: ['[data-testid="toast"]', '[role="alert"]', '[role="status"]', "[aria-live]"],
      posts: 'article, [data-testid="tweet"], [data-testid="cellInnerDiv"]',
      path: /^\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})\/?$/,
      url: (handle, key) => `https://x.com/${handle}/status/${key}`,
      sent: /^https:\/\/x\.com\/([A-Za-z0-9_]{1,15})\/status\/(\d{1,25})$/,
      time: statusTime,
      // The switcher at the bottom of the side bar names the account, `@handle`
      // on a line of its own; folded to its avatar on a narrow window, the
      // avatar's test id still carries it.
      account(doc) {
        const switcher = doc.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]');
        if (!switcher) return null;
        for (const node of switcher.querySelectorAll("span, div")) {
          const named = /^@([A-Za-z0-9_]{1,15})$/.exec(node.textContent.trim());
          if (named) return named[1];
        }
        const avatar = switcher.querySelector('[data-testid^="UserAvatar-Container-"]');
        return /^UserAvatar-Container-([A-Za-z0-9_]{1,15})$/.exec(avatar?.dataset.testid ?? "")?.[1] ?? null;
      },
    },
    bluesky: {
      hosts: /^bsky\.app$/,
      toasts: ["[data-sonner-toast]", '[role="alert"]', '[role="status"]', "[aria-live]"],
      posts: '[data-testid^="feedItem"], [data-testid^="postThreadItem"]',
      path: /^\/profile\/([A-Za-z0-9.:_-]{1,253})\/post\/([2-7a-z]{13})\/?$/,
      url: (handle, key) => `https://bsky.app/profile/${handle}/post/${key}`,
      sent: /^https:\/\/bsky\.app\/profile\/([A-Za-z0-9.:_-]{1,253})\/post\/([2-7a-z]{13})$/,
      time: tidTime,
      // The side bar's link to the account's own profile. Two accounts named there
      // is no answer.
      account(doc) {
        const named = new Set();
        for (const link of doc.querySelectorAll('nav a[href^="/profile/"], [role="navigation"] a[href^="/profile/"]')) {
          const handle = /^\/profile\/([A-Za-z0-9.:_-]{1,253})\/?$/.exec(link.getAttribute("href") ?? "")?.[1];
          if (handle) named.add(handle.toLowerCase());
        }
        return named.size === 1 ? [...named][0] : null;
      },
    },
  };

  /** Which of these sites an address is on, or null. */
  function siteOf(url) {
    try {
      const { protocol, hostname } = new URL(String(url));
      if (protocol !== "https:") return null;
      return Object.keys(SITES).find((name) => SITES[name].hosts.test(hostname)) ?? null;
    } catch {
      return null;
    }
  }

  /** When a post at this canonical address was made, or null when it is not one. */
  function sentAt(site, url) {
    const rule = SITES[site];
    const parts = rule?.sent.exec(String(url ?? ""));
    return parts ? rule.time(parts[2]) : null;
  }

  /** The record key of a post at this canonical address, or null. */
  function keyOf(site, url) {
    return SITES[site]?.sent.exec(String(url ?? ""))?.[2] ?? null;
  }

  /** A link on the page as a post of this site: `{ handle, key, url }`, or null. */
  function postOf(site, href, origin) {
    const rule = SITES[site];
    try {
      const url = new URL(href, origin);
      if (url.protocol !== "https:" || !rule.hosts.test(url.hostname)) return null;
      const parts = rule.path.exec(url.pathname);
      return parts ? { handle: parts[1], key: parts[2], url: rule.url(parts[1], parts[2]) } : null;
    } catch {
      return null;
    }
  }

  /** The earlier of two record keys: X's by number, Bluesky's by their own order. */
  const earlier = (a, b) => (/^\d+$/.test(a) && /^\d+$/.test(b) ? BigInt(a) < BigInt(b) : a < b);

  /**
   * Look once: the toasts on the page, the post links in them, and the one to keep.
   *
   * Kept is the earliest that passes, which is a thread's first post when a toast
   * names several. `counts` say what was seen, in numbers only, for a report.
   */
  function scan(site, doc, { now = Date.now(), since = 0, seen = [], origin } = {}) {
    const rule = SITES[site];
    const account = rule.account(doc);
    const counts = { toasts: 0, links: 0, refused: 0, account: account ? 1 : 0 };
    const regions = [];
    for (const selector of rule.toasts) {
      for (const node of doc.querySelectorAll(selector)) {
        if (regions.some((region) => region.contains(node))) continue;
        if (node.querySelector(rule.posts) || node.matches(rule.posts)) continue;
        regions.push(node);
      }
    }
    counts.toasts = regions.length;
    let kept = null;
    const read = new Set(); // a toast inside a live region is one toast, not two
    for (const region of regions) {
      const links = region.matches("a[href]") ? [region] : [...region.querySelectorAll("a[href]")];
      for (const link of links) {
        if (read.has(link)) continue;
        read.add(link);
        const post = postOf(site, link.getAttribute("href"), origin);
        if (!post) continue;
        counts.links += 1;
        const at = rule.time(post.key);
        const ours = account && post.handle.toLowerCase() === account.toLowerCase();
        const fresh = at !== null && Math.abs(at - now) <= FRESH_MS && at >= since - SKEW_MS;
        if (!ours || !fresh) {
          counts.refused += 1;
          continue;
        }
        if (seen.includes(post.key)) continue;
        if (!kept || earlier(post.key, kept.key)) kept = { ...post, at };
      }
    }
    return { link: kept ? { url: kept.url, key: kept.key, at: kept.at } : null, counts };
  }

  // --- in a composer tab -----------------------------------------------------

  let current = null; // the one watch this page runs
  let listening = false;

  function tell(message) {
    try {
      Promise.resolve(api?.runtime.sendMessage(message)).catch(() => {});
    } catch {
      // the extension restarted: nobody is waiting on this page any more
    }
  }

  /**
   * Follow the page until the hand-off ends, and tell the worker of each new post
   * of the analyst's that a toast links to.
   *
   * `watch` is the hand-off's id, which every message carries back; `since` is when
   * this step began, `seen` the posts already used, and `deadline` when to give up
   * and say so. Ended by the worker (`stop`), by the deadline, or by the page going.
   */
  function watch({ watch: id, site, since = Date.now(), seen = [], deadline }) {
    current?.stop();
    if (!SITES[site]) return false;
    const reported = new Set(seen);
    let counts = { toasts: 0, links: 0, refused: 0, account: 0 };
    let pending = null;
    const look = () => {
      pending = null;
      if (current !== self) return;
      const found = scan(site, document, {
        since,
        seen: [...reported],
        origin: location.origin,
      });
      counts = found.counts;
      if (!found.link) return;
      reported.add(found.link.key);
      tell({ type: "post-link-seen", watch: id, url: found.link.url });
    };
    // A page like X's changes all the time; one look per short while is plenty.
    const soon = () => {
      pending ??= setTimeout(look, 150);
    };
    const observer = new MutationObserver(soon);
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["href"],
    });
    const timer = setTimeout(() => {
      if (current !== self) return;
      self.stop();
      tell({ type: "post-link-timeout", watch: id });
    }, Math.max(0, (deadline ?? Date.now() + 10 * 60 * 1000) - Date.now()));
    const self = {
      id,
      counts: () => counts,
      stop() {
        observer.disconnect();
        clearTimeout(timer);
        clearTimeout(pending);
        if (current === self) current = null;
      },
    };
    current = self;
    if (!listening && api?.runtime?.onMessage) {
      listening = true;
      api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg?.type !== "post-watch" || !current || msg.watch !== current.id) return false;
        const answer = msg.ask === "probe" ? { alive: true, counts: current.counts() } : { alive: true };
        if (msg.ask === "stop") current.stop();
        sendResponse(answer);
        return false;
      });
    }
    look();
    return true;
  }

  globalThis.AzimutPostLink = { SITES, FRESH_MS, SKEW_MS, statusTime, tidTime, siteOf, sentAt, keyOf, postOf, scan, watch };
})();
