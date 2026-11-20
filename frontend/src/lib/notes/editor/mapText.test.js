import { describe, expect, it } from 'vitest';
import {
  aboutArea, areaKm2, fitView, frameOf, readMap, stepOf, stepText, viewBounds, viewText, withMapSettings,
} from './mapText.js';

/**
 * A map's block as text (`engine/notes_maps.py` reads the same lines): each setting the card
 * writes is one line where the engine writes it, every other line kept as it was.
 */

const OLD = [
  '::: map', 'title: The front', 'layer: Front line', 'layer: Vehicles', 'proofs: 2026-10-19..2026-11-02', 'ground: e_c76d8fac71',
  'detail: e_893ad279dc', 'view: 12.73976, 43.51350, 12.05', ':::',
].join('\n');

describe('a map block read', () => {
  it('reads an old block as it was, every setting at its default', () => {
    const map = readMap(OLD);
    expect(map).toMatchObject({ title: 'The front', layers: ['Front line', 'Vehicles'], proofs: '2026-10-19..2026-11-02',
      ground: 'e_c76d8fac71', details: ['e_893ad279dc'], view: [12.73976, 43.5135, 12.05], base: '', hidden: [], colours: {},
      labels: '', crowds: '', north: '', scale: '', frame: null, timeline: '', opensOn: '', speed: '', card: null, size: '', legend: '', steps: [] });
  });

  it('reads every setting, a layer’s colour by its last “=”, a card that shows nothing, its steps in order', () => {
    const map = readMap(['::: map', 'layer: A = B', 'base: Dark', 'hide: A = B', 'colour: A = B = #D55E00', 'proof points: filmed',
      'labels: off', 'crowds: 8', 'north: on', 'scale: on', 'frame: 43.4, 12.6, 43.6, 12.8', 'timeline: off', 'opens on: 2026-10-21',
      'speed: fast', 'card: none', 'size: half', 'legend: folded', 'step: 2026-10-21 | Quay | 12.7, 43.5, 13 | e_abc | Words | more',
      'step: | Only a name', 'step: not a day', ':::'].join('\n'));
    expect(map).toMatchObject({ base: 'dark', hidden: ['A = B'], colours: { 'A = B': '#d55e00' }, proofPoints: 'filmed', labels: 'off',
      crowds: '8', north: 'on', scale: 'on', frame: [43.4, 12.6, 43.6, 12.8], timeline: 'off', opensOn: '2026-10-21', speed: 'fast',
      card: [], size: 'half', legend: 'folded' });
    expect(map.steps).toEqual([
      { day: '2026-10-21', label: 'Quay', view: [12.7, 43.5, 13], proof: 'e_abc', words: 'Words | more' },
      { day: '', label: 'Only a name', view: null, proof: '', words: '' },
    ]);
  });

  it('writes a step as the engine does, its empty tail left off', () => {
    expect(stepText({ day: '2026-10-21', label: '', view: [12.7377, 43.50166, 14.05], proof: 'e_ac82e73408', words: 'Seen  there.' }))
      .toBe('2026-10-21 |  | 12.73770, 43.50166, 14.05 | e_ac82e73408 | Seen there.');
    expect(stepText({ day: '', label: 'Whole map', view: null, proof: '', words: '' })).toBe(' | Whole map');
    expect(stepOf('2026-10-21 |  | 12.73770, 43.50166, 14.05 | e_ac82e73408 | Seen there.').view).toEqual([12.7377, 43.50166, 14.05]);
    expect(frameOf('43.6, 12.6, 43.4, 12.8')).toBeNull();
  });
});

