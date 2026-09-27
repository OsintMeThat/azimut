// A screen for happy-dom, which has no Fullscreen API: an element asks for it,
// the document says who holds it, and `fullscreenchange` fires as a browser's
// would. `leave()` is Esc, which the page hears about only afterwards.
import { vi } from 'vitest';

export function fakeScreen({ refuse = false } = {}) {
  let holder = null;
  const give = (next) => {
    holder = next;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => holder });
  const request = vi.fn(async function request() {
    if (refuse) throw new TypeError('Permissions check failed');
    give(this);
  });
  const exit = vi.fn(async () => give(null));
  HTMLElement.prototype.requestFullscreen = request;
  document.exitFullscreen = exit;
  return {
    request,
    exit,
    leave: () => give(null),
    restore() {
      delete document.fullscreenElement;
      delete document.exitFullscreen;
      delete HTMLElement.prototype.requestFullscreen;
    },
  };
}
