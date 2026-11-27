import { describe, expect, it } from 'vitest';
import { MENU_ITEMS, PAGES, JOURNEYS } from './guide.js';
import { GUIDE_SEARCH_MIN, searchGuide, trailTo } from './guideSearch.js';

const titles = (query, limit) => searchGuide(query, limit).map((hit) => hit.title);

describe('searching the guide', () => {
  it('finds a tip by its words and opens on its page', () => {
    const [hit] = searchGuide('share a case');
    expect(hit).toMatchObject({ title: 'Share a case', where: 'Start here · tip', place: { item: 'start', path: [] } });
  });

  it('finds a number on a screen another number opens, with the way to it and the number to light', () => {
    const align = searchGuide('align').find((hit) => hit.title === 'Align');
    expect(align.where).toBe('Satellite › Tools');
    expect(align.place).toEqual({ item: 'map', tool: 'satellite', path: ['sat.tools'], mark: 'map.align-tool' });
    // one screen further, the alignment's own panel
    const deeper = searchGuide('align').find((hit) => hit.title === 'The alignment');
    expect(deeper.place.path).toEqual(['sat.tools', 'map.align-tool']);
  });

  it('finds a journey step and opens the journey on it', () => {
    const [hit] = searchGuide('camera spot');
    const journey = JOURNEYS.find((one) => one.id === 'geolocate');
    expect(hit.place).toEqual({ item: 'journey:geolocate', step: journey.steps.findIndex((step) => step.id === 'spot') });
  });

  it('finds a shortcut and a fix on their own pages', () => {
    expect(searchGuide('grid cell')[0].place).toEqual({ item: 'shortcuts' });
    expect(searchGuide('needs a login').some((hit) => hit.place.item === 'trouble')).toBe(true);
  });

  it('wants every word, reads past a question’s small ones, and ranks titles first', () => {
    expect(titles('align sun')).not.toContain('Align');
    expect(titles('when was this taken').length).toBeGreaterThan(0);
    expect(titles('imagery dates')[0]).toBe('Imagery dates');
  });

  it('reads nothing below its fewest letters', () => {
    expect(GUIDE_SEARCH_MIN).toBe(2);
    expect(searchGuide('a')).toEqual([]);
    expect(searchGuide('  ')).toEqual([]);
  });

  it('only ever opens places the guide has, with every screen on the way and the number lit there', () => {
    // a word nearly every row holds walks most of the index
    const hits = [...searchGuide('the', 5000), ...searchGuide('and', 5000), ...searchGuide('press', 5000)];
    expect(hits.length).toBeGreaterThan(300);
    for (const { place, title } of hits) {
      const entry = MENU_ITEMS.find((one) => one.id === place.item);
      expect(entry, `${title}: ${place.item}`).toBeDefined();
      if (entry.kind === 'journey') {
        const journey = JOURNEYS.find((one) => `journey:${one.id}` === place.item);
        expect(place.step).toBeLessThan(journey.steps.length);
        continue;
      }
      if (place.tool) expect(entry.tools).toContain(place.tool);
      const page = place.tool ?? place.item;
      const trail = trailTo(page, place.path ?? []);
      expect(trail, `${title}: ${place.path}`).toHaveLength(place.path?.length ?? 0);
      if (place.mark) {
        const marks = trail.at(-1)?.marks ?? PAGES[page].marks;
        expect(marks.map((mark) => mark.anchor), title).toContain(place.mark);
      }
    }
  });
});

describe('the way to a number’s screen', () => {
  it('walks the screens the numbers open, and stops where one opens none', () => {
    expect(trailTo('satellite', ['sat.tools', 'map.align-tool']).map((screen) => screen.from)).toEqual(['Tools', 'Align']);
    expect(trailTo('satellite', ['sat.search'])).toEqual([]);
    expect(trailTo('nowhere', ['sat.tools'])).toEqual([]);
  });
});
