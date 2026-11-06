import { describe, expect, it } from 'vitest';
import { SIDE_TABS, needsWords, proofNeeds, shownTab, sideTabs } from './sideTabs.js';

describe('Geo Proof\'s side tabs', () => {
  it('run Proof, Scene, Layout and Style, each saying what it holds in one clause', () => {
    expect(SIDE_TABS.map((one) => one.label)).toEqual(['Proof', 'Scene', 'Layout', 'Style']);
    for (const { title } of SIDE_TABS) {
      expect(title).toMatch(/^[A-Z]/);
      expect(title).not.toMatch(/\.$|—/);
      expect(title.length).toBeLessThanOrEqual(120);
    }
  });

  it('show Scene only for a proof that rests on a video', () => {
    expect(sideTabs(false).map((one) => one.id)).toEqual(['proof', 'layout', 'style']);
    expect(sideTabs(true).map((one) => one.id)).toEqual(['proof', 'scene', 'layout', 'style']);
  });

  it('fall back from Scene to Layout once the video is gone, and keep any other tab', () => {
    expect(shownTab('scene', false)).toBe('layout');
    expect(shownTab('scene', true)).toBe('scene');
    for (const id of ['proof', 'layout', 'style']) expect(shownTab(id, false)).toBe(id);
  });
});

describe('what the Proof tab still needs', () => {
  it('names the blanks its fields mark, in the order they stand', () => {
    expect(proofNeeds({ coords: false, source: false, when: '' })).toEqual(['coordinates', 'a source']);
    expect(proofNeeds({ coords: true, source: false, when: '' })).toEqual(['a source']);
    expect(proofNeeds({ coords: true, source: true, when: '' })).toEqual([]);
  });

  it('counts a date the save would refuse, never a date left empty', () => {
    expect(proofNeeds({ coords: true, source: true, when: '2025-10-24' })).toEqual([]);
    expect(proofNeeds({ coords: true, source: true, when: '24/10/2025' })).toEqual([]);
    expect(proofNeeds({ coords: true, source: true, when: 'last tuesday-ish' })).toEqual(['a date it can read']);
  });

  it('says them in one clause', () => {
    expect(needsWords([])).toBe('');
    expect(needsWords(['coordinates'])).toBe('Still needs coordinates');
    expect(needsWords(['coordinates', 'a source'])).toBe('Still needs coordinates and a source');
    expect(needsWords(['coordinates', 'a source', 'a date it can read'])).toBe(
      'Still needs coordinates, a source and a date it can read',
    );
  });
});
