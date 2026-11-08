import { describe, expect, it } from 'vitest';
import { normalizeProofStyle } from './composer.js';
import { PROOF_STARTERS, defaultProofTemplate, proofTemplateSummary, starterData } from './proofTemplates.js';

describe('the starts a proof template is picked from', () => {
  it('opens on a blank one, then covers the free and the grid ways of laying a proof out', () => {
    expect(PROOF_STARTERS[0].id).toBe('blank');
    const looks = PROOF_STARTERS.map((starter) => starter.data);
    expect(looks.some((look) => look.layout === 'free' && look.captionsEnabled === false)).toBe(true);
    expect(looks.some((look) => look.layout === 'grid' && look.footerCoords && look.captionsEnabled)).toBe(true);
    expect(looks.some((look) => look.panelDirection === 'vertical' && look.layout === 'grid')).toBe(true);
    expect(looks.some((look) => look.bg === '#ffffff')).toBe(true);
    expect(looks.some((look) => look.footerEnabled === false)).toBe(true);
    expect(new Set(PROOF_STARTERS.map((starter) => starter.id)).size).toBe(PROOF_STARTERS.length);
  });

  it('states every key a template can hold, the scene time and the credits included', () => {
    for (const starter of PROOF_STARTERS) {
      expect(normalizeProofStyle(starter.data), starter.id).toEqual(starter.data);
      expect(typeof starter.data.sceneBadge, starter.id).toBe('boolean');
      expect(typeof starter.data.footerCredits, starter.id).toBe('boolean');
      // off unless the analyst asks for it
      expect(starter.data.azimutMark, starter.id).toBeNull();
    }
  });

  it('names nobody: a logo and a handle are slots, the footer says what the app says', () => {
    for (const starter of PROOF_STARTERS) {
      expect(JSON.stringify(starter.data), starter.id).not.toMatch(/@\w/);
      expect(starter.data.footer, starter.id).toBe('');
      expect(starter.said.length, starter.id).toBeLessThan(90);
    }
  });

  it('hands out a copy, so editing one never changes the start', () => {
    const copy = starterData('free');
    copy.bg = '#123456';
    copy.space.pad = 99;
    expect(starterData('free').bg).toBe('#000000');
    expect(starterData('free').space.pad).toBe(15);
    expect(starterData('nothing-like-it')).toEqual(starterData('blank'));
  });
});

describe('the template New proof starts with', () => {
  const templates = [{ id: 'a', name: 'A', data: {} }, { id: 'b', name: 'B', data: {} }];

  it('is the one Settings marks', () => {
    expect(defaultProofTemplate(templates, 'b')).toBe(templates[1]);
  });

  it('is none when none is marked, or when the marked one was deleted', () => {
    expect(defaultProofTemplate(templates, '')).toBeNull();
    expect(defaultProofTemplate(templates, 'gone')).toBeNull();
    expect(defaultProofTemplate(undefined, 'a')).toBeNull();
  });
});

describe('a template in a few words', () => {
  it('says how its pictures sit and its typeface', () => {
    expect(proofTemplateSummary({ layout: 'free', font: 'barlow' })).toBe('Free layout · Barlow Condensed');
    expect(proofTemplateSummary({ panelDirection: 'vertical', font: 'inter' })).toBe('Stacked · Inter');
    expect(proofTemplateSummary({})).toBe("Side by side · This computer's font");
  });
});
