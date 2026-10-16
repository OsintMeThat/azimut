import { describe, expect, it } from 'vitest';
import { backChoices, backOf, defaultWeight, wordControls, wordsOf, wordsPatch } from './words.js';

const theme = { paper: '#ffffff', ink: '#111111', accent: '#c8102e' };

describe('the words of a plate\'s elements', () => {
  it('offers every kind that writes the same controls, as far as they apply', () => {
    expect(wordControls({ kind: 'zone' })).toEqual(['size', 'font', 'weight', 'style', 'colour', 'back']);
    expect(wordControls({ kind: 'text' })).toEqual(['size', 'font', 'weight', 'style', 'colour', 'back']);
    expect(wordControls({ kind: 'label', style: 'plain' })).toContain('back');
    // a bubble is its own backing, set with its look
    expect(wordControls({ kind: 'label', style: 'bubble' })).not.toContain('back');
    expect(wordControls({ kind: 'legend' })).toEqual(['size', 'font', 'colour', 'back']);
    expect(wordControls({ kind: 'brand' })).toEqual(['font', 'colour']);
    expect(wordControls({ kind: 'image' })).toEqual([]);
  });

  it('reads words on the ground as they always were drawn: bold, in their line\'s colour, on a halo', () => {
    expect(wordsOf({ kind: 'zone', colour: '#00aa00' }, theme)).toMatchObject({ weight: 700, colour: '#00aa00', back: 'halo', size: 8 });
    expect(wordsOf({ kind: 'arrow' }, theme)).toMatchObject({ colour: '#c8102e', back: 'halo' });
    expect(defaultWeight('label')).toBe(600);
    expect(wordsOf({ kind: 'text' }, theme)).toMatchObject({ weight: 400, colour: '#111111', back: 'none' });
  });

  it('writes each setting where the kind keeps it', () => {
    // a zone's colour paints its area: its words take theirs from ink
    expect(wordsPatch({ kind: 'zone' }, 'colour', '#123456', theme)).toEqual({ ink: '#123456' });
    expect(wordsPatch({ kind: 'text' }, 'colour', '#123456', theme)).toEqual({ colour: '#123456' });
    expect(wordsPatch({ kind: 'zone' }, 'back', 'box', theme)).toEqual({ back: 'box', fill: '#ffffff' });
    expect(wordsPatch({ kind: 'zone' }, 'back', 'halo', theme)).toEqual({ back: '' });
    expect(wordsPatch({ kind: 'text' }, 'back', 'halo', theme)).toEqual({ fill: null, halo: true });
    expect(wordsPatch({ kind: 'text' }, 'back', 'box', theme)).toEqual({ fill: '#ffffff', halo: false });
    expect(wordsPatch({ kind: 'credits' }, 'back', 'band', theme)).toEqual({ back: '', fill: null });
    expect(wordsPatch({ kind: 'label', style: 'plain' }, 'back', 'none', theme)).toEqual({ back: 'none' });
    expect(wordsPatch({ kind: 'legend' }, 'back', 'none', theme)).toEqual({ fill: null });
    expect(wordsPatch({ kind: 'line' }, 'font', '', theme)).toEqual({ font: null });
  });

  it('says what stands behind the words, each kind its own choices', () => {
    expect(backOf({ kind: 'credits' })).toBe('band');
    expect(backOf({ kind: 'credits', back: 'none' })).toBe('none');
    expect(backOf({ kind: 'video' })).toBe('box');
    expect(backOf({ kind: 'label', back: 'none' })).toBe('none');
    expect(backChoices('measure').map(([value]) => value)).toEqual(['halo', 'none', 'box']);
    expect(backChoices('table').map(([value]) => value)).toEqual(['none', 'box']);
  });
});
