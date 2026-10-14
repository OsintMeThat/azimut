import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('../api.js', () => ({ api: { get: vi.fn() }, detailLine: (detail) => typeof detail === 'string' ? detail : '' }));
import { api } from '../api.js';
import { downloadLayer } from './layerExport.js';

beforeEach(() => vi.clearAllMocks());
describe('layer downloads', () => {
  it('builds each local point icon once and delegates bundled source icons to the server', async () => {
    api.get.mockResolvedValue({ features: [
      ...[1, 2].map(() => ({ geometry: { type: 'Point' }, properties: { symbol: 'badge-tank', colour: '#D55E00' } })),
      { geometry: { type: 'Point' }, properties: { icon: 'source.png' } },
      { geometry: { type: 'Polygon' }, properties: {} },
      { geometry: { type: 'Point' }, properties: {} },
    ] });
    const drawIcon = vi.fn(() => 'local-png'), save = vi.fn(), blob = new Blob(['KMZ']);
    const fetchFile = vi.fn(async () => ({ ok: true, blob: async () => blob }));
    await downloadLayer('case', { name: 'layer name', title: 'Map / review' }, 'kmz', { drawIcon, fetchFile, save });
    expect(drawIcon).toHaveBeenCalledTimes(2);
    expect(drawIcon).toHaveBeenCalledWith('badge-tank', '#d55e00', { status: '', external: false });
    expect(JSON.parse(fetchFile.mock.calls[0][1].body)).toEqual({ icons: { 'badge-tank-d55e00': 'local-png', 'pin-0072b2': 'local-png' } });
    expect(fetchFile.mock.calls[0][0]).toBe('/api/cases/case/map-layers/layer%20name/export/kmz');
    expect(save).toHaveBeenCalledWith(blob, 'Map _ review.kmz');
  });
  it('downloads plain geometry without fetching or rasterizing icons', async () => {
    const drawIcon = vi.fn(), save = vi.fn();
    await downloadLayer('case', { name: 'work', title: 'Map' }, 'geojson', { drawIcon, save, fetchFile: async () => ({ ok: true, blob: async () => new Blob(['{}']) }) });
    expect(api.get).not.toHaveBeenCalled(); expect(drawIcon).not.toHaveBeenCalled(); expect(save).toHaveBeenCalledOnce();
  });
  it('keeps the download unsaved when the server refuses it', async () => {
    const save = vi.fn();
    await expect(downloadLayer('case', { name: 'work', title: 'Map' }, 'kml', { save, fetchFile: async () => ({ ok: false, json: async () => ({ detail: 'Layer missing' }) }) })).rejects.toThrow('Layer missing');
    expect(save).not.toHaveBeenCalled();
  });
});
