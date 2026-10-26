import { describe, expect, it } from 'vitest';
import { drawnStyle, splitPick, styleTarget, usedStyles, wornColours } from './layerStyle.js';

const groups = [
  { id: 'free', name: 'Sightings', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
  { id: 'one', name: 'Checkpoints', mode: 'uniform', colour: '#009e73', symbol: 'star' },
  { id: 'side', name: 'Side A', mode: 'colour', colour: '#cc79a7', symbol: 'flag' },
];
const point = (key, properties = {}) => ({ geometry: { type: 'Point' }, properties: { key, group: 'free', ...properties } });
const line = (key, properties = {}) => ({ geometry: { type: 'LineString' }, properties: { key, group: 'free', ...properties } });

describe('the style a feature is drawn in', () => {
  it('is its own, else its group’s colour, unless the group has one style', () => {
    expect(drawnStyle(point('a', { symbol: 'badge-tank', colour: '#d55e00' }), groups[0])).toEqual({ symbol: 'badge-tank', colour: '#d55e00' });
    expect(drawnStyle(point('a'), groups[0])).toEqual({ symbol: 'pin', colour: '#0072b2' });
    expect(drawnStyle(point('a', { symbol: 'badge-tank', colour: '#d55e00' }), groups[1])).toEqual({ symbol: 'star', colour: '#009e73' });
  });

  it('keeps its own icon in a group with one colour, in the group’s colour', () => {
    expect(drawnStyle(point('a', { group: 'side', symbol: 'badge-tank', colour: '#d55e00' }), groups[2])).toEqual({ symbol: 'badge-tank', colour: '#cc79a7' });
    expect(drawnStyle(point('a', { group: 'side', icon: 'aaaaaaaaaaaaaaaa' }), groups[2])).toEqual({ symbol: 'pin', colour: '#cc79a7', icon: 'aaaaaaaaaaaaaaaa' });
  });

  it('lists the styles a layer shows once each, markers and lines apart', () => {
    const features = [point('a', { symbol: 'flag', colour: '#D55E00' }), point('b', { symbol: 'flag', colour: '#d55e00' }),
      point('c', { group: 'one' }), line('d', { colour: '#cc79a7' })];
    expect(usedStyles(features, groups)).toEqual([{ symbol: 'flag', colour: '#D55E00' }, { symbol: 'star', colour: '#009e73' }]);
    expect(usedStyles(features, groups, { point: false })).toEqual([{ colour: '#cc79a7' }]);
    expect(usedStyles(features, groups, { limit: 1 })).toHaveLength(1);
  });

  it('lists every colour a layer is drawn in once, markers and lines together', () => {
    const features = [point('a', { colour: '#D55E00' }), line('b', { colour: '#f0e442' }), point('c', { group: 'one', colour: '#d55e00' }),
      line('d', { group: 'side' }), point('e', { colour: '#d55e00' })];
    expect(wornColours(features, groups)).toEqual(['#d55e00', '#f0e442', '#009e73', '#cc79a7']);
  });
});

describe('what the style button edits', () => {
  it('with nothing chosen, sets the next markers and the group they go into', () => {
    expect(styleTarget({ groups, into: 'free', draft: { symbol: 'flag', colour: '#d55e00' } }))
      .toMatchObject({ symbol: 'flag', colour: '#d55e00', point: true, mixed: false, group: 'free', uniform: null, note: '' });
    const target = styleTarget({ groups, into: 'one', draft: { symbol: 'flag', colour: '#d55e00' } });
    expect(target).toMatchObject({ symbol: 'star', colour: '#009e73', group: 'one' });
    expect(target.uniform.id).toBe('one');
    expect(target.note).toContain('restyles the whole group');
  });

  it('shows the chosen features’ style and says when they differ', () => {
    const same = styleTarget({ groups, chosen: [point('a', { symbol: 'flag', colour: '#d55e00' }), point('b', { symbol: 'flag', colour: '#D55E00' })] });
    expect(same).toMatchObject({ symbol: 'flag', point: true, mixed: false, group: 'free', uniform: null });
    expect(styleTarget({ groups, chosen: [point('a', { symbol: 'flag' }), point('b', { symbol: 'star' })] }).mixed).toBe(true);
    // a line beside a marker: the marker's icon shows, the line only weighs in by its colour
    expect(styleTarget({ groups, chosen: [line('l', { colour: '#0072b2' }), point('a', { symbol: 'flag' })] }))
      .toMatchObject({ symbol: 'flag', point: true, mixed: false });
    expect(styleTarget({ groups, chosen: [line('l')] }).point).toBe(false);
  });

  it('restyles a one-style group rather than features that would not change', () => {
    const target = styleTarget({ groups, chosen: [point('a', { group: 'one', symbol: 'flag' })] });
    expect(target).toMatchObject({ symbol: 'star', colour: '#009e73', group: 'one' });
    expect(target.uniform.id).toBe('one');
    const across = styleTarget({ groups, chosen: [point('a', { group: 'one' }), point('b')] });
    expect(across).toMatchObject({ group: '', uniform: null });
    expect(across.note).toBe('Features in a group with one style keep that style.');
  });

  it('recolours a one-colour group, its features keeping their icons', () => {
    const target = styleTarget({ groups, chosen: [point('a', { group: 'side', symbol: 'badge-tank', colour: '#d55e00' })] });
    expect(target).toMatchObject({ symbol: 'badge-tank', colour: '#cc79a7', group: 'side', uniform: null });
    expect(target.tinted.id).toBe('side');
    expect(target.note).toBe('Side A has one colour for all its features. A colour picked here recolours the whole group.');
    const next = styleTarget({ groups, into: 'side', draft: { symbol: 'flag', colour: '#d55e00' } });
    expect(next).toMatchObject({ symbol: 'flag', colour: '#cc79a7' });
    expect(next.tinted.id).toBe('side');
    expect(styleTarget({ groups, chosen: [point('a', { group: 'side' }), point('b')] }).note).toBe('Features in a group with one colour keep that colour.');
  });

  it('sends a colour alone to the group and an icon to the features', () => {
    expect(splitPick({ colour: '#d55e00' })).toEqual({ group: { colour: '#d55e00' }, own: {} });
    expect(splitPick({ symbol: 'flag', icon: '' })).toEqual({ group: {}, own: { symbol: 'flag', icon: '' } });
    // a style of the layer's own brings its icon, not a recolouring of the whole group
    expect(splitPick({ symbol: 'flag', icon: '', colour: '#d55e00' })).toEqual({ group: {}, own: { symbol: 'flag', icon: '' } });
  });
});
