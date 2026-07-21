import { beforeEach, describe, expect, it, vi } from 'vitest';
import { uiState } from './state.svelte.js';
import { openEntity } from './navigate.js';

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
});
