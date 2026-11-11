// @vitest-environment happy-dom
/**
 * A hand-off to X from end to end: the worker (extension/background.js), the
 * filler it injects (handoff.js) and the link reader (postlink.js), wired to one
 * page the way a browser wires them to a tab.
 *
 * The page is X's reply dialog as a logged-in French account draws it today: the
 * source post quoted on top, the box, one picture, a toolbar of icons, the counter
 * and **Répondre**, and no "+" to add a post. So a reply in several posts goes out
 * one reply at a time: the extension fills a post, the analyst presses Répondre,
 * X says so in a toast that links to the reply, and the extension opens that reply
 * and fills the next under it. What these tests hold above all is that **nothing
 * that sends is ever pressed**: the press on Répondre is the test's, standing in
 * for the analyst's.
 *
 * Handles and ids are synthetic.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, `../../../extension/${name}`), 'utf8');
const WORKER = read('background.js');
const FILLER = read('handoff.js');
const READER = read('postlink.js');

const WATCH_MS = 10 * 60 * 1000;
const SOURCE_ID = '1850000000000000000';
const SOURCE = `https://x.com/someone/status/${SOURCE_ID}`;
const snowflake = (ms) => String((BigInt(ms) - 1288834974657n) << 22n);
const POSTS = [
  { text: 'Geolocated: the strike hit the depot north of the bridge.', files: ['proofs/depot.png'] },
  { text: 'The roof line and the water tower match the satellite view.', files: [] },
  { text: 'Imagery: Esri World Imagery.', files: [] },
];

// The fakes handoff.js's own suite uses: happy-dom's events carry no clipboard.
class FakeDataTransfer {
  constructor() {
    this.text = null;
    this.files = [];
    this.items = { add: (file) => this.files.push(file) };
  }
  setData(type, value) {
    if (type === 'text/plain') this.text = value;
  }
}
class FakeClipboardEvent extends Event {
  constructor(type, init = {}) {
    super(type, init);
    this.clipboardData = init.clipboardData;
  }
}
class FakeDragEvent extends Event {}
class FakeFile {
  constructor(parts, name, opts) {
    this.parts = parts;
    this.name = name;
    this.type = opts?.type;
  }
}

// The account switcher, a status page's post, and the reply dialog its reply opens.
const SWITCHER = `<nav><div data-testid="SideNav_AccountSwitcher_Button" role="button">
  <div data-testid="UserAvatar-Container-desk"></div><div><span>Desk</span></div><div><span>@desk</span></div>
</div></nav>`;
const STATUS_PAGE = (handle, id) => `${SWITCHER}<main>
  <article data-testid="tweet" tabindex="-1">
    <div data-testid="User-Name"><span>${handle}</span><span>@${handle}</span></div>
    <div data-testid="tweetText">A post on the page, which no report may carry.</div>
    <a href="/${handle}/status/${id}"><time datetime="2026-11-11T09:00:00Z">9:00</time></a>
    <button data-testid="reply"></button><button data-testid="retweet"></button><button data-testid="like"></button>
  </article>
</main>`;
const REPLY_DIALOG = ({ add = false } = {}) => `
  <div data-testid="tweet"><div data-testid="tweetText">The source post, quoted.</div></div>
  <div data-testid="tweetTextarea_0" contenteditable="true"></div>
  <div data-testid="attachments"></div>
  <div data-testid="toolBar">
    <input type="file" data-testid="fileInput" />
    <button data-testid="gifSearchButton"></button>
    <button data-testid="createPollButton"></button>
    <button aria-label="Emoji"></button>
    <button data-testid="scheduleOption"></button>
    <button data-testid="geoButton"></button>
    <button aria-label="Signaler"></button>
    ${add ? '<button data-testid="addButton"></button>' : ''}
  </div>
  <div role="progressbar" aria-valuenow="20"></div>
  <button data-testid="tweetButton"><span>Répondre</span></button>`;

// Every browser a test made, closed after it: a hand-off left waiting would read
// the next test's page, which is the same document.
const browsers = [];

/**
 * One browser: a composer tab (7) the worker opens, and Azimut's tab (21).
 * Returns the worker's entry points and what happened.
 */
