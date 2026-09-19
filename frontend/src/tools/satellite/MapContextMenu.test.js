import { describe, expect, it, vi } from 'vitest';
import { render } from 'svelte/server';
import MapContextMenu from './MapContextMenu.svelte';
import { actionsFor } from '../../lib/map/contextMenu.js';

function props(overrides = {}) {
  return {
    at: { lat: 50.4501, lon: 30.5234, x: 120, y: 80 },
    frame: { width: 1000, height: 700 },
    zoom: 17,
    format: 'dd',
    fullscreen: false,
    lookup: null,
    onpick: vi.fn(),
    onclose: vi.fn(),
    ...overrides,
  };
}

describe('the right-click menu', () => {
  it('is a menu of the point clicked, placed where it was clicked', () => {
    const { body } = render(MapContextMenu, { props: props() });
    expect(body).toContain('role="menu"');
    expect(body).toContain('left: 120px');
    expect(body).toContain('top: 80px');
    expect(body).toMatch(/50\.4501/);
  });

  it('offers the point in every format and every act on it', () => {
    const { body } = render(MapContextMenu, { props: props() });
    for (const text of [
      'DD',
      'DMS',
      'MGRS',
      'What is here?',
      'Save place here…',
      'Measure from here',
      'Sun and moon from here',
      'Imagery history here',
      'Centre the map here',
      'Open in…',
    ]) {
      expect(body).toContain(text);
    }
  });

  it('keeps the links folded until asked, so the menu opens short', () => {
    const { body } = render(MapContextMenu, { props: props() });
    expect(body).not.toContain('Google Earth');
  });

  it('says the links are a submenu, not a fold, so the menu cannot change size', () => {
    // opening them used to grow the menu, which a menu already placed against
    // the frame's edge answered by moving out from under the cursor
    const { body } = render(MapContextMenu, { props: props() });

    expect(body).toContain('aria-haspopup="menu"');
    expect(body).not.toContain('chevronDown');
  });

  it('offers a pair only where an archive can build one', () => {
    const sources = [
      { id: 'wayback', label: 'Esri Wayback', detail: 'the last two pictures of this point' },
      { id: 'sentinel', label: 'Copernicus', detail: 'the last two passes over this point', provider: 'sentinel2' },
    ];
    expect(render(MapContextMenu, { props: props() }).body).not.toContain('Compare here…');
    const { body } = render(MapContextMenu, { props: props({ compareSources: sources }) });
    expect(body).toContain('Compare here…');
    // folded like the links, for the same reason: the menu cannot change size
    expect(body).not.toContain('Esri Wayback');
    expect(body.match(/aria-haspopup="menu"/g)).toHaveLength(2);
  });

  it('states the lookup where it was asked, while it runs and once it answered', () => {
    expect(
      render(MapContextMenu, { props: props({ lookup: { busy: true } }) }).body
    ).toContain('Looking it up…');
    expect(
      render(MapContextMenu, { props: props({ lookup: { text: 'Maidan Nezalezhnosti, Kyiv' } }) }).body
    ).toContain('Maidan Nezalezhnosti, Kyiv');
    expect(
      render(MapContextMenu, { props: props({ lookup: { error: 'Lookup failed: offline' } }) }).body
    ).toContain('Lookup failed: offline');
  });

  it('shows only the acts the tool passed, never a row that would do nothing', () => {
    const { body } = render(MapContextMenu, {
      props: props({ actions: actionsFor(['lookup', 'place', 'measure']) }),
    });
    expect(body).toContain('Measure from here');
    expect(body).not.toContain('Sun and moon from here');
    expect(body).not.toContain('Imagery history here');
    expect(body).not.toContain('Centre the map here');
    // The point is still copyable and still opens elsewhere: those are not acts.
    expect(body).toContain('DMS');
    expect(body).toContain('Open in…');
  });
});