describe('a setting written', () => {
  it('goes after the view, in the engine’s order, every other line kept', () => {
    const once = withMapSettings(OLD, { base: 'map' });
    expect(once.split('\n')).toEqual([...OLD.split('\n').slice(0, -1), 'base: map', ':::']);
    const twice = withMapSettings(once, { north: 'on', hide: ['Vehicles'] });
    expect(twice.split('\n').slice(-4)).toEqual(['base: map', 'hide: Vehicles', 'north: on', ':::']);
    // a setting already written keeps its line; '' takes it out
    expect(withMapSettings(twice, { base: 'dark' }).split('\n').slice(-4)).toEqual(['base: dark', 'hide: Vehicles', 'north: on', ':::']);
    expect(withMapSettings(twice, { base: '' })).toBe(withMapSettings(OLD, { north: 'on', hide: ['Vehicles'] }));
  });

  it('replaces every line of a key written many times where its first stood, and keeps what it cannot read', () => {
    const source = ['::: map', 'title: T', '<!-- a note to self -->', 'layer: A', 'what: is this', 'layer: B', 'view: 1, 2, 3', ':::'].join('\n');
    expect(withMapSettings(source, { layer: ['A', 'B', 'C'] }).split('\n'))
      .toEqual(['::: map', 'title: T', '<!-- a note to self -->', 'layer: A', 'layer: B', 'layer: C', 'what: is this', 'view: 1, 2, 3', ':::']);
    expect(withMapSettings(source, { layer: [] }).split('\n'))
      .toEqual(['::: map', 'title: T', '<!-- a note to self -->', 'what: is this', 'view: 1, 2, 3', ':::']);
    // a line before the view goes before it, the steps last
    expect(withMapSettings(source, { ground: 'e_g1', step: [' | Quay'] }).split('\n').slice(-5))
      .toEqual(['layer: B', 'ground: e_g1', 'view: 1, 2, 3', 'step: | Quay', ':::']);
  });

  it('writes the imagery after the base and the bounds after the frame, as the engine does, and a view as its line does', () => {
    const framed = withMapSettings(OLD, { frame: '43.40000, 12.60000, 43.60000, 12.80000', north: 'on', base: 'map' });
    const both = withMapSettings(framed, { bounds: 'ground', imagery: 'Sentinel' });
    expect(both.split('\n').slice(-7)).toEqual(['view: 12.73976, 43.51350, 12.05', 'base: map', 'imagery: Sentinel', 'north: on',
      'frame: 43.40000, 12.60000, 43.60000, 12.80000', 'bounds: ground', ':::']);
    expect(readMap(both)).toMatchObject({ imagery: 'sentinel', bounds: 'ground' });
    expect(readMap(OLD)).toMatchObject({ imagery: '', bounds: '' });
    expect(viewText([12.7, 43.5, 14.4123])).toBe('12.70000, 43.50000, 14.41');
  });

  it('leaves a source that is no map block as it is', () => {
    expect(withMapSettings('::: chart\nkind: bars\n:::', { base: 'map' })).toBe('::: chart\nkind: bars\n:::');
  });
});

describe('the map’s own square', () => {
  it('fits a box in the frame a step looks through, and reads that frame back', () => {
    const box = [43.45, 12.70, 43.55, 12.76];
    const view = fitView(box);
    const [west, south, east, north] = viewBounds(view);
    expect(west).toBeLessThanOrEqual(43.45 + 1e-3);
    expect(east).toBeGreaterThanOrEqual(43.55 - 1e-3);
    expect(south).toBeLessThanOrEqual(12.70 + 1e-3);
    expect(north).toBeGreaterThanOrEqual(12.76 - 1e-3);
  });

  it('says an outline’s size the way it is written on a map: about, and round', () => {
    const square = [[43.45, 12.7], [43.4855, 12.7], [43.4855, 12.7347], [43.45, 12.7347]];
    expect(areaKm2(square)).toBeGreaterThan(14);
    expect(areaKm2(square)).toBeLessThan(16);
    expect(aboutArea(areaKm2(square))).toBe('about 15 km²');
    expect(aboutArea(0.04)).toBe('about 40,000 m²');
    expect(aboutArea(3.14)).toBe('about 3.1 km²');
    expect(aboutArea(236)).toBe('about 235 km²');
    expect(aboutArea(0)).toBe('');
  });
});
