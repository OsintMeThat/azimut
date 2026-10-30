// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); vi.resetModules(); });
const load = async () => (await import('./recentColours.svelte.js')).recentColours;

describe('the colours picked lately', () => {
  it('puts the last first, once each, eight at most, and keeps them in this browser', async () => {
    const recent = await load();
    for (let index = 0; index < 10; index++) recent.keep(`#00000${index}`);
    recent.keep('#000005'.toUpperCase());
    expect(recent.list).toHaveLength(8);
    expect(recent.list.slice(0, 2)).toEqual(['#000005', '#000009']);
    recent.keep('not a colour');
    expect(recent.list[0]).toBe('#000005');
    expect(JSON.parse(localStorage.getItem('azimut:recent-colours'))).toEqual(recent.list);
    expect((await (vi.resetModules(), load())).list).toEqual(recent.list);
  });

  it("starts from the plate's own list where nothing is shared yet", async () => {
    localStorage.setItem('azimut:plate-colours', JSON.stringify(['#D55E00', 'nonsense']));
    expect((await load()).list).toEqual(['#d55e00']);
  });
});