function browser({ add = false, clipboard = true } = {}) {
  const tab = { id: 7, url: null, open: true, world: null, listeners: [] };
  const updated = new Set();
  const removed = [];
  const told = []; // what reached Azimut's tab
  const notes = [];
  const copied = [];
  const sends = []; // presses on the button that sends
  const session = {};
  let worker;

  const fire = (info, tabInfo = { id: 7, url: tab.url }) => {
    for (const cb of [...updated]) cb(7, info, tabInfo);
  };
  const where = () => {
    const url = new URL(tab.url);
    return { hostname: url.hostname, pathname: url.pathname, origin: url.origin };
  };

  /** A page loaded in the tab: a new document, so no reader on it yet. */
  function load(url) {
    tab.world?.AzimutPostLink?.watch({ site: '' }); // the old page's reader goes with it
    tab.world = null;
    tab.listeners = [];
    tab.url = url;
    const path = new URL(url).pathname.split('/');
    document.body.innerHTML = STATUS_PAGE(path[1], path[3]);
    const reply = document.querySelector('[data-testid="reply"]');
    reply.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.innerHTML = REPLY_DIALOG({ add });
      document.body.append(dialog);
      const grow = (box) =>
        box.addEventListener('paste', (e) => {
          box.textContent += e.clipboardData.text ?? '';
        });
      grow(dialog.querySelector('[contenteditable]'));
      dialog.querySelector('[data-testid="tweetButton"]').addEventListener('click', () => sends.push(tab.url));
      dialog.querySelector('[data-testid="addButton"]')?.addEventListener('click', () => {
        const boxes = dialog.querySelectorAll('[contenteditable]');
        const box = document.createElement('div');
        box.dataset.testid = `tweetTextarea_${boxes.length}`;
        box.setAttribute('contenteditable', 'true');
        boxes[boxes.length - 1].after(box);
        grow(box);
      });
    });
  }

  const contentChrome = {
    runtime: {
      sendMessage: async (msg) => worker.handle(msg, { tab: { id: 7, url: tab.url } }),
      onMessage: { addListener: (cb) => tab.listeners.push(cb) },
    },
  };
  const navigatorStub = {
    clipboard: {
      writeText: async (text) => {
        if (!clipboard) throw new Error('NotAllowedError');
        copied.push(text);
      },
    },
  };

  const chrome = {
    storage: {
      local: { get: async (d) => ({ ...d, backendUrl: 'http://127.0.0.1:8477', token: 'tok-123' }), set: vi.fn() },
      session: {
        get: async (d) => ({ ...(typeof d === 'object' ? d : {}), ...session }),
        set: async (v) => Object.assign(session, v),
        remove: async () => {},
      },
    },
    tabs: {
      create: async ({ url }) => {
        load(url);
        setTimeout(() => fire({ status: 'complete' }), 0);
        return { id: 7 };
      },
      update: async (id, { url }) => {
        if (!tab.open) throw new Error('No tab with id: 7');
        load(url);
        fire({ status: 'loading', url });
        setTimeout(() => fire({ status: 'complete' }), 0);
        return { id };
      },
      get: async (id) => {
        if (id === 7 && !tab.open) throw new Error('No tab with id: 7');
        return { id };
      },
      query: async () => [{ id: 21, url: 'http://127.0.0.1:8477/#post', lastAccessed: 1 }],
      sendMessage: async (id, msg) => {
        if (id === 21) {
          told.push(msg);
          return { ok: true };
        }
        if (!tab.open || !tab.listeners.length) throw new Error('Receiving end does not exist.');
        let answer;
        for (const cb of tab.listeners) cb(msg, {}, (a) => (answer = a));
        return answer;
      },
      onUpdated: { addListener: (cb) => updated.add(cb), removeListener: (cb) => updated.delete(cb) },
      onRemoved: { addListener: (cb) => removed.push(cb) },
      onActivated: { addListener: () => {} },
    },
    scripting: {
      executeScript: async ({ target, world, func, args = [], files }) => {
        if (target.tabId !== 7) return [{ result: undefined }];
        if (!tab.open) throw new Error('No tab with id: 7');
        if (files?.[0] === 'handoff.js') {
          const result = await new Function(
            'location', 'DataTransfer', 'ClipboardEvent', 'DragEvent', 'File',
            `const report = ${FILLER}\n; return report;`
          )(where(), FakeDataTransfer, FakeClipboardEvent, FakeDragEvent, FakeFile);
          return [{ result }];
        }
        if (files?.[0] === 'postlink.js') {
          tab.world = {};
          new Function('globalThis', 'chrome', 'browser', 'location', READER)(tab.world, contentChrome, undefined, where());
          return [{}];
        }
        if (world === 'MAIN') return [{ result: await func(...args) }];
        // The extension's own world on that page: the function travels as its source.
        const result = await new Function('globalThis', 'navigator', 'args', `return (${func})(...args);`)(
          tab.world ?? {},
          navigatorStub,
          args
        );
        return [{ result }];
      },
    },
    notifications: { create: ({ message }) => notes.push(message) },
    management: { getSelf: async () => ({ installType: 'development' }) },
    contextMenus: { removeAll: async () => {}, create: () => {}, update: async () => {} },
    runtime: {
      id: 'theid',
      getManifest: () => ({ version: '9.9.9' }),
      getURL: (p) => `moz-extension://id/${p}`,
      onMessage: { addListener: () => {} },
      onConnect: { addListener: () => {} },
    },
  };

  // The worker loads the reader's checks as the browser would, before itself.
  const checks = {};
  new Function('globalThis', 'chrome', 'browser', READER)(checks, undefined, undefined);
  globalThis.AzimutPostLink = checks.AzimutPostLink;
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    headers: { get: () => null },
    blob: async () => ({ type: 'image/png', arrayBuffer: async () => new Uint8Array([0x89, 0x50]).buffer }),
  });
  worker = new Function('chrome', 'browser', 'fetch', `${WORKER}\n;return { handle, handOff };`)(
    chrome,
    undefined,
    fetchImpl
  );

  /** The analyst presses Répondre: X sends, closes the dialog and says so in a toast. */
  function pressSend(id = snowflake(Date.now())) {
    document.querySelector('[role="dialog"]')?.remove();
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-testid="toast" role="alert"><span>Votre post a été envoyé.</span>` +
        `<a href="/desk/status/${id}" role="link"><span>Voir</span></a></div>`
    );
    return id;
  }
  const box = (i = 0) => document.querySelector(`[role="dialog"] [data-testid="tweetTextarea_${i}"]`)?.textContent;
  const close = () => {
    tab.open = false;
    for (const cb of removed) cb(7);
  };
  const made = { worker, tab, told, notes, copied, sends, fire, pressSend, box, close };
  browsers.push(made);
  return made;
}

/** Wait for the worker to say `text`. */
async function heard(notes, text, ms = 15000) {
  const until = Date.now() + ms;
  while (!notes.some((note) => note.includes(text))) {
    if (Date.now() > until) throw new Error(`never heard "${text}"; heard ${JSON.stringify(notes)}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

const payload = { url: SOURCE, reply_to: SOURCE, caseId: 'case-1', draft: 'depot-strike', posts: POSTS };

beforeEach(() => {
  document.execCommand = () => false;
});
afterEach(() => {
  for (const b of browsers.splice(0)) {
    if (b.tab.open) b.close();
    b.tab.world?.AzimutPostLink?.watch({ site: '' }); // its reader goes with the tab
  }
  vi.useRealTimers();
  delete globalThis.AzimutPostLink;
});

describe('a reply in several posts, where the reply box offers no next post', () => {
  it('fills post 1, then each next post under the reply the analyst sent, pressing nothing that sends', async () => {
    const b = browser();
    await expect(b.worker.handOff(payload)).resolves.toEqual({ ok: true, accepted: true });

    await heard(b.notes, 'Post 1 of 3 is ready. Press Reply, then Azimut opens the next under it.');
    expect(b.box()).toBe(POSTS[0].text);
    expect(b.told).toEqual([]);

    const first = b.pressSend();
    await heard(b.notes, 'Post 2 of 3 is ready under your reply.');
    expect(b.tab.url).toBe(`https://x.com/desk/status/${first}`);
    expect(b.box()).toBe(POSTS[1].text);
    // the first reply's link, offered to the app once
    expect(b.told).toEqual([
      {
        type: 'post-link-caught',
        caseId: 'case-1',
        draft: 'depot-strike',
        url: `https://x.com/desk/status/${first}`,
        site: 'x',
        at: expect.stringMatching(/^\d{4}-\d\d-\d\dT/),
      },
    ]);

    const second = b.pressSend(snowflake(Date.now() + 1000));
    await heard(b.notes, 'Post 3 of 3 is ready under your reply.');
    expect(b.tab.url).toBe(`https://x.com/desk/status/${second}`);
    expect(b.box()).toBe(POSTS[2].text);

    // the last post is the analyst's to send; the hand-off is over
    b.pressSend(snowflake(Date.now() + 2000));
    await new Promise((r) => setTimeout(r, 400));
    expect(b.told).toHaveLength(1);
    expect(b.sends).toEqual([]);
    expect(b.notes.filter((note) => /stopped/.test(note))).toEqual([]);
  }, 40000);

  it('keeps the thread in the one box where the reply box offers a next post', async () => {
    const b = browser({ add: true });
    await b.worker.handOff(payload);
    await new Promise((r) => setTimeout(r, 50));
    const until = Date.now() + 15000;
    while (b.box(2) !== POSTS[2].text && Date.now() < until) await new Promise((r) => setTimeout(r, 50));

    expect([b.box(0), b.box(1), b.box(2)]).toEqual(POSTS.map((post) => post.text));
    expect(b.notes.filter((note) => /is ready/.test(note))).toEqual([]);
    const sent = b.pressSend();
    await new Promise((r) => setTimeout(r, 400));
    expect(b.told.map((msg) => msg.url)).toEqual([`https://x.com/desk/status/${sent}`]);
    expect(b.tab.url).toBe(SOURCE); // nothing more to open
    expect(b.sends).toEqual([]);
  }, 30000);

  it('goes on only under a fresh post of the account signed in', async () => {
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');

    b.pressSend(snowflake(Date.now() - 20 * 60 * 1000)); // an old post
    document.body.insertAdjacentHTML(
      'beforeend',
      `<div data-testid="toast"><a href="/someone_else/status/${snowflake(Date.now())}">Voir</a></div>`
    );
    await new Promise((r) => setTimeout(r, 500));
    expect(b.tab.url).toBe(SOURCE);
    expect(b.told).toEqual([]);

    const mine = b.pressSend();
    await heard(b.notes, 'Post 2 of 3 is ready under your reply.');
    expect(b.tab.url).toBe(`https://x.com/desk/status/${mine}`);
  }, 30000);
});

describe('where a reply in several posts stops', () => {
  it('stops after ten minutes without a reply, puts the rest on the clipboard and reports', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');

    await vi.advanceTimersByTimeAsync(WATCH_MS);
    await heard(b.notes, 'No reply was seen within 10 minutes');
    expect(b.notes.at(-1)).toBe(
      'No reply was seen within 10 minutes, so Azimut stopped after post 1 of 3. Posts 2 to 3 are on your clipboard.'
    );
    expect(b.copied).toEqual([`${POSTS[1].text}\n\n${POSTS[2].text}`]);

    const report = b.told.find((msg) => msg.type === 'post-handoff-report');
    expect(report).toMatchObject({
      caseId: 'case-1',
      draft: 'depot-strike',
      error: 'No reply was seen within 10 minutes, so Azimut stopped after post 1 of 3.',
    });
    expect(report.report.split('\n')).toEqual([
      'Azimut Capture 9.9.9 on x.com',
      'Step: catch-link',
      'Stopped: timeout',
      'Selectors: editors 1+1, add 0+0, files 1+1+1, reply 1',
      'Buttons in the dialog: fileInput, gifSearchButton, createPollButton, scheduleOption, geoButton, tweetButton',
      'Link: toasts 0, post links 0, refused 0, account found',
    ]);
    // the report carries no word of the page, no handle, no post and no address
    expect(report.report).not.toMatch(/desk|someone|Geolocated|quoted|Répondre|status|https?:|\/\//i);
    expect(b.sends).toEqual([]);
  }, 30000);

  it('stops when the tab is closed, and says the thread is on the clipboard', async () => {
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');

    b.close();
    await heard(b.notes, 'The tab was closed');
    expect(b.notes.at(-1)).toBe(
      'The tab was closed, so Azimut stopped after post 1 of 3. The thread is on your clipboard.'
    );
    const report = b.told.find((msg) => msg.type === 'post-handoff-report');
    expect(report.report).toContain('Stopped: closed');
    expect(report.report).toContain('Selectors: the page could not be read');
  }, 30000);

  it('stops when the tab leaves X', async () => {
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');

    b.fire({ url: 'https://news.example/' }, { id: 7, url: 'https://news.example/' });
    await heard(b.notes, 'The tab left X, so Azimut stopped after post 1 of 3.');
    expect(b.told.find((msg) => msg.type === 'post-handoff-report').report).toContain('Stopped: left');
  }, 30000);

  it('keeps going while X only changes its own address, and stops when the page loads anew', async () => {
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');

    // the dialog's own address, and back: the reader is still on the page
    b.fire({ url: 'https://x.com/compose/post' }, { id: 7, url: 'https://x.com/compose/post' });
    b.fire({ status: 'complete' }, { id: 7, url: SOURCE });
    await new Promise((r) => setTimeout(r, 100));
    expect(b.notes.filter((note) => /stopped/.test(note))).toEqual([]);

    // a reload: a new document, without the reader or the filled box
    b.tab.listeners = [];
    b.fire({ status: 'complete' }, { id: 7, url: SOURCE });
    await heard(b.notes, 'The page loaded again, so Azimut stopped after post 1 of 3.');
  }, 30000);
});

describe('a thread from Publish', () => {
  it('offers the app the first post\'s link once, and stops following', async () => {
    const b = browser();
    const thread = { url: 'https://x.com/compose/post?text=Geolocated', caseId: 'case-1', draft: 'depot-strike', posts: [POSTS[1]] };
    // the full composer: a dialog on the page it was opened on
    await b.worker.handOff(thread);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector('[data-testid="reply"]').click(); // stands in for X drawing its composer
    const until = Date.now() + 10000;
    while (b.box() !== POSTS[1].text && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    expect(b.box()).toBe(POSTS[1].text);

    const head = b.pressSend();
    await new Promise((r) => setTimeout(r, 400));
    b.pressSend(snowflake(Date.now() + 500));
    await new Promise((r) => setTimeout(r, 400));
    expect(b.told).toEqual([expect.objectContaining({ type: 'post-link-caught', url: `https://x.com/desk/status/${head}` })]);
  }, 30000);

  it('reports where it stopped without a word of the page in it', async () => {
    const b = browser();
    const thread = { url: 'https://x.com/compose/post?text=One', caseId: 'case-1', posts: [POSTS[1], POSTS[2]] };
    await b.worker.handOff(thread);
    await new Promise((r) => setTimeout(r, 50));
    document.querySelector('[data-testid="reply"]').click();
    await heard(b.notes, 'Could not add the next post to the thread.');

    const report = b.told.find((msg) => msg.type === 'post-handoff-report');
    expect(report).toMatchObject({ caseId: 'case-1', draft: null, error: 'Could not add the next post to the thread.' });
    expect(report.report).toContain('Step: add-2');
    expect(report.report).toContain('add 0+0');
    expect(report.report).not.toMatch(/desk|someone|roof|quoted|Répondre|status|https?:|\/\//i);
  }, 30000);
});

describe('what the app hands over', () => {
  it('takes a draft as a short string, or none, and refuses anything else', async () => {
    for (const draft of [7, { slug: 'x' }, 'd'.repeat(201)]) {
      const b = browser();
      await expect(b.worker.handOff({ ...payload, draft })).rejects.toThrow(/draft/);
    }
    for (const draft of [undefined, null, 'depot-strike', 'd'.repeat(200)]) {
      const b = browser();
      await expect(b.worker.handOff({ ...payload, draft })).resolves.toEqual({ ok: true, accepted: true });
    }
  });

  it('takes the reader\'s word only from the tab it follows, for its own hand-off', async () => {
    const b = browser();
    await b.worker.handOff(payload);
    await heard(b.notes, 'Post 1 of 3 is ready');
    const url = `https://x.com/desk/status/${snowflake(Date.now())}`;
    await b.worker.handle({ type: 'post-link-seen', watch: 'not-this-one', url }, { tab: { id: 7, url: SOURCE } });
    await b.worker.handle({ type: 'post-link-seen', watch: 'any', url }, { tab: { id: 9, url: SOURCE } });
    expect(
      await b.worker.handle({ type: 'post-link-seen', watch: 'any', url }, { tab: { id: 21, url: 'http://127.0.0.1:8477/' } })
    ).toMatchObject({ ok: false });
    await new Promise((r) => setTimeout(r, 300));
    expect(b.tab.url).toBe(SOURCE);
    expect(b.told).toEqual([]);
  }, 30000);
});
