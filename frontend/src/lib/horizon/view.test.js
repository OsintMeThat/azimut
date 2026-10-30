import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HEIGHTS,
  heightFor,
  horizonParams,
  reachFor,
  readHorizonView,
  visibilityAt,
  visibilityStep,
  VISIBILITY_STEPS,
} from './view.js';

const CAMERA = { heading: 342.04, tilt: 2, roll: 0, fov: 66, projection: 'camera' };

describe('a Horizon view in the address', () => {
  it('writes only what differs from the defaults, and reads it back', () => {
    const params = horizonParams({
      observer: { lat: 35.621433, lon: 71.330211, mode: 'ground', height: DEFAULT_HEIGHTS.ground },
      camera: CAMERA,
    });
    expect(params).toEqual({ ll: '35.621433,71.330211', hd: '342', tl: '2', fov: '66' });
    const back = readHorizonView(new URLSearchParams(params));
    expect(back.observer).toEqual({ lat: 35.621433, lon: 71.330211, mode: 'ground', height: 1.7 });
    expect(back.camera).toEqual({ heading: 342, tilt: 2, fov: 66 });
  });

  it('keeps a drone and its height, the strip, the depth and the ground', () => {
    const params = horizonParams({
      observer: { lat: 15.35, lon: 44.2, mode: 'drone', height: 300 },
      camera: { ...CAMERA, projection: 'panorama', fov: 360 },
      visibility: 200_000,
      near: 800,
      ground: 'imagery',
    });
    expect(params.r).toBe('imagery');
    expect(params.l).toBeUndefined();
    const back = readHorizonView(new URLSearchParams(params));
    expect(back.observer.mode).toBe('drone');
    expect(back.observer.height).toBe(300);
    expect(back.camera.projection).toBe('panorama');
    expect(back.camera.fov).toBe(360);
    expect(back.visibility).toBe(200_000);
    expect(back.near).toBe(800);
    expect(back.ground).toBe('imagery');
    expect(back.lines).toBeUndefined();
  });

  it('writes the ridge lines only where they differ from what the ground comes with', () => {
    const at = { observer: null, camera: CAMERA };
    expect(horizonParams({ ...at })).not.toHaveProperty('r');
    expect(horizonParams({ ...at, ground: 'relief', lines: true }).l).toBe('1');
    expect(horizonParams({ ...at, ground: 'plain', lines: true })).toMatchObject({ r: 'plain' });
    expect(horizonParams({ ...at, ground: 'plain', lines: true })).not.toHaveProperty('l');
    expect(horizonParams({ ...at, ground: 'plain', lines: false }).l).toBe('0');
    expect(readHorizonView(new URLSearchParams('r=plain&l=0'))).toMatchObject({ ground: 'plain', lines: false });
    expect(readHorizonView(new URLSearchParams('l=1'))).toMatchObject({ lines: true });
    expect(readHorizonView(new URLSearchParams('r=lines&l=yes'))).toEqual({});
  });

  it('refuses what an eye cannot be given', () => {
    const back = readHorizonView(new URLSearchParams('ll=89,10&m=boat&fov=900&r=x'));
    expect(back.observer).toBeUndefined();
    expect(back.camera.fov).toBe(150);
    expect(back.ground).toBeUndefined();
    const ground = readHorizonView(new URLSearchParams('ll=46,7&h=999'));
    expect(ground.observer.height).toBe(100);
  });

  it('marches farther than an eye\'s default only for air that lets it see farther', () => {
    expect(reachFor('ground', null)).toBeNull();
    expect(reachFor('ground', 40_000)).toBeNull(); // haze over the default reach
    expect(reachFor('drone', 200_000)).toBe(200_000);
    expect(reachFor('aircraft', 200_000)).toBeNull();
    expect(reachFor('aircraft', 900_000)).toBe(500_000);
  });

  it('turns the visibility slider into kilometres on a log scale, its last step clear air', () => {
    expect(visibilityAt(0)).toBe(1000);
    expect(visibilityAt(VISIBILITY_STEPS - 1)).toBe(300_000);
    expect(visibilityAt(VISIBILITY_STEPS)).toBeNull();
    expect(visibilityStep(null)).toBe(VISIBILITY_STEPS);
    for (const km of [1, 5, 40, 120, 300]) expect(visibilityAt(visibilityStep(km * 1000)) / 1000).toBeCloseTo(km, -0.5);
  });

  it('gives each eye its own height when none is said', () => {
    expect(heightFor('aircraft')).toBe(3000);
    expect(heightFor('drone', '')).toBe(120);
    expect(heightFor('drone', 0)).toBe(1);
  });
});
