// @vitest-environment happy-dom
/**
 * Tests for the script that reads the link of a post the analyst just sent
 * (extension/postlink.js).
 *
 * It reads one thing off X and Bluesky: a link to a post inside a toast. What is
 * pinned here is the rule around it rather than the markup, which will move: the
 * words of a toast are never read (the fixtures are in French on purpose), a link
 * counts only when its handle is the account signed in on the page and its id says
 * it was made in the last five minutes, and nothing is ever pressed.
 *
 * Like the other extension suites, the source is evaluated with stubs. Handles and
 * ids are synthetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/postlink.js'), 'utf8');

/** An X status id made at `ms`. */
const snowflake = (ms) => String((BigInt(ms) - 1288834974657n) << 22n);
/** A Bluesky record key made at `ms`. */
function tid(ms) {
  const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
  let value = (BigInt(ms) * 1000n) << 10n;
  let out = '';
  for (let i = 0; i < 13; i += 1) {
    out = alphabet[Number(value % 32n)] + out;
    value /= 32n;
  }
  return out;
}

/** postlink.js in a world of its own, as each page gets one. */
function load({ chrome = null, origin = 'https://x.com' } = {}) {
  const world = {};
  new Function('globalThis', 'chrome', 'browser', 'location', source)(world, chrome, undefined, {
    origin,
    hostname: new URL(origin).hostname,
  });
  return world.AzimutPostLink;
}

// The account switcher at the bottom of X's side bar, as a French page draws it.
const SWITCHER = `<nav><div data-testid="SideNav_AccountSwitcher_Button" role="button">
  <div data-testid="UserAvatar-Container-desk"></div>
  <div><div><span>Desk @ work</span></div><div><span>@desk</span></div></div>
</div></nav>`;
// "Your post was sent · View", in French.
const TOAST = (href) => `<div data-testid="toast" role="alert">
  <div><span>Votre post a été envoyé.</span></div>
  <a href="${href}" role="link"><span>Voir</span></a>
</div>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('the time a post was made, from its id', () => {
  it('reads an X id and a Bluesky record key', () => {
    const reader = load();
    const at = Date.UTC(2026, 10, 11, 9, 30);
    expect(reader.statusTime(snowflake(at))).toBe(at);
    expect(reader.tidTime(tid(at))).toBe(at);
    expect(reader.statusTime('not-an-id')).toBeNull();
    expect(reader.tidTime('3kabc')).toBeNull(); // a key that is not a TID says no time
  });
});

describe('reading the link of the post just sent, on X', () => {
  const scan = (reader, extra = {}) => reader.scan('x', document, { origin: 'https://x.com', ...extra });

  it('takes the link in the toast when it is the account signed in and fresh', () => {
    const reader = load();
    const id = snowflake(Date.now() - 2000);
    document.body.innerHTML = SWITCHER + TOAST(`/desk/status/${id}`);
    const { link, counts } = scan(reader);
    expect(link).toEqual({ url: `https://x.com/desk/status/${id}`, key: id, at: expect.any(Number) });
    expect(counts).toEqual({ toasts: 1, links: 1, refused: 0, account: 1 });
  });

  it('ignores a link to another account', () => {
    const reader = load();
    document.body.innerHTML = SWITCHER + TOAST(`/someone_else/status/${snowflake(Date.now())}`);
    const { link, counts } = scan(reader);
    expect(link).toBeNull();
    expect(counts.refused).toBe(1);
  });

  it('ignores a post older than five minutes, or older than the step', () => {
    const reader = load();
    document.body.innerHTML = SWITCHER + TOAST(`/desk/status/${snowflake(Date.now() - 6 * 60 * 1000)}`);
    expect(scan(reader).link).toBeNull();
    document.body.innerHTML = SWITCHER + TOAST(`/desk/status/${snowflake(Date.now() - 3 * 60 * 1000)}`);
    expect(scan(reader, { since: Date.now() - 60 * 1000 }).link).toBeNull();
    // and an id from long ago, which is not a snowflake at all
    document.body.innerHTML = SWITCHER + TOAST('/desk/status/20');
    expect(scan(reader).link).toBeNull();
  });

  it('takes nothing when the page does not say who is signed in', () => {
    const reader = load();
    document.body.innerHTML = TOAST(`/desk/status/${snowflake(Date.now())}`);
    const { link, counts } = scan(reader);
    expect(link).toBeNull();
    expect(counts).toMatchObject({ account: 0, refused: 1 });
  });

  it('reads the account off the avatar on a narrow window, where the switcher has no words', () => {
    const reader = load();
    const id = snowflake(Date.now());
    document.body.innerHTML =
      '<div data-testid="SideNav_AccountSwitcher_Button"><div data-testid="UserAvatar-Container-desk"></div></div>' +
      TOAST(`/desk/status/${id}`);
    expect(scan(reader).link?.key).toBe(id);
  });

  it('keeps the first post of a thread when a toast names several', () => {
    const reader = load();
    const head = snowflake(Date.now() - 3000);
    const tail = snowflake(Date.now() - 1000);
    document.body.innerHTML = SWITCHER + `<div data-testid="toast">
      <a href="/desk/status/${tail}">2</a><a href="https://x.com/desk/status/${head}">1</a></div>`;
    expect(scan(reader).link.key).toBe(head);
  });

  it('skips a post already used, and a live region that holds posts', () => {
    const reader = load();
    const id = snowflake(Date.now());
    document.body.innerHTML = SWITCHER + TOAST(`/desk/status/${id}`);
    expect(scan(reader, { seen: [id] }).link).toBeNull();
    // the analyst's own last post, fresh, in a feed that happens to be live
    document.body.innerHTML = SWITCHER + `<section aria-live="polite"><article data-testid="tweet">
      <a href="/desk/status/${id}"><time></time></a></article></section>`;
    expect(scan(reader).link).toBeNull();
  });

  it('takes no link off another site, nor a status page under it', () => {
    const reader = load();
    const id = snowflake(Date.now());
    document.body.innerHTML = SWITCHER + TOAST(`https://evil.example/desk/status/${id}`) +
      TOAST(`/desk/status/${id}/photo/1`);
    expect(scan(reader).link).toBeNull();
  });
});

