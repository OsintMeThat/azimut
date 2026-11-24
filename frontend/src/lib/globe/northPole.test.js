import { describe, expect, it } from 'vitest';
import { EARTH, MERC_LAT } from './earth.js';
import {
  DEPTH_KM,
  DIVE_AT,
  HINT_FROM,
  diveEase,
  fallDepth,
  fallSpeed,
  hintStrength,
  holeOnScreen,
  poleStage,
  rearmed,
} from './northPole.js';

/**
 * A view looking down into the hole: the centre of the Earth at `core` on screen,
 * the rim a circle of `radius` px round `rim`, and the first ground on the line
 * to the core at latitude `through` (past 85.05°: the hole itself).
 */
function looking({ core = { x: 500, y: 400 }, rim = core, radius = 100, through = 89.9, rimBehind = false, exaggeration = 1 } = {}) {
  return {
    projectAt(lat, lon, metres) {
      if (lat === 90) {
        expect(metres * exaggeration).toBeCloseTo(-EARTH, 3);
        return core;
      }
      if (rimBehind) return null;
      expect(lat).toBeCloseTo(MERC_LAT, 6);
      expect(metres).toBe(0);
      const a = (lon * Math.PI) / 180;
      return { x: rim.x + radius * Math.cos(a), y: rim.y + radius * Math.sin(a) };
    },
    surfaceAt: () => (through == null ? null : { lat: through, lon: 0 }),
  };
}

describe('holeOnScreen', () => {
  it('measures the hole against half the shorter side of the screen', () => {
    const hole = holeOnScreen(looking({ radius: 200 }), 1000, 800);
    expect(hole.reach).toBeCloseTo(0.5, 6);
    expect(hole.aim).toBeCloseTo(0, 6);
    expect(hole.seen).toBe(true);
  });

  it('measures the rim round its own middle, wherever the centre of the Earth shows', () => {
    const hole = holeOnScreen(looking({ core: { x: 500, y: 400 }, rim: { x: 500, y: 300 }, radius: 200 }), 1000, 800);
    expect(hole.radius).toBeCloseTo(200, 6);
    expect(hole.core).toEqual({ x: 500, y: 400 });
  });

  it('reaches the centre of the Earth however tall the relief is drawn', () => {
    expect(holeOnScreen(looking({ exaggeration: 3 }), 1000, 800, 3).seen).toBe(true);
  });

  it('takes the hole as filling everything once its rim is behind the eye', () => {
    expect(holeOnScreen(looking({ rimBehind: true }), 1000, 800).reach).toBe(Infinity);
  });

  it('sees the centre only through the hole, not behind the ground, nor off the screen', () => {
    expect(holeOnScreen(looking({ through: 60 }), 1000, 800).seen).toBe(false);
    expect(holeOnScreen(looking({ through: null }), 1000, 800).seen).toBe(false);
    expect(holeOnScreen(looking({ core: { x: -20, y: 400 } }), 1000, 800).seen).toBe(false);
  });

  it('has nothing to say with the centre behind the eye or no screen', () => {
    expect(holeOnScreen({ projectAt: () => null, surfaceAt: () => null }, 1000, 800)).toBeNull();
    expect(holeOnScreen(looking(), 0, 800)).toBeNull();
  });
});

describe('poleStage', () => {
  const at = (reach, aim = 0, seen = true) => poleStage({ reach, aim, seen });

  it('shows nothing until the hole is a fair share of the screen', () => {
    expect(at(HINT_FROM - 0.01)).toBe('none');
    expect(at(HINT_FROM)).toBe('hint');
  });

  it('falls in once the hole fills the screen with the pole near the middle', () => {
    expect(at(DIVE_AT)).toBe('dive');
    // filled, but looked at from the side: still only the eyes
    expect(at(DIVE_AT, 0.6)).toBe('hint');
    // the rim behind the eye: the view is in it, wherever the pole stands
    expect(at(Infinity, 0.6)).toBe('dive');
  });

  it('never acts on a hole the screen does not show', () => {
    expect(at(Infinity, 0, false)).toBe('none');
    expect(poleStage(null)).toBe('none');
  });
});

describe('the rest of the way down', () => {
  it('brings the eyes in gradually', () => {
    expect(hintStrength(HINT_FROM)).toBe(0);
    expect(hintStrength(10)).toBe(1);
    expect(hintStrength(0.45)).toBeGreaterThan(0);
  });

  it('rearms once the view has left the hole, down to no eyes', () => {
    expect(rearmed({ seen: true, reach: HINT_FROM - 0.01, aim: 0.8 })).toBe(true);
    expect(rearmed({ seen: false, reach: 3, aim: 0 })).toBe(true);
    expect(rearmed({ seen: true, reach: 0.5, aim: 0.8 })).toBe(false);
  });

  it('leans into the dive slowly, then gathers speed', () => {
    expect(diveEase(0)).toBe(0);
    expect(diveEase(1)).toBe(1);
    expect(diveEase(0.5)).toBeLessThan(0.25);
  });

  it('falls the whole radius of the Earth, slow at both ends', () => {
    expect(fallDepth(0)).toBe(0);
    expect(fallDepth(1)).toBe(DEPTH_KM);
    expect(fallDepth(0.1)).toBeLessThan(DEPTH_KM * 0.1);
    expect(fallSpeed(0)).toBe(0);
    expect(fallSpeed(0.5)).toBeCloseTo(1, 6);
    expect(fallSpeed(1)).toBeCloseTo(0, 6);
  });
});
