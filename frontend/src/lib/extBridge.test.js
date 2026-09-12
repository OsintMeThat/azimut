// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import {
  extensionVersion, extensionOutdated, captureTab, handOffPost, handOffReverse, onActivated,
  extensionState, pingExtensions, reloadExtension, onBridgeHello,
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
