import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uiState } from './state.svelte.js';
import { gotoCapture, gotoPoint, openEntity } from './navigate.js';

beforeEach(() => {
  uiState.tool = 'media';
  uiState.gotoCoords = null;
  uiState.focusCapture = null;
  vi.stubGlobal('window', { open: vi.fn() });
});

describe('openEntity', () => {
  it('opens bookmarks and external captures in a new browser tab', () => {
    openEntity({ type: 'bookmark', attrs: { url: 'https://example.test/bookmark' } });
    openEntity({ type: 'capture', attrs: { source_url: 'https://maps.example.test/view' } });

    expect(window.open).toHaveBeenNthCalledWith(1, 'https://example.test/bookmark', '_blank', 'noopener,noreferrer');
    expect(window.open).toHaveBeenNthCalledWith(2, 'https://maps.example.test/view', '_blank', 'noopener,noreferrer');
  });

  it('returns an internal capture to its recorded Satellite view', () => {
    openEntity({ type: 'capture', attrs: {
      path: 'media/crop.png', lat: 48.8584, lon: 2.2945, zoom: 17, bearing: 30,
      provider: 'esri-world-imagery',
    } });

    expect(uiState.tool).toBe('satellite');
    expect(uiState.focusCapture).toBe('media/crop.png');
    expect(uiState.gotoCoords).toEqual({
      lat: 48.8584, lon: 2.2945, zoom: 17, bearing: 30, provider: 'esri-world-imagery',
    });
  });

  it('leaves the zoom to the map when a place records none', () => {
    // enrichment mints a place from a photo's EXIF: coordinates, no zoom. A
    // zoom of 0 is the whole globe, so an absent one must stay absent (NaN)
    // and let the Satellite tool pick its own close-in default.
    openEntity({ type: 'place', attrs: { lat: 48.8584, lon: 2.2945, zoom: null, bearing: null } });

    expect(uiState.tool).toBe('satellite');
    expect(uiState.gotoCoords.lat).toBe(48.8584);
    expect(uiState.gotoCoords.zoom).toBeNaN();
    expect(uiState.gotoCoords.bearing).toBeNaN();
  });

  it('keeps the zoom a place did record', () => {
    openEntity({ type: 'place', attrs: { lat: 48.8584, lon: 2.2945, zoom: 19, bearing: 0 } });

    expect(uiState.gotoCoords).toEqual({ lat: 48.8584, lon: 2.2945, zoom: 19, bearing: 0 });
  });
});

describe('gotoCapture', () => {
  it('leaves the zoom to the map when the capture records none', () => {
    gotoCapture({ type: 'capture', attrs: { lat: 48.8584, lon: 2.2945, zoom: null } });

    expect(uiState.tool).toBe('satellite');
    expect(uiState.gotoCoords.zoom).toBeNaN();
  });
});

describe('gotoPoint', () => {
  it('flies the map to a position a file states about itself', () => {
    // no entity to open: the point comes off a sidecar, and the map is where
    // "is this plausible?" gets answered
    gotoPoint(48.8583, 2.2945);
    expect(uiState.tool).toBe('satellite');
    expect(uiState.gotoCoords).toEqual({ lat: 48.8583, lon: 2.2945 });
  });

  it('ignores a point it could not place', () => {
    uiState.gotoCoords = null;
    gotoPoint(Number('north'), 2.2945);
    expect(uiState.gotoCoords).toBeNull();
  });
});
