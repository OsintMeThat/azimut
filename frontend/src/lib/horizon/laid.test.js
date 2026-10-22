import { describe, expect, it } from 'vitest';
import { AS_SEARCHED, framesLaid, LAID_CELLS, meshPoint, piecesLaid } from './laid.js';

const ASPECT = 2;
const LENS = 40;
const tan = Math.tan(((LENS / 2) * Math.PI) / 180);

/** The mesh a plain photo through a `LENS` lens makes: each point where the lens itself puts it. */
function plainMesh(across = 4, down = 2) {
  const points = [];
  for (let j = 0; j <= down; j += 1) {
    for (let i = 0; i <= across; i += 1) points.push([(i / across) * 2 - 1, ((0.5 - j / down) * 2) / ASPECT]);
  }
  return { across, down, points };
}

describe('a photo laid as a search read it', () => {
  it('reads the mesh between its corners, and leaves out where no frame lies', () => {
    const mesh = { across: 2, down: 1, points: [[-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], null] };
    expect(meshPoint(mesh, 0.25, 0.5)).toEqual([-0.5, 0]);
    // a corner off every frame is left out of the blend, the others weighed as before
    const [x, y] = meshPoint(mesh, 0.75, 0.75);
    expect(x).toBeCloseTo(0.2, 9);
    expect(y).toBeCloseTo(-0.2, 9);
    expect(meshPoint({ across: 1, down: 1, points: [null, null, null, null] }, 0.5, 0.5)).toBeNull();
  });

  it('lays a collage frame by frame where the mesh and the place say', () => {
    const view = { projection: 'camera', heading: 100, tilt: 0, roll: 0, fov: LENS };
    // read through a camera just like the view's, every point stays where it is
    const flat = framesLaid({ mesh: plainMesh(), lens: LENS }, { heading: 100, tilt: 0, roll: 0 }, view, ASPECT);
    expect(flat.kind).toBe('frames');
    expect(flat.us).toHaveLength(5);
    for (const [u, v] of [[0.1, 0.2], [0.5, 0.5], [0.9, 0.7]]) {
      const at = flat.place(u, v);
      expect(at.u).toBeCloseTo(u, 6);
      expect(at.v).toBeCloseTo(v, 6);
    }
    // the place's camera turned right of the view's: the collage shows that much right
    const turned = framesLaid({ mesh: plainMesh(), lens: LENS }, { heading: 102, tilt: 0, roll: 0 }, view, ASPECT);
    const shift = turned.place(0.5, 0.5).u - 0.5;
    expect(shift).toBeCloseTo(Math.tan((2 * Math.PI) / 180) / tan / 2, 4);
    // a roll lifts one side and lowers the other
    const rolled = framesLaid({ mesh: plainMesh(), lens: LENS }, { heading: 100, tilt: 0, roll: 3 }, view, ASPECT);
    expect(rolled.place(0.05, 0.5).v).not.toBeCloseTo(rolled.place(0.95, 0.5).v, 3);
    // found mirrored, it lies flipped
    const mirrored = framesLaid({ mesh: plainMesh(), lens: LENS }, { heading: 100, tilt: 0, roll: 0, mirrored: true }, view, ASPECT);
    expect(mirrored.place(0.2, 0.5).u).toBeCloseTo(0.8, 6);
  });

  it('lays a cut collage piece by piece, the seam where the cut is', () => {
    const camera = { projection: 'camera', heading: 30, tilt: 0, roll: 0, fov: LENS };
    expect(piecesLaid(camera, ASPECT, {})).toBeNull();
    const pieces = [{ piece: 0, turn: 0, tilt: 0, roll: 0 }, { piece: 1, turn: 1, tilt: 0, roll: 0 }];
    const laid = piecesLaid(camera, ASPECT, { pieces, pieceOf: (u) => (u > 0.5 ? 1 : 0), cuts: [0.5] });
    expect(laid.kind).toBe('pieces');
    expect(laid.us).toContain(0.5);
    expect(laid.us.length).toBe(LAID_CELLS.across + 1);
    // the left piece stays, the right one moves right by its turn
    expect(laid.place(0.25, 0.5).u).toBeCloseTo(0.25, 9);
    expect(laid.place(0.75, 0.5).u).toBeGreaterThan(0.75 + 0.01);
    // each side of the seam is laid by its own piece
    expect(laid.place(0.5, 0.5, { u: 0.49, v: 0.5 }).u).toBeCloseTo(0.5, 9);
    expect(laid.place(0.5, 0.5, { u: 0.51, v: 0.5 }).u).toBeGreaterThan(0.51);
  });

  it('lays a selfie found mirrored flipped', () => {
    const camera = { projection: 'camera', heading: 30, tilt: 0, roll: 0, fov: LENS };
    const laid = piecesLaid(camera, ASPECT, { mirrored: true });
    expect(laid.kind).toBe('mirrored');
    expect(laid.place(0.2, 0.3).u).toBeCloseTo(0.8, 9);
    expect(laid.place(0.2, 0.3).v).toBeCloseTo(0.3, 9);
    expect(Object.keys(AS_SEARCHED)).toEqual(['frames', 'pieces', 'mirrored']);
  });
});
