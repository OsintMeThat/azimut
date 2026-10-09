import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The tab mounts a WebGL view and a MapLibre map, neither of which runs under a
// test DOM; its layout's own rules are read off the source, as Satellite's are.
const source = readFileSync(new URL('./Horizon.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'), source.indexOf('<style>'));
const style = source.slice(source.indexOf('<style>'));

describe('the Horizon layout', () => {
  it('heads the view with the eye’s coordinates alone, the words kept for a screen reader', () => {
    const heading = markup.slice(markup.indexOf('<h2 class="hz-title"'), markup.indexOf('</h2>'));
    expect(heading).toContain('aria-label="View from {title}"');
    expect(heading.replace(/aria-label="[^"]*"/, '')).not.toContain('View from');
  });

  it('lays the whole-turn strip under the view, by its heading ruler', () => {
    expect(markup.indexOf('<HorizonStrip')).toBeGreaterThan(markup.indexOf('<HorizonView'));
    expect(markup.indexOf('<HorizonStrip')).toBeGreaterThan(markup.indexOf('<OverlayTransport'));
  });

  it('lets the inspector be dragged wider, and sizes every box beside it from that width', () => {
    expect(markup).toContain('onpointerdown={startSideResize}');
    expect(markup).toContain('ondblclick={resetSideWidth}');
    expect(markup).toContain('onkeydown={onSideResizeKey}');
    expect(markup).toContain('style:--hz-side="{sideW}px"');
    expect(markup).toContain('style:--hz-map-h="{mapH}px"');
    // the map, the corner view and the grid all follow it: a width left fixed would part them
    expect(style).not.toMatch(/\b340px\b/);
    expect(style).not.toMatch(/\b250px\b/);
  });
});
