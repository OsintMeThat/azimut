// @vitest-environment happy-dom
/**
 * Tests for the capture extension's bridge content script (extension/bridge.js).
 *
 * Like extension.test.js next door, the bridge has no exports: the suite stubs
 * `chrome`, evaluates the source against the test document and reads what it
 * posts back.
 *
 * Two things here are easy to get wrong and silent when wrong. The relay spreads
 * the worker's answer next to the message's own correlation id, so a field named
 * `id` on either side breaks every reply pairing. And the bridge is injected
 * twice over — once by the manifest, once by the worker after an update — so an
 * older instance that keeps answering would race the live one.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/bridge.js'), 'utf8');

const CHANNEL = 'azimut-capture-ext';

function makeChrome(sendMessage = vi.fn(async () => ({ ok: true }))) {
  return {
    runtime: {
      id: 'theid',
      getManifest: () => ({ version: '0.3.0' }),
      onMessage: { addListener: vi.fn() },
      sendMessage,
    },
  };
}

/** Evaluate bridge.js against this document. Returns the posted messages. */
function inject(chrome = makeChrome()) {
  const posted = [];
  const spy = vi.spyOn(window, 'postMessage').mockImplementation((data) => {
    posted.push(data);
    // happy-dom does not deliver postMessage the way a browser does, and the
    // bridge only listens to `event.source === window`, so the round trip is
    // driven by hand below.
  });
  new Function('chrome', 'browser', source)(chrome, undefined);
  spy.mockRestore();
  return posted;
}

/** Deliver a page message the way the app's own postMessage would. */
async function fromPage(message, { origin = window.location.origin } = {}) {
  const posted = [];
  const spy = vi.spyOn(window, 'postMessage').mockImplementation((d) => posted.push(d));
  window.dispatchEvent(
    new MessageEvent('message', { data: { channel: CHANNEL, ...message }, origin, source: window })
  );
  await new Promise((r) => setTimeout(r, 0));
  spy.mockRestore();
  return posted;
}

beforeEach(() => {
  document.documentElement.removeAttribute('data-azimut-capture-extension');
  // The generation counter is deliberately *not* reset. happy-dom keeps every
  // listener an earlier test registered, so resetting it would realign those
  // stale instances with the fresh one and they would all answer at once. A real
  // tab has the same requirement for the same reason — the counter only ever
  // goes up — so leaving it alone is what makes this environment behave like one.
});

describe('announcing itself', () => {
  it('stamps the version on <html> and says hello', () => {
    const posted = inject();
    expect(document.documentElement.dataset.azimutCaptureExtension).toBe('0.3.0');
    // The hello is what lets Settings follow an update with no page reload: the
    // app is already mounted and holding a stale version by then.
    expect(posted).toContainEqual({ channel: CHANNEL, type: 'bridge-hello', version: '0.3.0' });
  });

  it('answers a ping with its version', async () => {
    inject();
    const posted = await fromPage({ type: 'ping', id: 'p1' });
    expect(posted).toContainEqual({ channel: CHANNEL, type: 'pong', id: 'p1', version: '0.3.0' });
  });
});

describe('relaying to the worker', () => {
  it('keeps the correlation id when the answer carries fields of its own', async () => {
    // The worker reports the extension id as `extensionId` for exactly this
    // reason: an answer field called `id` would overwrite the one the app is
    // waiting on, and every reply would look unrelated.
    const chrome = makeChrome(
      vi.fn(async () => ({ ok: true, version: '0.3.0', extensionId: 'theid', loaded: null }))
    );
    inject(chrome);
    const posted = await fromPage({ type: 'ext-state', id: 'state-1' });
    expect(posted).toContainEqual({
      channel: CHANNEL,
      type: 'ext-state-result',
      id: 'state-1',
      ok: true,
      version: '0.3.0',
      extensionId: 'theid',
      loaded: null,
    });
  });

  it('passes the named install through, so the wrong copy is not restarted', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true, reloading: true }));
    inject(makeChrome(sendMessage));
    await fromPage({ type: 'ext-reload', id: 'r1', installId: 'abc123' });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'ext-reload', installId: 'abc123' });
  });

  it('carries a reverse-image hand-off to the worker and its answer back', async () => {
    const payload = { url: 'https://lens.google.com/', image: { name: 'a.png', type: 'image/png', data: 'AA' } };
    const sendMessage = vi.fn(async () => ({ ok: true, accepted: true }));
    inject(makeChrome(sendMessage));
    const posted = await fromPage({ type: 'reverse-handoff', id: 'rev-1', payload });
    expect(sendMessage).toHaveBeenCalledWith({ type: 'reverse-handoff', payload });
    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'reverse-handoff-result', id: 'rev-1', ok: true })
    );
  });

  it('reports a dead worker as a refusal rather than hanging', async () => {
    const sendMessage = vi.fn(async () => {
      throw new Error('Extension context invalidated');
    });
    inject(makeChrome(sendMessage));
    const posted = await fromPage({ type: 'capture', id: 'c1' });
    expect(posted).toContainEqual(
      expect.objectContaining({ type: 'capture-result', id: 'c1', ok: false })
    );
  });

  it('ignores a foreign origin, a foreign channel and an unknown type', async () => {
    const sendMessage = vi.fn(async () => ({ ok: true }));
    inject(makeChrome(sendMessage));
    await fromPage({ type: 'capture', id: 'x' }, { origin: 'https://evil.example' });
    expect(sendMessage).not.toHaveBeenCalled();
    const spy = vi.spyOn(window, 'postMessage').mockImplementation(() => {});
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { channel: 'someone-else', type: 'capture', id: 'x' },
        origin: window.location.origin,
        source: window,
      })
    );
    spy.mockRestore();
    await fromPage({ type: 'no-such-relay', id: 'x' });
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('two instances in one tab', () => {
  it('lets the newest injection answer and the older one stand down', async () => {
    const first = vi.fn(async () => ({ ok: true, from: 'first' }));
    const second = vi.fn(async () => ({ ok: true, from: 'second' }));
    inject(makeChrome(first));
    inject(makeChrome(second)); // the worker re-injecting after an update

    const posted = await fromPage({ type: 'capture', id: 'c1' });

    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
    // and exactly one answer goes back, not two racing on the same id
    expect(posted.filter((m) => m.type === 'capture-result')).toHaveLength(1);
  });

  it('stands down once its own context is invalidated', async () => {
    // After the extension reloads, the old content script keeps its listener but
    // `runtime.id` is gone, and every relay from it would throw.
    const orphaned = vi.fn(async () => ({ ok: true }));
    const chrome = makeChrome(orphaned);
    inject(chrome);
    delete chrome.runtime.id;

    const posted = await fromPage({ type: 'capture', id: 'c1' });

    expect(orphaned).not.toHaveBeenCalled();
    expect(posted).toHaveLength(0);
  });
});
