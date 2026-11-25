// @vitest-environment happy-dom
/**
 * A proof of the scene being geolocated, open in Geo Proof and never saved, actually
 * mounted: Horizon's Send to Geo Proof makes it, the pill learns that Geo Proof holds the
 * scene, and a capture filed on the map or a frame of the scene saved in Inspect meanwhile
 * joins it once Geo Proof is in front.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

// The canvas is not the subject here, and happy-dom draws nothing: Konva answers anything
// asked of it with a stand-in that answers in turn.
vi.mock('konva', () => {
  const fake = () => {
    const own = new Map();
    return new Proxy(function () {}, {
      get(_, key) {
        if (key === Symbol.toPrimitive) return () => 0;
        if (key === Symbol.iterator) return function* () {};
        if (key === 'then' || key === 'toJSON') return undefined;
        if (!own.has(key)) own.set(key, fake());
        return own.get(key);
      },
      set(_, key, value) {
        own.set(key, value);
        return true;
      },
      apply: () => fake(),
      construct: () => fake(),
    });
  };
  return { default: fake() };
});

// happy-dom loads no picture: each panel's image is there at once
const loaded = vi.hoisted(() => []);
vi.mock('../lib/composer.js', async (original) => ({
  ...(await original()),
  loadImage: async (url) => {
    loaded.push(decodeURIComponent(url));
    return { width: 400, height: 300, naturalWidth: 400, naturalHeight: 300 };
  },
}));

const { api } = vi.hoisted(() => ({
  api: { get: vi.fn(), put: vi.fn(async () => ({})), post: vi.fn(async () => ({})), del: vi.fn(async () => ({})) },
}));
vi.mock('../lib/api.js', () => ({ api }));

const { caseState, uiState } = await import('../lib/state.svelte.js');
const { geolocating, geoProofHolds, openHeldProof } = await import('../lib/geolocating.svelte.js');
const { dispatch } = await import('../lib/events.js');
const { default: ProofComposer } = await import('./ProofComposer.svelte');

const CASE = { id: 'case-1', folders: [], entities: [] };
const VIDEO = 'media/convoy.mp4';
const PHOTO = 'media/Ridge view photo with the ridge lines.png';
const TERRAIN = 'media/Ridge view terrain, simulated.png';
const SAT = 'media/48.858370, 2.294481.png';
const EARLIER = 'media/an earlier capture.png';
const FRAME_BEFORE = 'media/convoy_t1.50s.png';
const FRAME = 'media/convoy_t1.80s.png';
const picture = (path) => ({ path, kind: 'image', title: path.slice(6, -4), attrs: {} });
const MEDIA = [{ path: VIDEO, kind: 'video', title: 'convoy', attrs: {} }, ...[PHOTO, TERRAIN, SAT, EARLIER, FRAME_BEFORE, FRAME].map(picture)];
const SCENE = {
  kind: 'draft', video: VIDEO, id: 'sc_1', start: null, end: null, label: 'Which ridge?', state: 'progress',
  captures: [EARLIER, PHOTO, TERRAIN], abandoned: null, file_kind: 'video', order: 0,
};

// what the server holds of the scene being geolocated, read again now and then, and the
// pictures of its video a proof of it takes in (`joins`)
let serverScene = null;
let serverJoins = [];

function answer(path) {
  if (path.endsWith('/geolocating')) return { geolocating: structuredClone(serverScene) };
  if (path.endsWith('/geolocating/gathered')) return { geolocating: structuredClone(serverScene), joins: [...serverJoins] };
  if (path.includes('/scenes/queue')) return { files: [], geolocating: structuredClone(serverScene) };
  if (path.endsWith('/media')) return MEDIA;
  if (path.endsWith('/satellite')) return [];
  if (path.endsWith('/proofs')) return [];
  if (path.includes('/entities')) return { items: [], next: null };
  if (path.includes('/scenes')) return { video: VIDEO, scenes: [] };
  return [];
}

let target;
let app;

const settle = async () => {
  for (let i = 0; i < 12; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  flushSync();
};
const added = () => uiState.toasts.filter((t) => / added$/.test(t.message)).map((t) => t.message);
const laid = (path) => loaded.filter((url) => url.endsWith(path)).length;

beforeEach(async () => {
  loaded.length = 0;
  uiState.toasts.length = 0;
  api.get.mockReset();
  api.get.mockImplementation(async (path) => answer(path));
  history.replaceState(null, '', '#proof');
  caseState.current = CASE;
  serverScene = structuredClone(SCENE);
  // a frame of the scene saved before the proof was made
  serverJoins = [FRAME_BEFORE];
  Object.assign(geolocating, { caseId: 'case-1', scene: structuredClone(SCENE), error: '' });
  uiState.tool = 'horizon';
  target = document.createElement('div');
  document.body.append(target);
  app = mount(ProofComposer, { target });
  flushSync();
  await settle();
  // Horizon's Send to Geo Proof while the scene is geolocated (`lib/toGeoProof.js`)
  uiState.proofScene = { video: VIDEO, moments: [], draft: 'sc_1', panels: [PHOTO, TERRAIN], label: 'Which ridge?', join: true };
  uiState.tool = 'proof';
  flushSync();
  await settle();
});

afterEach(() => {
  if (app) unmount(app);
  app = null;
  caseState.current = null;
  Object.assign(geolocating, { caseId: null, scene: null, error: '' });
  document.body.innerHTML = '';
});

describe('what the scene gathers while its proof is open, never saved', () => {
  it('tells the pill that Geo Proof holds the scene before the proof is saved', () => {
    expect(laid(PHOTO)).toBe(1);
    expect(laid(TERRAIN)).toBe(1);
    expect({ ...geoProofHolds }).toEqual({ caseId: 'case-1', video: VIDEO, id: 'sc_1' });
  });

  it('joins the proof once Geo Proof is in front, once, the captures gathered before left out', async () => {
    uiState.tool = 'satellite';
    flushSync();
    // the server gathered the capture for the scene and said so
    serverScene.captures.push(SAT);
    geolocating.scene = { ...geolocating.scene, captures: [...geolocating.scene.captures, SAT] };
    await settle();
    expect(laid(SAT)).toBe(0);

    // the pill's Open the proof goes back to it, rather than opening a saved one
    expect(openHeldProof(geolocating.scene)).toBe(true);
    expect(uiState.openProof).toBeNull();
    flushSync();
    await settle();
    expect(laid(SAT)).toBe(1);
    expect(added()).toEqual(['1 map capture added']);
    expect(laid(EARLIER)).toBe(0);
    // the handoff's own pictures are never laid a second time
    expect(laid(PHOTO)).toBe(1);
    expect(laid(TERRAIN)).toBe(1);

    uiState.tool = 'satellite';
    flushSync();
    uiState.tool = 'proof';
    flushSync();
    await settle();
    expect(laid(SAT)).toBe(1);
    expect(added()).toEqual(['1 map capture added']);
  });

  it('takes in a frame of the scene saved in Inspect meanwhile, the one saved before left out', async () => {
    uiState.tool = 'inspect';
    flushSync();
    serverJoins.push(FRAME);
    await settle();
    expect(laid(FRAME)).toBe(0);
    uiState.tool = 'proof';
    flushSync();
    await settle();
    expect(laid(FRAME)).toBe(1);
    expect(laid(FRAME_BEFORE)).toBe(0);
    expect(added()).toEqual(['1 picture of the video added']);
  });

  it('lays a capture and a frame gathered while it was behind together, under one word', async () => {
    uiState.tool = 'satellite';
    flushSync();
    serverScene.captures.push(SAT);
    geolocating.scene = { ...geolocating.scene, captures: [...geolocating.scene.captures, SAT] };
    serverJoins.push(FRAME);
    await settle();
    uiState.tool = 'proof';
    flushSync();
    await settle();
    expect(laid(SAT)).toBe(1);
    expect(laid(FRAME)).toBe(1);
    expect(added()).toEqual(['1 map capture and 1 picture of the video added']);
  });

  it('reads the video’s pictures again on the server’s word while it is in front', async () => {
    serverJoins.push(FRAME);
    dispatch({ type: 'scenes', case_id: 'case-1', video: VIDEO });
    await new Promise((resolve) => setTimeout(resolve, 450));
    await settle();
    expect(laid(FRAME)).toBe(1);
  });

  it('lets the pill go back to making a proof once Geo Proof holds the scene no more', async () => {
    serverScene.id = 'sc_2';
    geolocating.scene = { ...geolocating.scene, id: 'sc_2' };
    await settle();
    expect(geoProofHolds.id).toBeNull();
  });
});
