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
});
