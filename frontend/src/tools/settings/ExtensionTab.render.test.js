// @vitest-environment happy-dom
/**
 * The Capture extension section, actually mounted.
 *
 * Azimut takes the next free port when another program holds its own, and an
 * extension paired with the old address then refuses to capture or post for it.
 * The section has to say so, and name the address to set.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import ExtensionTab from './ExtensionTab.svelte';
import { classify } from '../../lib/extInstall.js';

let target;
let app;

function open(answer) {
  target = document.createElement('div');
  document.body.append(target);
  const server = {
    path: '/home/a/Azimut/.azimut/extension',
    bundled: { version: '0.3.1', payload: 'p' },
    folder: { install_id: 'mine', version: '0.3.1', payload: 'p' },
  };
  const copy = { version: '0.3.1', extensionId: 'ext-a', loaded: { install_id: 'mine', payload: 'p' }, ...answer };
  app = mount(ExtensionTab, {
    target,
    props: {
      badges: {},
      extDetected: '0.3.1',
      extOutdated: false,
      extState: classify(server, { bridges: [{ version: '0.3.1' }], managed: [copy] }),
      extBundled: '0.3.1',
      extBusy: null,
      installExtension: vi.fn(),
      updateExtension: vi.fn(),
      copyExtensionPath: vi.fn(),
      revealExtension: vi.fn(),
      ingestToken: '',
      copyToken: vi.fn(),
      ensureToken: vi.fn(),
      rotateToken: vi.fn(),
      tokenShown: false,
    },
  });
  flushSync();
}

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
});

describe('ExtensionTab', () => {
  it('names the address to set when the extension is paired with another one', () => {
    open({ paired: false });
    const note = [...target.querySelectorAll('.note.warn')].find((p) => p.textContent.includes('paired with another address'));
    expect(note).toBeTruthy();
    expect(note.textContent).toContain(location.origin);
  });

  it('says nothing about pairing when this is the paired address', () => {
    open({ paired: true });
    expect(target.textContent).not.toContain('paired with another address');
  });
});
