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
