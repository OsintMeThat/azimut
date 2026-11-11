// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  extensionVersion, extensionOutdated, captureTab, handOffPost, handOffReverse, onActivated,
  extensionState, pingExtensions, reloadExtension, onBridgeHello, mapLinkRelay, onSceneProof, sceneHandoff,
  onPairingAsked, onPostLinkCaught, onPostHandoffReport, MAX_REPORT_ERROR, MAX_REPORT_TEXT, MAX_REPORT_FROM,
} from './extBridge.js';

// The bridge protocol is the app's only path to widget pixels, so what these
// tests pin is the contract: detection reads the content script's marker, and
// captureTab resolves/rejects on exactly its own correlated reply — a wrong
// id, a foreign channel, or silence must never produce an image.

afterEach(() => {
  delete document.documentElement.dataset.azimutCaptureExtension;
});

describe('extensionVersion', () => {
  it('is null without the marker and the version with it', () => {
    expect(extensionVersion()).toBe(null);
    document.documentElement.dataset.azimutCaptureExtension = '0.1.0';
    expect(extensionVersion()).toBe('0.1.0');
  });
});

describe('extensionOutdated', () => {
  it('flags a newer bundled version against the installed one', () => {
    expect(extensionOutdated('0.1.0', '0.2.0')).toBe(true);
    expect(extensionOutdated('0.1.0', 'v0.1.1')).toBe(true);
    expect(extensionOutdated('0.1.9', '0.1.10')).toBe(true); // numeric, not lexical
  });
  it('is false when equal, older, or either side is missing', () => {
    expect(extensionOutdated('0.1.0', '0.1.0')).toBe(false);
    expect(extensionOutdated('0.2.0', '0.1.0')).toBe(false);
    expect(extensionOutdated(null, '0.2.0')).toBe(false);
    expect(extensionOutdated('0.1.0', '')).toBe(false);
  });
});