describe('reading the link of the post just sent, on Bluesky', () => {
  const NAV = '<nav><a href="/profile/desk.bsky.social">Profil</a></nav>';
  const BSKY_TOAST = (href) => `<li data-sonner-toast><span>Votre post a été publié</span><a href="${href}">Voir</a></li>`;

  it('takes a link to the account\'s own post when the side bar names it', () => {
    const reader = load({ origin: 'https://bsky.app' });
    const key = tid(Date.now() - 1000);
    document.body.innerHTML = NAV + BSKY_TOAST(`/profile/desk.bsky.social/post/${key}`);
    const { link } = reader.scan('bluesky', document, { origin: 'https://bsky.app' });
    expect(link?.url).toBe(`https://bsky.app/profile/desk.bsky.social/post/${key}`);
  });

  it('sends nothing when nothing reliable is there', () => {
    const reader = load({ origin: 'https://bsky.app' });
    const key = tid(Date.now());
    // no account named on the page
    document.body.innerHTML = BSKY_TOAST(`/profile/desk.bsky.social/post/${key}`);
    expect(reader.scan('bluesky', document, { origin: 'https://bsky.app' }).link).toBeNull();
    // another account's post
    document.body.innerHTML = NAV + BSKY_TOAST(`/profile/someone.bsky.social/post/${key}`);
    expect(reader.scan('bluesky', document, { origin: 'https://bsky.app' }).link).toBeNull();
    // a record key that carries no time
    document.body.innerHTML = NAV + BSKY_TOAST('/profile/desk.bsky.social/post/3kabc');
    expect(reader.scan('bluesky', document, { origin: 'https://bsky.app' }).link).toBeNull();
  });
});

describe('following a page until the post is sent', () => {
  let sent;
  let listeners;
  let chrome;
  beforeEach(() => {
    sent = [];
    listeners = [];
    chrome = {
      runtime: {
        sendMessage: vi.fn(async (msg) => sent.push(msg)),
        onMessage: { addListener: (cb) => listeners.push(cb) },
      },
    };
  });
  afterEach(() => vi.useRealTimers());

  const ask = (msg) => {
    let answer;
    for (const cb of listeners) cb(msg, {}, (a) => (answer = a));
    return answer;
  };
  const settle = () => new Promise((r) => setTimeout(r, 250));

  it('tells the worker once when the toast appears, and presses nothing', async () => {
    const clicks = [];
    document.addEventListener('click', (e) => clicks.push(e.target), true);
    document.body.innerHTML = SWITCHER;
    const reader = load({ chrome });
    reader.watch({ watch: 'w1', site: 'x', since: Date.now(), deadline: Date.now() + 60000 });
    await settle();
    expect(sent).toEqual([]);

    const id = snowflake(Date.now());
    document.body.insertAdjacentHTML('beforeend', TOAST(`/desk/status/${id}`));
    await settle();
    expect(sent).toEqual([{ type: 'post-link-seen', watch: 'w1', url: `https://x.com/desk/status/${id}` }]);
    // the toast staying up is not a second post
    document.body.insertAdjacentHTML('beforeend', '<span>more page</span>');
    await settle();
    expect(sent).toHaveLength(1);
    expect(clicks).toEqual([]);
    ask({ type: 'post-watch', watch: 'w1', ask: 'stop' });
  });

  it('answers the worker for its own hand-off only, in counts', async () => {
    document.body.innerHTML = SWITCHER + TOAST(`/someone_else/status/${snowflake(Date.now())}`);
    const reader = load({ chrome });
    reader.watch({ watch: 'w2', site: 'x', since: Date.now(), deadline: Date.now() + 60000 });
    expect(ask({ type: 'post-watch', watch: 'other', ask: 'ping' })).toBeUndefined();
    expect(ask({ type: 'post-watch', watch: 'w2', ask: 'ping' })).toEqual({ alive: true });
    expect(ask({ type: 'post-watch', watch: 'w2', ask: 'probe' })).toEqual({
      alive: true,
      counts: { toasts: 1, links: 1, refused: 1, account: 1 },
    });
    ask({ type: 'post-watch', watch: 'w2', ask: 'stop' });
    // stopped: nobody answers any more
    expect(ask({ type: 'post-watch', watch: 'w2', ask: 'ping' })).toBeUndefined();
  });

  it('says so when the deadline passes with no post', async () => {
    vi.useFakeTimers();
    document.body.innerHTML = SWITCHER;
    const reader = load({ chrome });
    reader.watch({ watch: 'w3', site: 'x', since: Date.now(), deadline: Date.now() + 10 * 60 * 1000 });
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000);
    expect(sent).toEqual([{ type: 'post-link-timeout', watch: 'w3' }]);
    // and a toast after that is nobody's business
    document.body.insertAdjacentHTML('beforeend', TOAST(`/desk/status/${snowflake(Date.now())}`));
    await vi.advanceTimersByTimeAsync(500);
    expect(sent).toHaveLength(1);
  });
});
