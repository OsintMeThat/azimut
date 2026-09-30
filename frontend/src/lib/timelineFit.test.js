import { describe, expect, it } from 'vitest';
import { fitBands, fitSlots, fitTicks, overviewNeeded } from './timelineFit.js';

describe('names that fit the axis', () => {
  it('leaves out a tick name that would land on the one before', () => {
    const ticks = [
      { at: 1, left: 10, label: '12:00' },
      { at: 2, left: 88, label: '21:00' },
      // past 94% the name hangs to the left of its line, onto 21:00
      { at: 3, left: 96, label: '00:00' },
    ];
    expect(fitTicks(ticks, 800).map((tick) => tick.label)).toEqual(['12:00', '21:00', '']);
    // on a wide ruler the same three are far enough apart
    expect(fitTicks(ticks, 4000).map((tick) => tick.label)).toEqual(['12:00', '21:00', '00:00']);
    // the tick itself stays, only its name goes
    expect(fitTicks(ticks, 800)).toHaveLength(3);
  });

  it('shortens a band cut by the window, then drops its name', () => {
    const bands = [
      { left: 0, width: 5, label: '21 Jun 2023' },
      { left: 5, width: 31, label: '22 Jun 2023' },
      { left: 36, width: 2, label: '23 Jun 2023' },
    ];
    expect(fitBands(bands, 1000).map((band) => band.label)).toEqual(['21 Jun', '22 Jun 2023', '']);
  });

  it('leaves out an overview name that would run into the one before', () => {
    // the strip read "17:00 · 22 Jun20:00"
    const slots = [
      { key: 'a', left: 0, width: 5, label: '17:00 · 22 Jun', anchor: 'start' },
      { key: 'b', left: 5, width: 5, label: '20:00' },
      { key: 'c', left: 50, width: 5, label: '02:00' },
      { key: 'd', left: 55, width: 5, label: '' },
    ];
    expect(fitSlots(slots, 800).map((slot) => slot.label)).toEqual(['17:00 · 22 Jun', '', '02:00', '']);
    // a name may run past its own narrow slot as long as it clears its neighbours
    const days = Array.from({ length: 31 }, (_, index) => ({
      key: String(index), left: index * 3.2, width: 3.2, label: index % 7 === 0 ? `${index + 1} Mar` : '',
    }));
    expect(fitSlots(days, 800).filter((slot) => slot.label)).toHaveLength(5);
  });

  it('shows the whole-case strip only once the window leaves part of the case out', () => {
    const extent = { from: '2023-06-22T17:07:16Z', to: '2023-06-23T00:00:00Z' };
    const all = { start: Date.parse('2023-06-21T00:00:00Z'), end: Date.parse('2023-06-25T00:00:00Z') };
    const zoomed = { start: Date.parse('2023-06-22T12:00:00Z'), end: Date.parse('2023-06-22T20:00:00Z') };
    expect(overviewNeeded(extent, all)).toBe(false);
    expect(overviewNeeded(extent, zoomed)).toBe(true);
    expect(overviewNeeded(null, all)).toBe(false);
    expect(overviewNeeded(extent, null)).toBe(false);
  });
});
