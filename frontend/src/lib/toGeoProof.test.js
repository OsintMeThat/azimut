import { beforeEach, describe, expect, it, vi } from 'vitest';
import { geolocating } from './geolocating.svelte.js';
import { uiState } from './state.svelte.js';
import { geolocatedHandoff, keepInOrder, sendToGeoProof } from './toGeoProof.js';

/**
 * Pictures a map tab sends to Geo Proof: the proof of the scene the case geolocates when
 * that scene gathered them, as Make the proof makes it, else panels of the proof open.
 */

const VIDEO = 'media/clip.mp4';
/** The scene the pill holds, as the queue's row gives it: the whole video, two captures gathered. */
const held = (extra = {}) => ({
  kind: 'draft', video: VIDEO, id: 'sc_whole', start: null, end: null, label: 'Which town?', state: 'progress',
  captures: ['media/old.png'], abandoned: null, file_kind: 'video', order: 0, ...extra,
});
const PHOTO = { path: 'media/view photo.png', scene: { video: VIDEO, id: 'sc_whole', label: '', captures: 2 } };
const TERRAIN = { path: 'media/view terrain.png', scene: { video: VIDEO, id: 'sc_whole', label: '', captures: 3 } };

describe('the handoff of pictures a scene geolocated gathered', () => {
  it('makes the proof of that scene, holding its time, its id and its label, with the pictures in order', () => {
    expect(geolocatedHandoff([PHOTO, TERRAIN], held())).toEqual({
      video: VIDEO, moments: [], draft: 'sc_whole', panels: [PHOTO.path, TERRAIN.path], label: 'Which town?', join: true,
    });
    // a timed scene hands its moments over, as Make the proof does
    expect(geolocatedHandoff([PHOTO, TERRAIN], held({ start: 12, end: 20 })).moments).toEqual([{ start: 12, end: 20 }]);
    // a capture the pill already counted, filed before
    expect(geolocatedHandoff([{ path: 'media/old.png' }], held())?.panels).toEqual(['media/old.png']);
  });

  it('lays out a picture marked to geolocate first, as its own Make the proof does', () => {
    const picture = held({ video: 'media/street.jpg', id: 'sc_pic', file_kind: 'image' });
    const kept = [{ path: 'media/shot.png', scene: { video: 'media/street.jpg', id: 'sc_pic' } }];
    expect(geolocatedHandoff(kept, picture)).toEqual({
      picture: 'media/street.jpg', panels: ['media/street.jpg', 'media/shot.png'], label: 'Which town?', join: true,
    });
  });

  it('hands nothing over with no scene geolocated, or for a picture the scene did not gather', () => {
    expect(geolocatedHandoff([PHOTO], null)).toBeNull();
    expect(geolocatedHandoff([], held())).toBeNull();
    // attached to another scene than the one the pill holds
    expect(geolocatedHandoff([{ ...PHOTO, scene: { video: VIDEO, id: 'sc_other' } }], held())).toBeNull();
    // one of the two never gathered
    expect(geolocatedHandoff([PHOTO, { path: 'media/elsewhere.png' }], held())).toBeNull();
  });
});

describe('sending them to Geo Proof', () => {
  beforeEach(() => {
    uiState.proofScene = null;
    uiState.composeQueue = [];
    uiState.tool = 'horizon';
    geolocating.caseId = null;
    geolocating.scene = null;
  });

  it('hands the scene over while the case geolocates it', () => {
    geolocating.caseId = 'case';
    geolocating.scene = held();
    const made = sendToGeoProof('case', [PHOTO, TERRAIN]);
    expect(uiState.proofScene).toEqual(made);
    expect([uiState.proofScene.draft, uiState.composeQueue, uiState.tool]).toEqual(['sc_whole', [], 'proof']);
  });

  it('queues the pictures for the proof open otherwise, once each', () => {
    geolocating.caseId = 'other case';
    geolocating.scene = held();
    expect(sendToGeoProof('case', [PHOTO, TERRAIN, PHOTO])).toBeNull();
    expect([uiState.proofScene, uiState.composeQueue, uiState.tool]).toEqual([null, [PHOTO.path, TERRAIN.path], 'proof']);
  });
});

describe('keeping the pictures in order', () => {
  it('encodes every picture at once, then keeps them one after the other in the order given', async () => {
    const events = [];
    let release;
    const first = new Promise((resolve) => { release = resolve; });
    const encode = vi.fn(async (frame) => {
      events.push(`encode ${frame}`);
      return `${frame}.png`;
    });
    const keep = vi.fn(async (blob, part) => {
      events.push(`keep ${blob} as ${part}`);
      if (part === 'photo') await first;
      return { path: `media/${part}.png` };
    });
    const kept = keepInOrder(['a', 'b'], ['photo', 'terrain'], { encode, keep });
    await vi.waitFor(() => expect(events).toContain('keep a.png as photo'));
    // both encoded before the first is kept, and the second waits for the first
    expect(events).toEqual(['encode a', 'encode b', 'keep a.png as photo']);
    release();
    expect(await kept).toEqual([{ path: 'media/photo.png' }, { path: 'media/terrain.png' }]);
    expect(events.at(-1)).toBe('keep b.png as terrain');
    expect([encode.mock.calls.length, keep.mock.calls.length]).toEqual([2, 2]);
  });
});
