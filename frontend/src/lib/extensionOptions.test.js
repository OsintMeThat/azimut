// @vitest-environment happy-dom
/**
 * Tests for the capture extension's options page (extension/options.js).
 *
 * Like extension.test.js and extensionPopup.test.js next door, the page has no
 * exports: the suite loads options.html into the document, stubs `chrome` and
 * `fetch`, evaluates the source and reads the resulting DOM.
 *
 * What is worth pinning here is the state only the signed Firefox add-on can
 * reach. Everywhere else the extension is handed out of the app and cannot lead
 * it; Firefox updates a signed add-on from the release manifest without knowing
 * which Azimut sits beside it, so an old app can end up paired with a newer
 * add-on. Nothing in a browser can refuse that update, which is exactly why it
 * has to be named where both numbers are already on screen.
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const ext = join(here, '../../../extension');
const source = readFileSync(join(ext, 'options.js'), 'utf8');
const html = readFileSync(join(ext, 'options.html'), 'utf8');

const settle = () => new Promise((r) => setTimeout(r, 0));

/** Evaluate the page, press Save & test, and hand back the status line. */
async function pair({ appVersion, addonVersion }) {
  document.body.innerHTML = html
    .replace(/[\s\S]*<body[^>]*>/, '')
    .replace(/<\/body>[\s\S]*/, '')
    .replace(/<script[\s\S]*?<\/script>/g, '');

  const chrome = {
    storage: {
      local: { get: vi.fn(async (defaults) => ({ ...defaults })), set: vi.fn() },
    },
    runtime: { getManifest: () => ({ version: addonVersion }) },
  };
  const fetchImpl = vi.fn(async () => ({
    status: 200,
    json: async () => ({ app: 'azimut', version: appVersion }),
  }));

  new Function('chrome', 'browser', 'fetch', source)(chrome, undefined, fetchImpl);
  await settle(); // init() awaits storage before it wires the button
  document.getElementById('save').click();
  await settle();
  return document.getElementById('status');
}

describe('options: pairing', () => {
  it('reports a plain pairing when the app is current', async () => {
    const status = await pair({ appVersion: '0.4.0', addonVersion: '0.4.0' });
    expect(status.className).toContain('ok');
    expect(status.textContent).toBe('Paired with Azimut 0.4.0.');
  });

  it('says nothing special when the app leads the add-on', async () => {
    // The ordinary case everywhere but Firefox: the extension comes out of the
    // app, so it trails whenever a release left it alone.
    const status = await pair({ appVersion: '0.4.0', addonVersion: '0.3.0' });
    expect(status.className).toContain('ok');
  });

  it('warns when the add-on has been updated past the app', async () => {
    const status = await pair({ appVersion: '0.3.0', addonVersion: '0.4.0' });
    expect(status.className).toContain('warn');
    expect(status.textContent).toContain('0.3.0');
    expect(status.textContent).toContain('0.4.0');
    expect(status.textContent).toContain('Update Azimut');
  });

  it('compares versions numerically rather than as text', async () => {
    // 0.10.0 is above 0.9.0, and a lexical compare reads it the other way — which
    // would stay silent on the one release where the warning matters most.
    const ahead = await pair({ appVersion: '0.9.0', addonVersion: '0.10.0' });
    expect(ahead.className).toContain('warn');
    const behind = await pair({ appVersion: '0.10.0', addonVersion: '0.9.0' });
    expect(behind.className).toContain('ok');
  });
});
