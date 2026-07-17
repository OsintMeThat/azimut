// @vitest-environment happy-dom
import { describe, it, expect, afterEach } from 'vitest';
import { extensionVersion, captureTab, onActivated } from './extBridge.js';

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
