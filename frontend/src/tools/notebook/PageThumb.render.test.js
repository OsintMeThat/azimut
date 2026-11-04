// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { templateThumb } = vi.hoisted(() => ({ templateThumb: vi.fn(async () => 'data:image/png;base64,AAAA') }));
vi.mock('../../lib/notes/thumbs.js', () => ({ templateThumb }));

/** Says a picture is in view only when a test does. */
class Watch {
  static last = null;
  constructor(callback) { this.callback = callback; Watch.last = this; }
  observe(node) { this.node = node; }
  disconnect() {}
  show() { this.callback([{ target: this.node, isIntersecting: true }]); }
}
vi.stubGlobal('IntersectionObserver', Watch);

const { default: PageThumb } = await import('./PageThumb.svelte');

let app;
let target;
afterEach(() => {
  unmount(app);
  target.remove();
  vi.clearAllMocks();
});

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
  flushSync();
}

describe('page 1 of a template', () => {
  it('is drawn only once its tile comes into view', async () => {
    target = document.createElement('div');
    document.body.append(target);
    app = mount(PageThumb, { target, props: { name: 'Brief', body: '## A', look: { style: 'brief' } } });
    await settle();
    expect(templateThumb).not.toHaveBeenCalled();
    expect(target.querySelector('img')).toBeNull();
    Watch.last.show();
    await settle();
    expect(templateThumb).toHaveBeenCalledWith({ name: 'Brief', body: '## A', look: { style: 'brief' } });
    expect(target.querySelector('img').getAttribute('src')).toBe('data:image/png;base64,AAAA');
  });

  it('keeps a blank sheet when it cannot be drawn', async () => {
    templateThumb.mockRejectedValueOnce(new Error('not running'));
    target = document.createElement('div');
    document.body.append(target);
    app = mount(PageThumb, { target, props: { name: 'X', body: '' } });
    await settle();
    Watch.last.show();
    await settle();
    expect(target.querySelector('.thumb.failed')).not.toBeNull();
    expect(target.querySelector('img')).toBeNull();
  });
});
