import { describe, expect, it } from 'vitest';
import { between, eased, globeCamera, globeGround, PAGE_GROUND, plateView } from './globeView.js';
import { PALETTES, TINTS } from './plainBasemap.js';

describe('a plate’s view on the globe', () => {
  it('hands the globe the app’s zoom and bearing, a level over the flat engine’s and turned the other way', () => {
    expect(globeCamera({ lat: 46, lon: 7, zoom: 12, bearing: 30, pitch: 55 })).toEqual({ lat: 46, lon: 7, zoom: 13, bearing: -30, pitch: 55 });
    expect(globeCamera({ lat: 46, lon: 7, zoom: 12 })).toEqual({ lat: 46, lon: 7, zoom: 13, bearing: 0, pitch: 0 });
  });

  it('reads the globe’s camera back as the plate keeps a view, its zoom unrounded', () => {
    const view = { lat: 46, lon: 7, zoom: 12.37, bearing: 30, pitch: 55 };
    const camera = globeCamera(view);
    expect(plateView({ ...camera, zoom: 13 }, 13.37)).toEqual(view);
    expect(plateView({ lat: 0, lon: 190, bearing: 200, pitch: 0 }, 5).lon).toBe(-170);
    expect(plateView({ lat: 0, lon: 0, bearing: 200, pitch: 0 }, 5).bearing).toBe(160);
  });
});

describe('the ground the globe draws for a plate', () => {
  it('draws a quiet ground in its colour, its relief shaded when asked', () => {
    expect(globeGround('plain')).toEqual({ colour: PALETTES.light.ground, tints: null, tintOpacity: 0.85, shade: 0 });
    expect(globeGround('plain', { shaded: true }).shade).toBeCloseTo(0.56, 6);
    expect(globeGround('plain-dark').colour).toBe(PALETTES.dark.ground);
  });

  it('draws a topographic ground with its heights tinted and shaded, in the analyst’s own colours', () => {
    const topo = globeGround('plain-topo', { plain: { colours: { ground: '#ffeedd' } } });
    expect(topo.colour).toBe('#ffeedd');
    expect(topo.tints).toBe(TINTS.topo);
    expect(topo.shade).toBeCloseTo(0.72, 6);
    expect(globeGround('plain-staff', { plain: { tints: false } }).tints).toBe(null);
    expect(globeGround('plain-topo', { intensity: 3 }).shade).toBe(1);
  });

  it('draws a self-shaded ground with its own tints and shading, at its presence', () => {
    const relief = globeGround('plain-relief');
    expect(relief.tints).toBe(TINTS.relief);
    expect(relief.shade).toBeCloseTo(0.88, 6);
    expect(globeGround('plain-news').tints).toBe(null);
    expect(globeGround('plain-news').shade).toBeCloseTo(0.72, 6);
    // presence leaves the land's own colour as it is
    expect(globeGround('plain-grey', { plain: { presence: 0.3 } }).colour).toBe(PALETTES.grey.ground);
  });

  it('leaves imagery on the page’s own colour, which a faded picture shows through', () => {
    expect(globeGround('esri-world-imagery')).toEqual({ colour: PAGE_GROUND, shade: 0 });
  });
});

describe('a camera flight between two views', () => {
  it('eases in and out, and lands where it was going', () => {
    expect(eased(0)).toBe(0);
    expect(eased(1)).toBe(1);
    expect(eased(0.5)).toBe(0.5);
    expect(eased(0.1)).toBeLessThan(0.1);
  });

  it('turns the short way round, over the antimeridian and past north', () => {
    const a = { lat: 0, lon: 170, zoom: 5, bearing: 170, pitch: 0 };
    const b = { lat: 10, lon: -170, zoom: 7, bearing: -170, pitch: 60 };
    const half = between(a, b, 0.5);
    expect(half.lat).toBe(5);
    expect(half.lon).toBe(180);
    expect(half.zoom).toBe(6);
    expect(Math.abs(half.bearing)).toBe(180);
    expect(half.pitch).toBe(30);
    expect(between(a, b, 1).lon).toBe(190);
  });
});
