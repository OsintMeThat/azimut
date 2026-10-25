import { describe, expect, it, vi } from 'vitest';
import { createLayerPalette } from './layerPalette.svelte.js';

describe('the case palette', () => {
  it('reads the case once, names colours whatever their case, and keeps what a save answers', async () => {
    const api = { get: vi.fn(async () => ({ colours: [{ name: 'Side A', colour: '#0072b2' }] })),
      put: vi.fn(async () => ({ colours: [{ name: 'Ours', colour: '#0072b2' }] })) };
    const palette = createLayerPalette({ api });
    palette.load('c1'); palette.load('c1');
    await Promise.resolve(); await Promise.resolve();
    expect(api.get).toHaveBeenCalledOnce();
    expect(palette.nameOf('#0072B2')).toBe('Side A');
    expect(palette.nameOf('#d55e00')).toBe('');
    await palette.save('c1', [{ name: 'Ours', colour: '#0072b2' }]);
    expect(api.put).toHaveBeenCalledWith('/api/cases/c1/layer-palette', { colours: [{ name: 'Ours', colour: '#0072b2' }] });
    expect(palette.nameOf('#0072b2')).toBe('Ours');
  });

  it('names icons beside colours, and keeps them through a save that leaves them out', async () => {
    const api = { get: vi.fn(async () => ({ colours: [], icons: [{ name: 'Strike', key: 'badge-explosion' }] })),
      put: vi.fn(async (path, body) => ({ colours: body.colours, ...(body.icons ? { icons: body.icons } : { icons: [{ name: 'Strike', key: 'badge-explosion' }] }) })) };
    const palette = createLayerPalette({ api });
    palette.load('c2');
    await Promise.resolve(); await Promise.resolve();
    expect(palette.iconNameOf('badge-explosion')).toBe('Strike');
    expect(palette.iconNameOf('flag')).toBe('');
    await palette.save('c2', [{ name: 'Side A', colour: '#0072b2' }]);
    expect(api.put).toHaveBeenLastCalledWith('/api/cases/c2/layer-palette', { colours: [{ name: 'Side A', colour: '#0072b2' }] });
    expect(palette.iconNameOf('badge-explosion')).toBe('Strike');
    await palette.save('c2', [], [{ name: 'Ours', key: 'flag' }]);
    expect(api.put).toHaveBeenLastCalledWith('/api/cases/c2/layer-palette', { colours: [], icons: [{ name: 'Ours', key: 'flag' }] });
    expect(palette.iconNameOf('flag')).toBe('Ours');
    expect(palette.iconNameOf('badge-explosion')).toBe('');
  });
});
