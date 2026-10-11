import { describe, expect, it, vi } from 'vitest';
import { captureMapView, applyMapView, layerLegend } from './mapViews.js';

describe('map compositions', () => {
  it('captures ordered visible layer references and visible legend groups without copying geometry', () => {
    const layers = [{ name: 'one', title: 'One', enabled: true, hidden: ['Hidden'], categories: [{ name: 'Blue', colour: '#0072b2' }, { name: 'Hidden' }], document: { secret: 'case geometry' } },
      { name: 'two', title: 'Two', enabled: false }, { name: 'three', title: 'Three', enabled: true, hidden: ['Only'], categories: [{ name: 'Only' }] }];
    const camera = { lat: 48, lon: 2, zoom: 10, bearing: 20, pitch: 30 };
    const view = captureMapView({ engine: { camera: () => camera }, provider: 'esri', rows: [{ id: 'roads', on: true }, { id: 'locked', on: true, disabled: true }], layers, title: 'Review' });
    expect(view.camera).toEqual(camera); expect(view.overlays).toEqual(['roads']);
    expect(view.layers).toEqual([{ name: 'one', hidden: ['Hidden'] }, { name: 'three', hidden: ['Only'] }]);
    expect(view.legend).toEqual([{ label: 'One · Blue', colour: '#0072b2' }]);
    expect(JSON.stringify(view)).not.toContain('case geometry');
    layers[0].hidden.push('Blue'); expect(view.layers[0].hidden).toEqual(['Hidden']);
    expect(layerLegend(layers)).toEqual([]);
  });

  function setup() {
    const scope = { rows: [{ name: 'old', enabled: true }, { name: 'kept', enabled: false }], toggle: vi.fn(async () => {}) };
    const layers = { rows: scope.rows, reorder: vi.fn(async () => true), edited: vi.fn() };
    const api = { patch: vi.fn(async () => ({ name: 'kept', hidden: ['Hidden'] })) };
    const rows = [{ id: 'roads', on: true, toggle: vi.fn() }, { id: 'borders', on: false, toggle: vi.fn() }, { id: 'locked', on: true, disabled: true, toggle: vi.fn() }];
    const engine = { setCamera: vi.fn() }, onprovider = vi.fn(async () => {});
    const view = { provider: 'esri', camera: { lat: 48, lon: 2, zoom: 10 }, layers: [{ name: 'kept', hidden: ['Hidden'] }, { name: 'missing', hidden: [] }], overlays: ['borders'] };
    return { args: { caseId: 'case', scope, layers, api, rows, engine, onprovider }, view };
  }

  it('restores order, groups, visibility and camera while reporting deleted layers', async () => {
    const { args, view } = setup();
    expect(await applyMapView(view, args)).toEqual([{ name: 'missing', hidden: [] }]);
    expect(args.layers.reorder).toHaveBeenCalledWith('case', ['kept', 'old']);
    expect(args.api.patch).toHaveBeenCalledWith('/api/cases/case/map-layers/kept', { hidden: ['Hidden'] });
    expect(args.scope.toggle).toHaveBeenCalledTimes(2);
    expect(args.rows[0].toggle).toHaveBeenCalledOnce(); expect(args.rows[1].toggle).toHaveBeenCalledOnce(); expect(args.rows[2].toggle).not.toHaveBeenCalled();
    expect(args.onprovider).toHaveBeenCalledWith('esri'); expect(args.engine.setCamera).toHaveBeenCalledWith(view.camera);
  });

  it('stops restoration after a refused reorder or a case switch', async () => {
    const { args, view } = setup(); args.layers.reorder.mockResolvedValue(false);
    await expect(applyMapView(view, args)).rejects.toThrow('order'); expect(args.api.patch).not.toHaveBeenCalled();
    args.layers.reorder.mockResolvedValue(true);
    let owner = 'case'; args.api.patch.mockImplementation(async () => { owner = 'other'; return {}; });
    await expect(applyMapView(view, { ...args, currentCase: () => owner })).rejects.toThrow('case changed');
    expect(args.layers.edited).not.toHaveBeenCalled(); expect(args.engine.setCamera).not.toHaveBeenCalled();
  });
});
