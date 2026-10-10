import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// The tab mounts a WebGL view and a MapLibre map, neither of which runs under a
// test DOM; its layout's own rules are read off the source, as Satellite's are.
const source = readFileSync(new URL('./Horizon.svelte', import.meta.url), 'utf8');
const markup = source.slice(source.indexOf('</script>'), source.indexOf('<style>'));
const style = source.slice(source.indexOf('<style>'));

describe('the Horizon layout', () => {
  it('heads the view with its name, offered from the photo or the place, where it stands in the tooltip', () => {
    const heading = markup.slice(markup.indexOf('<div class="hz-title">'), markup.indexOf('<span class="hz-status"'));
    expect(heading).toContain('bind:value={viewTitle}');
    expect(heading).toContain('placeholder={views.suggested}');
    expect(heading).toContain('aria-label="View name"');
    expect(heading).toContain('stands at {title}');
    // a changed saved view says so with a dot, not a word
    expect(heading).toContain('class="hz-unsaved"');
  });

  it('keeps the view\'s acts to three plain buttons, Open there as soon as a case is, eye or no eye', () => {
    const header = markup.slice(markup.indexOf('<header'), markup.indexOf('</header>'));
    expect(header.match(/<ViewsMenu/g)).toHaveLength(1);
    expect(header).toContain("{#if caseState.current && layout !== 'moving'}");
    expect(header).toContain('<ExportMenu');
    expect(header).toContain('aria-label="Save the view"');
    expect(header).toContain('onclick={saveView}');
  });

  it('closes the view back to the map, asking first when unsaved work would go', () => {
    expect(markup).toContain('onclick={closeView}');
    expect(source).toMatch(/function closeView\(\) \{\s*if \(keepsWork\(\)\) \{\s*discarding = \{ close: true \};/);
    expect(source).toMatch(/function leaveView\(\) \{[^}]*overlay\.remove\(\);[^}]*view\.leave\(\);/s);
  });

  it('offers to move where the other maps look, on the map, and never follows them by itself', () => {
    expect(markup).toContain('{#if away && layout === \'looking\'}');
    expect(markup).toContain('onclick={moveThere}');
    expect(source).toContain("share.stood({ lat: eye.lat, lon: eye.lon, heading }");
    // the map follows the others only while no eye stands
    expect(source).toMatch(/layout !== 'picking'\) return;\s*untrack\(\(\) => \{\s*const next = share\.pending/);
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
