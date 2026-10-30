import { describe, expect, it } from 'vitest';
import { ROLE_LIST, fillProperties, roleLabel, roleLook, withRole } from './roles.js';

describe('what a layer stands for on a published map', () => {
  const theme = { accent: '#c8102e', ink: '#15181e' };

  it('holds ground in the accent in a full tint, claims it hatched, and contests it in amber, the colour of neither side', () => {
    expect(roleLook('held', theme)).toMatchObject({ colour: '#c8102e', fill: 'solid', dash: '' });
    expect(roleLook('claimed', theme)).toMatchObject({ colour: '#c8102e', fill: 'hatch', dash: 'dashed' });
    expect(roleLook('contested', theme)).toMatchObject({ colour: '#e69f00', fill: 'hatch', dash: 'dotted' });
    expect(roleLook('line', theme)).toMatchObject({ colour: '#15181e', fill: 'none', stroke: 2 });
    expect(roleLook('events', theme)).toMatchObject({ colour: null, icons: 1.25 });
    expect(roleLook('context', theme)).toMatchObject({ colour: '#8a8f96', stroke: 0.75 });
  });

  it('sets the look of a layer on the plate in one press, and gives it back its own with none', () => {
    const entry = { name: 'front', hidden: ['Old'], stroke: 1.5, icons: 1 };
    const held = withRole(entry, 'claimed', theme);
    expect(held).toMatchObject({ name: 'front', hidden: ['Old'], role: 'claimed', colour: '#c8102e', fill: 'hatch' });
    expect(withRole(held, '', theme)).toMatchObject({ role: '', colour: null, fill: '', dash: '', stroke: 1 });
    expect(withRole(entry, 'nonsense', theme).role).toBe('');
    expect(ROLE_LIST.map(([id]) => roleLabel(id))).toEqual(['Held', 'Claimed', 'Contested', 'Front line', 'Events', 'Context']);
  });

  it('fills the area of a feature as its layer asks on the plate, or leaves it as its own', () => {
    expect(fillProperties('solid')).toEqual({ fill_opacity: 0.42, area_fill: '' });
    expect(fillProperties('hatch')).toEqual({ area_fill: 'hatch' });
    expect(fillProperties('none')).toEqual({ area_fill: 'none' });
    expect(fillProperties('')).toBeNull();
  });
});
