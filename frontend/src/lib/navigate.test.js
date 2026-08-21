import { beforeEach, describe, expect, it, vi } from 'vitest';

const post = vi.fn().mockResolvedValue({ path: '/cases/c1/azimut/media' });
vi.mock('./api.js', () => ({ api: { post: (...a) => post(...a), get: vi.fn() } }));

const { caseState, uiState } = await import('./state.svelte.js');
const { gotoCapture, gotoPoint, openEntity, opensInFileManager } = await import('./navigate.js');

beforeEach(() => {
  uiState.tool = 'media';
  uiState.gotoCoords = null;
  uiState.focusCapture = null;
  uiState.openBoardEntity = null;
  post.mockClear();
  caseState.current = { id: 'c1', name: 'Case', entities: [], links: [], folders: [] };
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

describe('a type with no tool of its own', () => {
  it('opens on the board, which is where the graph types are read', () => {
    // before this the call fell through doing nothing: a relation row on the map
    // said "Open …" and swallowed the click
    openEntity({ id: 'e-person', type: 'person', label: 'A. Analyst', attrs: {} });

    expect(uiState.tool).toBe('board');
    expect(uiState.openBoardEntity).toBe('e-person');
  });

  it('leaves the workspace alone for a row it cannot identify', () => {
    openEntity({ type: 'person', attrs: {} });

    expect(uiState.tool).toBe('media');
    expect(uiState.openBoardEntity).toBeNull();
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

describe('a file the app cannot display', () => {
  const plan = { id: 'm1', type: 'media', attrs: { path: 'media/site plan.pdf', kind: 'file' } };

  it('is handed back to the desktop, in the folder it lives in', () => {
    openEntity(plan);

    expect(post).toHaveBeenCalledWith('/api/cases/c1/media/reveal', {
      path: 'media/site plan.pdf',
    });
    // and the workspace does not move: nothing here could show it anyway
    expect(uiState.tool).toBe('media');
    expect(uiState.focusMedia).not.toBe('media/site plan.pdf');
  });

  it('leaves the images, video and audio the app does display alone', () => {
    openEntity({ id: 'm2', type: 'media', attrs: { path: 'media/quay.jpg', kind: 'image' } });

    expect(post).not.toHaveBeenCalled();
    expect(uiState.focusMedia).toBe('media/quay.jpg');
  });

  it('says which entities need the file manager', () => {
    expect(opensInFileManager(plan)).toBe(true);
    expect(opensInFileManager({ type: 'media', attrs: { path: 'a.mp4' } })).toBe(false);
    expect(opensInFileManager({ type: 'capture', attrs: { path: 'media/crop.png' } })).toBe(false);
    expect(opensInFileManager(null)).toBe(false);
  });
});

describe('reopening an artifact in its tool', () => {
  // The tools take the bare stem the save route slugified. These paths are the
  // ones the backend records today (`layout.proof_spec_rel` and friends); the
  // folder prefixes moved once already, and stripping them by name meant every
  // one of these handed over a name with a directory still glued to it.
  it('names a proof by its spec file, wherever the spec folder sits', () => {
    openEntity({ type: 'proof', attrs: { spec: 'proofs/.meta/Rooftop angle.json' } });

    expect(uiState.openProof).toBe('Rooftop angle');
    expect(uiState.tool).toBe('proof');
  });

  it('names a post draft by its draft file', () => {
    openEntity({ type: 'post', attrs: { draft: '.drafts/Quay thread.json' } });

    expect(uiState.openDraft).toBe('Quay thread');
    expect(uiState.tool).toBe('post');
  });

  it('names an inspect session by its spec file', () => {
    openEntity({ type: 'inspect-session', attrs: { spec: '.inspect/Bridge pass.json' } });

    expect(uiState.openInspect).toBe('Bridge pass');
    expect(uiState.tool).toBe('inspect');
  });

  it('opens the tool empty rather than on a name it could not read', () => {
    uiState.openProof = null;
    openEntity({ type: 'proof', attrs: {} });

    expect(uiState.openProof).toBeNull();
    expect(uiState.tool).toBe('proof');
  });
});
