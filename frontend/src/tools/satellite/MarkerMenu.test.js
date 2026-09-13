import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import { readFileSync } from 'node:fs';
import MarkerMenu from './MarkerMenu.svelte';
import { paths } from '../../components/Icon.svelte';

const source = readFileSync(new URL('./MarkerMenu.svelte', import.meta.url), 'utf8');

const props = (over = {}) => ({ style: 'crosshair', free: false, toggleFree: vi.fn(), ...over });

describe('the point the map is reading', () => {
  it('costs the strip one square at rest', () => {
    const { body } = render(MarkerMenu, { props: props() });
    // the two acts beside it are pressed all day; this is set and forgotten, so
    // the answers live behind the square rather than lying across the bar
    expect(body).toContain('aria-label="Marker"');
    expect(body).not.toContain('Crosshair');
    expect(body).not.toContain('Dropped');
  });

  it('wears what is marking the point', () => {
    const { body } = render(MarkerMenu, { props: props({ style: 'pin' }) });
    expect(body).toContain('aria-expanded="false"');
    // no marker is the crosshair's ring struck through, not an abstract glyph
    expect(source).toContain("{ id: 'none', label: 'None', icon: 'noMark' }");
    expect(body).not.toContain(paths.crosshair);
    expect(body).toContain(paths.pin);
  });

  it('says a dropped pin is armed without opening anything', () => {
    const { body } = render(MarkerMenu, { props: props({ free: true }) });
    expect(body).toMatch(/class="btn btn-icon marker-button[^"]* on"/);
  });

  it('answers each question with icon tiles, one of them checked', () => {
    // each choice is a picture first and a word under it
    expect(source).toContain('<Icon name={entry.icon} size={18} />');
    expect(source).toContain('<Icon name="centre" size={18} />');
    expect(source).toContain('<Icon name="move" size={18} />');
    expect(source.match(/role="radiogroup"/g)).toHaveLength(2);
    expect(source).toContain('aria-checked={style === entry.id}');
    expect(source).not.toContain('class="chip"');
    for (const name of ['noMark', 'centre', 'move', 'crosshair', 'pin']) expect(paths[name]).toBeTruthy();
    expect(paths.ghost).toBeUndefined();
  });

  it('opens upwards, because it sits at the foot of the map', () => {
    expect(source).toContain('bottom: calc(100% + 8px)');
  });

  it('closes on a click anywhere else, like the capture menu beside it', () => {
    expect(source).toContain("document.addEventListener('mousedown', onDown, true)");
    expect(source).toContain('if (wrap && !wrap.contains(e.target)) open = false');
  });

  it('offers no pin to drop when nothing marks the point', () => {
    expect(source).toContain("disabled={style === 'none'}");
    expect(source).toContain("title={style === 'none' ? 'Pick a marker first'");
  });

  it('asks the host to move the pin rather than moving it itself', () => {
    // the pin is a mark on a surface the tool owns (`createSurface`), and the
    // coordinates that follow it are what a capture files
    expect(source).toContain('onclick={() => !free && toggleFree()}');
    expect(source).toContain('onclick={() => free && toggleFree()}');
  });
});