// A fake bridge.js: answers capture requests on the window like the content
// script does. Returns a disposer.
function fakeBridge(answer) {
  const onMessage = (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'azimut-capture-ext' || msg.type !== 'capture') return;
    window.postMessage(
      { channel: 'azimut-capture-ext', type: 'capture-result', id: msg.id, ...answer(msg) },
      window.location.origin
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

describe('captureTab', () => {
  it('resolves with the frame the bridge returns', async () => {
    const off = fakeBridge(() => ({ ok: true, dataUrl: 'data:image/png;base64,AAAA' }));
    await expect(captureTab()).resolves.toBe('data:image/png;base64,AAAA');
    off();
  });

  it('rejects with the bridge error when the browser refused the grab', async () => {
    const off = fakeBridge(() => ({ ok: false, error: 'not the Azimut app' }));
    await expect(captureTab()).rejects.toThrow('not the Azimut app');
    off();
  });

  it('ignores replies with a foreign id and times out instead', async () => {
    // a stale or concurrent reply must not be mistaken for ours
    const off = fakeBridge(() => ({ ok: true, dataUrl: 'data:x', id: 'someone-else' }));
    const offWrong = fakeBridge((msg) => ({ ok: true, dataUrl: 'data:x', id: `${msg.id}-not` }));
    await expect(captureTab({ timeoutMs: 120 })).rejects.toThrow('did not answer');
    off();
    offWrong();
  });

  it('times out when no extension is installed', async () => {
    await expect(captureTab({ timeoutMs: 120 })).rejects.toThrow('did not answer');
  });

  it('marks a refusal that one extension click would fix (activeTab)', async () => {
    // browsers refuse tab screenshots until the extension is invoked once on
    // the tab; the app must be able to say "click the icon" instead of "failed"
    const off = fakeBridge(() => ({ ok: false, needsActivation: true, error: 'activeTab required' }));
    const err = await captureTab().catch((e) => e);
    expect(err.needsActivation).toBe(true);
    off();
  });
});

describe('onPairingAsked', () => {
  it('fires when the pairing popup asks for the token, until unsubscribed', async () => {
    let calls = 0;
    const off = onPairingAsked(() => calls++);
    const ask = (type = 'open-pairing') =>
      new Promise((r) => {
        window.postMessage({ channel: 'azimut-capture-ext', type }, window.location.origin);
        setTimeout(r, 30);
      });
    await ask('activated'); // another word from the extension is not this one
    expect(calls).toBe(0);
    await ask();
    expect(calls).toBe(1);
    off();
    await ask();
    expect(calls).toBe(1);
  });
});

describe('onActivated', () => {
  it('fires when the bridge announces the activation click, until unsubscribed', async () => {
    let calls = 0;
    const off = onActivated(() => calls++);
    const announce = () =>
      new Promise((r) => {
        window.postMessage({ channel: 'azimut-capture-ext', type: 'activated' }, window.location.origin);
        setTimeout(r, 30);
      });
    await announce();
    expect(calls).toBe(1);
    off();
    await announce();
    expect(calls).toBe(1); // unsubscribed — no further calls
  });
});

// The same fake, answering hand-offs. The app's fallback hangs on this reply,
// so what is pinned is that only a correlated `ok` counts as taken.
function fakePostBridge(answer) {
  const onMessage = (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'azimut-capture-ext' || msg.type !== 'post-handoff') return;
    window.postMessage(
      { channel: 'azimut-capture-ext', type: 'post-handoff-result', id: msg.id, ...answer(msg) },
      window.location.origin
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

describe('handOffPost', () => {
  it('resolves as soon as the extension takes it, not when it has finished', async () => {
    // filling is tens of seconds; the answer needed here is only whether the app
    // should stand down, and it is needed while the click can still open a tab
    const off = fakePostBridge(() => ({ ok: true, accepted: true }));
    await expect(handOffPost({ posts: [] })).resolves.toBe(true);
    off();
  });

  it('rejects when the extension declines, so the app opens the page itself', async () => {
    const off = fakePostBridge(() => ({ ok: false, error: 'not enabled for this site' }));
    await expect(handOffPost({ posts: [] })).rejects.toThrow('not enabled for this site');
    off();
  });

  it('rejects on silence, which is what no extension installed looks like', async () => {
    await expect(handOffPost({ posts: [] }, { timeoutMs: 120 })).rejects.toThrow('did not answer');
  });

  it('ignores a reply meant for another request', async () => {
    const off = fakePostBridge((msg) => ({ ok: true, accepted: true, id: `${msg.id}-not` }));
    await expect(handOffPost({ posts: [] }, { timeoutMs: 120 })).rejects.toThrow('did not answer');
    off();
  });
});

// And the same again for a reverse-image hand-off, which is the other thing a
// click can stand down for.
function fakeReverseBridge(answer) {
  const onMessage = (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'azimut-capture-ext' || msg.type !== 'reverse-handoff') return;
    window.postMessage(
      { channel: 'azimut-capture-ext', type: 'reverse-handoff-result', id: msg.id, ...answer(msg) },
      window.location.origin
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

describe('handOffReverse', () => {
  const payload = { url: 'https://lens.google.com/', image: { name: 'a.png', type: 'image/png', data: '' } };

  it('resolves as soon as the extension takes it, tab unopened', async () => {
    const off = fakeReverseBridge(() => ({ ok: true, accepted: true }));
    await expect(handOffReverse(payload)).resolves.toBe(true);
    off();
  });

  it('carries the engine and the image through to the bridge', async () => {
    let seen = null;
    const off = fakeReverseBridge((msg) => {
      seen = msg.payload;
      return { ok: true, accepted: true };
    });
    await handOffReverse(payload);
    expect(seen).toEqual(payload);
    off();
  });

  it('rejects when the extension declines, so the app opens the engine itself', async () => {
    const off = fakeReverseBridge(() => ({ ok: false, error: 'that image is too large to hand over' }));
    await expect(handOffReverse(payload)).rejects.toThrow('too large');
    off();
  });

  it('rejects on silence, which is what no extension installed looks like', async () => {
    await expect(handOffReverse(payload, { timeoutMs: 120 })).rejects.toThrow('did not answer');
  });

  it('ignores a reply meant for another request', async () => {
    const off = fakeReverseBridge((msg) => ({ ok: true, id: `${msg.id}-not` }));
    await expect(handOffReverse(payload, { timeoutMs: 120 })).rejects.toThrow('did not answer');
    off();
  });
});

// A fake bridge for the update routes: same shape as the one above, generalised
// over the request/reply pair so two of them can be mounted at once — which is
// the case that matters, because two copies of the extension can be loaded in
// one tab.
function fakeRelay(requestType, replyType, answer) {
  const onMessage = (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'azimut-capture-ext' || msg.type !== requestType) return;
    window.postMessage(
      { channel: 'azimut-capture-ext', type: replyType, id: msg.id, ...answer(msg) },
      window.location.origin
    );
  };
  window.addEventListener('message', onMessage);
  return () => window.removeEventListener('message', onMessage);
}

const state = (installId, payload, extensionId = 'ext-a') => () => ({
  ok: true,
  version: '0.3.0',
  extensionId,
  loaded: { install_id: installId, payload },
});

describe('extensionState', () => {
  it('collects every copy that answers, not just the first', async () => {
    // Chrome derives the extension id from the folder path, so the analyst who
    // loads the app's copy without removing their old unzip is running two
    // extensions on one channel. Resolving on the first reply would report a
    // coin toss, and the caller could not say which one to remove.
    const mine = fakeRelay('ext-state', 'ext-state-result', state('mine', 'digest', 'ext-a'));
    const theirs = fakeRelay('ext-state', 'ext-state-result', () => ({
      ok: true, version: '0.2.0', extensionId: 'ext-b', loaded: null,
    }));

    const found = await extensionState({ timeoutMs: 80 });

    expect(found).toHaveLength(2);
    expect(found.map((r) => r.extensionId).sort()).toEqual(['ext-a', 'ext-b']);
    expect(found.find((r) => r.extensionId === 'ext-a').loaded.install_id).toBe('mine');
    mine();
    theirs();
  });

  it('resolves empty when nothing answers, because that is an answer', async () => {
    // not installed, or too old to know this message: neither is a failure
    await expect(extensionState({ timeoutMs: 60 })).resolves.toEqual([]);
  });

  it('ignores a reply correlated to someone else', async () => {
    const off = fakeRelay('ext-state', 'ext-state-result', (msg) => ({
      ok: true, version: '0.3.0', extensionId: 'ext-a', loaded: null, id: `${msg.id}-not`,
    }));
    await expect(extensionState({ timeoutMs: 60 })).resolves.toEqual([]);
    off();
  });

  it('says whether this tab is the address the copy is paired with', async () => {
    const off = fakeRelay('ext-state', 'ext-state-result', () => ({
      ok: true, version: '0.3.1', extensionId: 'ext-a', loaded: null, paired: false,
    }));
    const [found] = await extensionState({ timeoutMs: 60 });
    expect(found.paired).toBe(false);
    off();
  });

  it('drops a copy that refused', async () => {
    const off = fakeRelay('ext-state', 'ext-state-result', () => ({ ok: false, error: 'nope' }));
    await expect(extensionState({ timeoutMs: 60 })).resolves.toEqual([]);
    off();
  });
});

describe('reloadExtension', () => {
  it('names the install it means, so another copy stays put', async () => {
    let asked = null;
    const off = fakeRelay('ext-reload', 'ext-reload-result', (msg) => {
      asked = msg.installId;
      return { ok: true, reloading: true };
    });
    await expect(reloadExtension('mine')).resolves.toBe(true);
    expect(asked).toBe('mine');
    off();
  });

  it('rejects when the copy that answers is not the one named', async () => {
    const off = fakeRelay('ext-reload', 'ext-reload-result', () => ({
      ok: false, error: 'another copy of the extension',
    }));
    await expect(reloadExtension('mine')).rejects.toThrow('another copy');
    off();
  });

  it('rejects on silence, which the caller treats as inconclusive', async () => {
    // The extension dies mid-reply by design, so a timeout here says nothing
    // about whether the update landed — Settings verifies by probing after.
    await expect(reloadExtension('mine', { timeoutMs: 60 })).rejects.toThrow('did not answer');
  });
});

describe('onBridgeHello', () => {
  it('fires with the version a freshly injected bridge announces', async () => {
    const seen = [];
    const off = onBridgeHello((v) => seen.push(v));
    window.postMessage(
      { channel: 'azimut-capture-ext', type: 'bridge-hello', version: '0.4.0' },
      window.location.origin
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['0.4.0']);
    off();
    window.postMessage(
      { channel: 'azimut-capture-ext', type: 'bridge-hello', version: '0.5.0' },
      window.location.origin
    );
    await new Promise((r) => setTimeout(r, 10));
    expect(seen).toEqual(['0.4.0']);
  });
});

describe('pingExtensions', () => {
  it('counts a copy too old to answer anything newer', async () => {
    // `ping` is the only message every shipped version has ever answered. An
    // extension installed before the update button knows nothing of `ext-state`,
    // so detection that asked only that reported it as absent — the bug this
    // pins. Here the old bridge answers ping and stays silent on the rest.
    const oldBridge = fakeRelay('ping', 'pong', () => ({ version: '0.2.0' }));

    const [bridges, managed] = await Promise.all([
      pingExtensions({ timeoutMs: 80 }),
      extensionState({ timeoutMs: 80 }),
    ]);

    expect(bridges).toEqual([{ version: '0.2.0' }]);
    expect(managed).toEqual([]);
    oldBridge();
  });

  it('counts both copies when two are loaded', async () => {
    const a = fakeRelay('ping', 'pong', () => ({ version: '0.3.0' }));
    const b = fakeRelay('ping', 'pong', () => ({ version: '0.2.0' }));
    await expect(pingExtensions({ timeoutMs: 80 })).resolves.toHaveLength(2);
    a();
    b();
  });

  it('resolves empty on silence, and ignores a reply meant for someone else', async () => {
    await expect(pingExtensions({ timeoutMs: 60 })).resolves.toEqual([]);
    const off = fakeRelay('ping', 'pong', (msg) => ({ version: '0.3.0', id: `${msg.id}-not` }));
    await expect(pingExtensions({ timeoutMs: 60 })).resolves.toEqual([]);
    off();
  });
});

describe('mapLinkRelay', () => {
  // The app's map tab on the extension's linked views: panels on other sites
  // hand their cameras over it. Two message types, because the page hears its
  // own postMessage and must never take the camera it sent for one it was handed.
  const wait = () => new Promise((r) => setTimeout(r, 10));
  const fromBridge = (message) =>
    window.postMessage({ channel: 'azimut-capture-ext', ...message }, window.location.origin);

  function watchPage() {
    const posted = [];
    const onMessage = (event) => {
      if (event.data?.type === 'map-link') posted.push(event.data);
    };
    window.addEventListener('message', onMessage);
    return { posted, stop: () => window.removeEventListener('message', onMessage) };
  }

  it('is nothing without the extension', () => {
    expect(mapLinkRelay()).toBe(null);
  });

  it('asks the bridge to open the link, and hands it this tab’s camera', async () => {
    document.documentElement.dataset.azimutCaptureExtension = '0.3.0';
    const page = watchPage();
    const relay = mapLinkRelay();
    relay.listen({ view() {}, peers() {} });
    relay.send({ lat: 1, lon: 2, zoom: 3, bearing: 0 });
    await wait();
    expect(page.posted.map((m) => m.kind)).toEqual(['open', 'view']);
    expect(page.posted[1].view).toEqual({ lat: 1, lon: 2, zoom: 3, bearing: 0 });
    relay.close();
    page.stop();
  });

  it('hears panels’ cameras and their count, never its own camera', async () => {
    document.documentElement.dataset.azimutCaptureExtension = '0.3.0';
    const views = [];
    const counts = [];
    const relay = mapLinkRelay();
    relay.listen({ view: (v) => views.push(v), peers: (n) => counts.push(n) });
    relay.send({ lat: 9, lon: 9, zoom: 9 });
    fromBridge({ type: 'map-link-event', kind: 'view', view: { lat: 1, lon: 2, zoom: 3 } });
    fromBridge({ type: 'map-link-event', kind: 'peers', count: 2 });
    await wait();
    expect(views).toEqual([{ lat: 1, lon: 2, zoom: 3 }]);
    expect(counts).toEqual([2]);
    relay.close();
  });

  it('opens the link again when a restarted extension brings a new bridge', async () => {
    document.documentElement.dataset.azimutCaptureExtension = '0.3.0';
    const relay = mapLinkRelay();
    relay.listen({ view() {}, peers() {} });
    await wait();
    const page = watchPage();
    fromBridge({ type: 'bridge-hello', version: '0.3.1' });
    await wait();
    expect(page.posted.map((m) => m.kind)).toEqual(['open']);
    relay.close();
    page.stop();
  });

  it('says goodbye and stops listening when the map closes', async () => {
    document.documentElement.dataset.azimutCaptureExtension = '0.3.0';
    const views = [];
    const page = watchPage();
    const relay = mapLinkRelay();
    relay.listen({ view: (v) => views.push(v), peers() {} });
    relay.close();
    fromBridge({ type: 'map-link-event', kind: 'view', view: { lat: 1, lon: 2, zoom: 3 } });
    await wait();
    expect(views).toEqual([]);
    expect(page.posted.at(-1).kind).toBe('close');
    page.stop();
  });
});

describe('onSceneProof', () => {
  const SCENE = { caseId: 'case-1', video: 'media/walk.mp4', draft: 'sc_2', id: 'h-1' };

  /** What the bridge would post, and the answer the page posts back to it. */
  function handed(message, { origin = window.location.origin } = {}) {
    return new Promise((resolve) => {
      const answers = [];
      const onMessage = (event) => {
        if (event.data?.type === 'scene-proof-result') answers.push(event.data);
      };
      window.addEventListener('message', onMessage);
      window.dispatchEvent(new MessageEvent('message', { data: { channel: 'azimut-capture-ext', ...message }, origin }));
      setTimeout(() => {
        window.removeEventListener('message', onMessage);
        resolve(answers);
      }, 30);
    });
  }

  it('gives the scene to the tab and the tab’s answer back, under the bridge’s id', async () => {
    const taken = [];
    const off = onSceneProof((scene) => {
      taken.push(scene);
      return { ok: true };
    });
    const answers = await handed({ type: 'scene-proof', id: 'scene-1-1', scene: SCENE });
    off();
    expect(taken).toEqual([SCENE]);
    expect(answers).toEqual([{ channel: 'azimut-capture-ext', type: 'scene-proof-result', id: 'scene-1-1', ok: true }]);
  });

  it('refuses what is not a scene, and keeps the bridge’s id over anything the answer carries', async () => {
    const taken = [];
    const off = onSceneProof((scene) => {
      taken.push(scene);
      return { ok: false, refused: true, error: 'a map window of Azimut makes no proof', id: 'not-this' };
    });
    const bad = await handed({ type: 'scene-proof', id: 'a', scene: { ...SCENE, draft: '' } });
    const refused = await handed({ type: 'scene-proof', id: 'b', scene: SCENE });
    off();
    expect(taken).toEqual([SCENE]);
    expect(bad[0]).toMatchObject({ id: 'a', ok: false, refused: true, error: 'not a scene to prove' });
    expect(refused[0]).toMatchObject({ id: 'b', ok: false, refused: true, error: 'a map window of Azimut makes no proof' });
  });

  it('hears nothing from another origin, nor once unsubscribed', async () => {
    let taken = 0;
    const off = onSceneProof(() => {
      taken += 1;
    });
    expect(await handed({ type: 'scene-proof', id: 'x', scene: SCENE }, { origin: 'https://evil.example' })).toEqual([]);
    off();
    expect(await handed({ type: 'scene-proof', id: 'y', scene: SCENE })).toEqual([]);
    expect(taken).toBe(0);
  });

  it('reads a hand-off strictly: strings of a sane length, the hand-off’s own id kept', () => {
    expect(sceneHandoff(SCENE)).toEqual(SCENE);
    expect(sceneHandoff({ ...SCENE, id: 4 })).toEqual({ caseId: 'case-1', video: 'media/walk.mp4', draft: 'sc_2' });
    for (const scene of [null, 'x', { ...SCENE, caseId: null }, { ...SCENE, video: 'v'.repeat(1025) }, { ...SCENE, draft: {} }]) {
      expect(sceneHandoff(scene)).toBe(null);
    }
  });
});

// What the extension's bridge posts about a thread it handed out: forged here, each the
// way a page or another extension could post it, so only the bridge's own shape passes.
function forged(message, { origin = window.location.origin, channel = 'azimut-capture-ext' } = {}) {
  window.dispatchEvent(new MessageEvent('message', { data: { channel, ...message }, origin }));
}

describe('onPostLinkCaught', () => {
  const CAUGHT = {
    type: 'post-link-caught', caseId: 'case-1', draft: 'Post 38',
    url: 'https://x.com/desk/status/1850000000000000009', site: 'x', at: '2026-11-11T09:00:00Z',
  };
  let heard;
  let off;
  afterEach(() => off?.());
  const listen = () => {
    heard = [];
    off = onPostLinkCaught((link) => heard.push(link));
  };

  it('passes on a post\'s link, written the one way, with the case and the draft it names', () => {
    listen();
    forged(CAUGHT);
    forged({ ...CAUGHT, url: 'https://twitter.com/desk/status/1850000000000000009?s=20' });
    forged({ ...CAUGHT, url: 'https://bsky.app/profile/desk.bsky.social/post/3kabc', site: 'bluesky', at: 1762851600000 });
    expect(heard).toEqual([
      { caseId: 'case-1', draft: 'Post 38', url: CAUGHT.url, site: 'x', at: CAUGHT.at },
      { caseId: 'case-1', draft: 'Post 38', url: CAUGHT.url, site: 'x', at: CAUGHT.at },
      { caseId: 'case-1', draft: 'Post 38', url: 'https://bsky.app/profile/desk.bsky.social/post/3kabc', site: 'bluesky', at: 1762851600000 },
    ]);
  });

  it('hears nothing from another origin, another channel, or once unsubscribed', () => {
    listen();
    forged(CAUGHT, { origin: 'https://evil.example' });
    forged(CAUGHT, { channel: 'someone-else' });
    off();
    forged(CAUGHT);
    expect(heard).toEqual([]);
  });

  it('drops a message of the wrong shape, and a link that is no post', () => {
    listen();
    for (const bad of [
      { url: 'https://example.com/desk/status/1' },
      { url: 'https://x.com/desk' },
      { url: 'javascript:alert(1)' },
      { url: 42 },
      { url: `https://x.com/desk/status/1?${'a'.repeat(400)}` },
      { site: 'bluesky' },
      { site: 'mastodon' },
      { caseId: '' },
      { caseId: 7 },
      { draft: null },
      { draft: 'd'.repeat(201) },
      { type: 'post-link' },
    ]) forged({ ...CAUGHT, ...bad });
    expect(heard).toEqual([]);
  });
});

describe('onPostHandoffReport', () => {
  const REPORT = { type: 'post-handoff-report', caseId: 'case-1', draft: 'Post 38', error: 'The composer did not open.', report: 'tab 3: no composer after 20 s' };
  let heard;
  let off;
  afterEach(() => off?.());
  const listen = () => {
    heard = [];
    off = onPostHandoffReport((report) => heard.push(report));
  };

  it('passes on the sentence and the report, each cut to its bound', () => {
    listen();
    forged(REPORT);
    forged({ ...REPORT, error: 'e'.repeat(MAX_REPORT_ERROR + 50), report: 'r'.repeat(MAX_REPORT_TEXT + 50), draft: undefined });
    expect(heard[0]).toEqual({ caseId: 'case-1', draft: 'Post 38', error: REPORT.error, report: REPORT.report, from: null });
    expect(heard[1].error).toHaveLength(MAX_REPORT_ERROR);
    expect(heard[1].error.endsWith('…')).toBe(true);
    expect(heard[1].report).toHaveLength(MAX_REPORT_TEXT);
    expect(heard[1].draft).toBeNull();
  });

  it('passes on the post the rest starts from, a whole number in bounds, and nothing else', () => {
    listen();
    forged({ ...REPORT, from: 2 });
    forged({ ...REPORT, from: MAX_REPORT_FROM });
    for (const bad of [0, -1, 1.5, '2', MAX_REPORT_FROM + 1, null, true, Number.NaN, { n: 2 }]) forged({ ...REPORT, from: bad });
    expect(heard.map((report) => report.from)).toEqual([2, MAX_REPORT_FROM, ...Array(9).fill(null)]);
    // a report with a bad number still says what went wrong
    expect(heard.at(-1).error).toBe(REPORT.error);
  });

  it('hears nothing from another origin or channel, nor a report of the wrong shape', () => {
    listen();
    forged(REPORT, { origin: 'https://evil.example' });
    forged(REPORT, { channel: 'someone-else' });
    for (const bad of [{ error: '' }, { error: '  ' }, { error: 3 }, { report: { text: 'x' } }, { caseId: null }]) forged({ ...REPORT, ...bad });
    expect(heard).toEqual([]);
  });
});
