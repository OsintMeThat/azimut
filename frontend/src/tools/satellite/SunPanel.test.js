import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('./SunPanel.svelte', import.meta.url), 'utf8');

describe('Sun & moon panel', () => {
  it('is placed by the rail\'s panel slot rather than placing itself', () => {
    // it used to carry its own corner, and a `top: 46px` that dodged a
    // coordinates readout floating above it; both belong to the slot now
    expect(panel).not.toContain('position: absolute');
    expect(panel).not.toContain('left: calc(100% + 8px)');
  });

  it('can be dragged out of the way of the imagery it describes', () => {
    // the panel covers the very picture being read, so it has to move
    expect(panel).toContain('onpointerdown={startDrag}');
    expect(panel).toContain('setPointerCapture(event.pointerId)');
    expect(panel).toContain('style="transform: translate({offset.x}px, {offset.y}px)"');
  });

  it('drags from the grip only, leaving the date and the slider their own pointer', () => {
    expect(panel).toContain('class="grip"');
    expect(panel).not.toContain('<div class="line" onpointerdown');
  });

  it('cannot be dragged off the map', () => {
    expect(panel).toContain("panelEl?.closest('.map-wrap')");
    expect(panel).toContain('map.right - 8 - box.width - restX');
    expect(panel).toContain('map.bottom - 8 - box.height - restY');
  });

  it('reads the hour out of the day already fetched', () => {
    expect(panel).toContain('curve?.clock?.[index]');
    expect(panel).toContain('max={last}');
    expect(panel).toContain('oninput={(e) => onindex(Number(e.currentTarget.value))}');
  });

  it('names both bodies and marks one that is below the horizon', () => {
    expect(panel).toContain("label: 'Sun'");
    expect(panel).toContain("label: 'Moon'");
    expect(panel).toContain('{#if body.altitude < 0}<span class="down">down</span>{/if}');
  });

  it('shows the moon at its phase, and says the anchor does not follow the view', () => {
    expect(panel).toContain("import MoonGlyph from '../../components/MoonGlyph.svelte'");
    expect(panel).toContain('panning the map leaves it alone');
    expect(panel).toContain("{placing ? 'Click the map' : 'Move'}");
  });
});
