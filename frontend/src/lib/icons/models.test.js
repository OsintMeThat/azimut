import { describe, expect, it } from 'vitest';
import { dot } from './build.js';
import { GEOMETRY, MODEL_IDS, modelById } from './models.js';
import { MODEL_FAMILIES, MODEL_META, isModelId, modelMeta } from './modelMeta.js';
import { VIEWS, modelSvg } from './paint.js';
import { solve } from './solve.js';

describe('the models', () => {
  it('names every model it draws, and draws every model it names', () => {
    expect(MODEL_META.map((m) => m.id).sort()).toEqual([...MODEL_IDS].sort());
    for (const meta of MODEL_META) {
      expect(meta.id).toMatch(/^model-[a-z-]+$/);
      expect(MODEL_FAMILIES).toContain(meta.family);
      expect(meta.label.length).toBeGreaterThan(1);
    }
    expect(new Set(MODEL_META.map((m) => m.label)).size).toBe(MODEL_META.length);
  });

  it('holds the mockup\'s 23 classes, the eight added ones and the anti-aircraft guns', () => {
    for (const id of ['model-tank', 'model-heli', 'model-cargo', 'model-van', 'model-towed-gun', 'model-dozer',
      'model-fpv', 'model-usv', 'model-locomotive', 'model-wagon', 'model-aa-gun', 'model-aa-pickup', 'model-mrap']) {
      expect(isModelId(id)).toBe(true);
    }
    expect(MODEL_IDS.length).toBe(33);
    expect(modelMeta('model-nope')).toBeNull();
    expect(modelById('model-nope')).toBeNull();
  });

  it('builds every model from convex solids, once', () => {
    for (const id of MODEL_IDS) {
      const model = modelById(id);
      expect(modelById(id)).toBe(model);
      // a fuselage lofted through rings at different heights is not quite convex:
      // half a percent of the model's length, far under a solid built inside out
      const slack = Math.max(0.001, model.len * 0.005);
      for (const prim of model.prims) {
        for (const f of prim.faces) {
          for (const p of prim.verts) expect(dot(f.n, p) - f.d).toBeLessThan(slack);
        }
      }
    }
  });

  it('keeps each class to a believable size', () => {
    const len = (id) => modelById(id).len;
    expect(len('model-fpv')).toBeLessThan(0.5);
    expect(len('model-car')).toBeGreaterThan(4);
    expect(len('model-car')).toBeLessThan(5);
    expect(len('model-tank')).toBeGreaterThan(9);
    expect(len('model-cargo')).toBeGreaterThan(100);
    expect(len('model-locomotive')).toBeGreaterThan(15);
    for (const id of MODEL_IDS) expect(GEOMETRY[id]).toBeTypeOf('function');
  });

  it('shows something at every offered view and every quarter turn', () => {
    for (const id of MODEL_IDS) {
      const model = modelById(id);
      for (const view of VIEWS) {
        for (const heading of [0, 90, 180, 270]) {
          const faces = solve(model, heading, view.tilt).order.reduce((n, it) => n + it.faces.length, 0);
          expect(faces, `${id} at ${heading}/${view.tilt}`).toBeGreaterThan(0);
        }
      }
      expect(modelSvg(model, { px: 40 })).toContain('<path');
    }
  });

  it('solves the busiest view in a few milliseconds', () => {
    const cargo = modelById('model-cargo');
    solve(cargo, 130, 55);
    const start = performance.now();
    for (let k = 0; k < 20; k++) solve(cargo, 130 + k, 55);
    expect((performance.now() - start) / 20).toBeLessThan(5);
  });
});
