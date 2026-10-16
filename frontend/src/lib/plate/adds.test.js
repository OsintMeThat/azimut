import { describe, expect, it } from 'vitest';
import { ADDS, findAdds } from './adds.js';

const kinds = (groups) => groups.flatMap((group) => group.items.map(([kind]) => kind));

describe('what can be added to a plate', () => {
  it('names each kind once', () => {
    const all = kinds(ADDS);
    expect(new Set(all).size).toBe(all.length);
  });

  it('offers everything for no word', () => {
    expect(findAdds('')).toBe(ADDS);
    expect(findAdds('   ')).toBe(ADDS);
  });

  it('finds an element by its name, the start of a word, or what it is often called', () => {
    expect(kinds(findAdds('arr'))).toEqual(['arrow', 'north']);
    expect(kinds(findAdds('title'))).toEqual(['note', 'text']);
    expect(kinds(findAdds('photo'))).toEqual(['image']);
    expect(kinds(findAdds('QR'))).toEqual(['qr']);
  });

  it('reads every word, accents and capitals aside', () => {
    expect(kinds(findAdds('map text'))).toEqual(['note']);
    expect(kinds(findAdds('Vidéo'))).toEqual(['video']);
  });

  it('finds a whole group by its title, and drops the groups left empty', () => {
    const found = findAdds('signing');
    expect(found.map((group) => group.title)).toEqual(['Signing']);
    expect(kinds(found)).toEqual(['signature', 'brand']);
    expect(findAdds('zzz')).toEqual([]);
  });
});
