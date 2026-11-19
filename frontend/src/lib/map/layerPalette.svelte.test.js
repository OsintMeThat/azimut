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

  it('keeps the colours a chart chose, after the names the case holds, a name it holds keeping its colour', async () => {
    const api = { get: vi.fn(async () => ({ colours: [{ name: 'UAE', colour: '#eb6834' }] })),
      put: vi.fn(async (path, body) => ({ colours: body.colours })) };
    const palette = createLayerPalette({ api });
    palette.load('c3');
    await Promise.resolve(); await Promise.resolve();
    const kept = await palette.keep('c3', [{ value: 'uae', colour: '#2A78D6' }, { value: 'USA', colour: '#6F6D66' }, { value: ' ', colour: '#000000' }]);
    expect(api.put).toHaveBeenLastCalledWith('/api/cases/c3/layer-palette',
      { colours: [{ name: 'UAE', colour: '#eb6834' }, { name: 'USA', colour: '#6f6d66' }] });
    expect(palette.nameOf('#6f6d66')).toBe('USA');
    // what it kept before, for an Undo
    expect(kept.before).toEqual([{ name: 'UAE', colour: '#eb6834' }]);
    expect(api.get).toHaveBeenCalledOnce();
  });

  it('leaves out a name too long for the case, a colour it names already, and the colours past the ones it names', async () => {
    const held = Array.from({ length: 10 }, (_, at) => ({ name: `Side ${at}`, colour: '#0072b2' }));
    const api = { get: vi.fn(async () => ({ colours: held })), put: vi.fn(async (path, body) => ({ colours: body.colours })) };
    const palette = createLayerPalette({ api });
    const long = 'set aside (#34 a pickup, #37 not in the owner’s lists)';
    const kept = await palette.keep('c6', [{ value: long, colour: '#a9a79f' }, { value: 'Confirmed', colour: '#184f95' },
      { value: 'Almost sure, identified', colour: '#184F95' }, { value: 'Almost sure', colour: '#3987e5' }, { value: 'Strong doubt', colour: '#86b6ef' }]);
    expect(api.put.mock.calls.at(-1)[1].colours.map((entry) => entry.name)).toEqual([...held.map((entry) => entry.name), 'Confirmed', 'Almost sure']);
    // too long, a colour already named, past the twelve
    expect(kept.left).toEqual([long, 'Almost sure, identified', 'Strong doubt']);
  });

  it('reads a case’s palette before keeping colours in it, never writing another case’s over it', async () => {
    const api = { get: vi.fn(async (path) => ({ colours: path.includes('/c5/') ? [{ name: 'Ours', colour: '#009e73' }] : [{ name: 'Theirs', colour: '#d55e00' }] })),
      put: vi.fn(async (path, body) => ({ colours: body.colours })) };
    const palette = createLayerPalette({ api });
    palette.load('c4');
    await Promise.resolve(); await Promise.resolve();
    const kept = await palette.keep('c5', [{ value: 'Confirmed', colour: '#184F95' }]);
    expect(api.get).toHaveBeenLastCalledWith('/api/cases/c5/layer-palette');
    expect(api.put).toHaveBeenLastCalledWith('/api/cases/c5/layer-palette',
      { colours: [{ name: 'Ours', colour: '#009e73' }, { name: 'Confirmed', colour: '#184f95' }] });
    expect(kept.before).toEqual([{ name: 'Ours', colour: '#009e73' }]);
  });
});
