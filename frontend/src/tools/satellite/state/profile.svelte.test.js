// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createProfileState, EYE_HEIGHT, PROFILE_SAMPLES } from './profile.svelte.js';

const A = { lat: 46.5, lon: 7.9 };
const B = { lat: 46.6, lon: 8.0 };
const C = { lat: 46.7, lon: 8.1 };
const ANSWER = { distance_m: [0, 10], elevation: [1000, 1100], lat: [46.5, 46.6], lon: [7.9, 8.0] };

let drawn;
let layer;
let api;

function store() {
  return createProfileState({ engine: () => ({ id: 'map' }), api, surface: () => layer });
}

beforeEach(() => {
  drawn = [];
  layer = { set: vi.fn((shapes) => drawn.push(shapes)), patch: vi.fn(), clear: vi.fn(), destroy: vi.fn() };
  api = { post: vi.fn(async () => ANSWER) };
});

describe('the elevation profile tool', () => {
  it('takes no click while it is off', () => {
    const tool = store();
    expect(tool.addPoint(A)).toBe(false);
    expect(tool.points).toEqual([]);
  });

  it('asks the terrain server nothing while the line is still being drawn', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.addPoint(C);
    expect(api.post).not.toHaveBeenCalled();
    expect(tool.showing).toBe(false);
  });

  it('reads the ground once Enter finishes the line, with the eye and target heights', async () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    expect(tool.finish()).toBe(false); // one point is no line
    tool.addPoint(B);
    expect(tool.finish()).toBe(true);
    expect(tool.showing).toBe(true);
    await vi.waitFor(() => expect(tool.profile).toEqual(ANSWER));
    expect(api.post).toHaveBeenCalledWith('/api/terrain/profile', {
      points: [[46.5, 7.9], [46.6, 8.0]],
      samples: PROFILE_SAMPLES,
      sight: true,
      eye_height: EYE_HEIGHT,
      target_height: 0,
    });
  });

  it('turns a finished line’s corners into handles, and a dropped one reads again', async () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.finish();
    expect(tool.addPoint(C)).toBe(true);
    expect(tool.points).toEqual([A, B]);
    const handle = drawn.at(-1).find((shape) => shape?.id === 'profile-corner-1');
    const sets = layer.set.mock.calls.length;
    handle.onDrag(C);
    expect(layer.patch).toHaveBeenCalledWith('profile-line', { points: [A, C] });
    expect(layer.set.mock.calls.length).toBe(sets);
    handle.onDragEnd();
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1].points).toEqual([[46.5, 7.9], [46.7, 8.1]]);
  });

  it('asks again when the eye or the target is raised, and not for the same heights', async () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.finish();
    tool.setHeights({ target: 30 });
    await vi.waitFor(() => expect(api.post).toHaveBeenCalledTimes(2));
    expect(api.post.mock.calls[1][1].target_height).toBe(30);
    tool.setHeights({ target: 30 });
    expect(api.post).toHaveBeenCalledTimes(2);
    tool.setHeights({ eye: -4 });
    expect(tool.eyeHeight).toBe(0);
  });

  it('says what went wrong rather than drawing nothing', async () => {
    api.post = vi.fn(async () => {
      throw new Error('Terrain could not be loaded');
    });
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.finish();
    await vi.waitFor(() => expect(tool.error).toBe('Terrain could not be loaded'));
    expect(tool.showing).toBe(true);
  });

  it('marks the point read on the chart, and forgets everything when closed', () => {
    const tool = store();
    tool.open();
    tool.addPoint(A);
    tool.addPoint(B);
    tool.finish();
    tool.showReading({ lat: 46.55, lon: 7.95 });
    expect(drawn.at(-1).filter(Boolean).some((shape) => shape.at?.lon === 7.95)).toBe(true);
    tool.close();
    expect(tool.on).toBe(false);
    expect(tool.points).toEqual([]);
    expect(tool.profile).toBeNull();
  });
});
