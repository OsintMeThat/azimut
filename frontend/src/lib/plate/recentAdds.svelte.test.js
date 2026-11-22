// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { RECENT_ADDS, keepRecentAdd, readRecentAdds, recentAdds } from './recentAdds.svelte.js';

beforeEach(() => {
  localStorage.clear();
  recentAdds.list = [];
});

describe('the tiles of Add picked lately', () => {
  it('reads nothing from nothing or garbage', () => {
    for (const raw of [null, '', '{', '{}', '"map"', 42, '[3, null]']) expect(readRecentAdds(raw)).toEqual([]);
  });

  it('keeps only the tiles Add has, once each, in order, six at most', () => {
    expect(readRecentAdds('["label","gone","label",7,"map"]')).toEqual(['label', 'map']);
    const many = ['map', 'label', 'arrow', 'zone', 'text', 'legend', 'scale', 'north'];
    expect(RECENT_ADDS).toBe(6);
    expect(readRecentAdds(JSON.stringify(many))).toEqual(many.slice(0, 6));
  });

  it('puts the tile picked first, once, and remembers it', () => {
    keepRecentAdd('label');
    keepRecentAdd('arrow');
    keepRecentAdd('label');
    expect(recentAdds.list).toEqual(['label', 'arrow']);
    expect(readRecentAdds(localStorage.getItem('azimut:plateRecentAdds'))).toEqual(['label', 'arrow']);
  });

  it('drops the oldest past six, and keeps no tile Add does not have', () => {
    for (const kind of ['map', 'label', 'arrow', 'zone', 'text', 'legend', 'scale']) keepRecentAdd(kind);
    expect(recentAdds.list).toEqual(['scale', 'legend', 'text', 'zone', 'arrow', 'label']);
    keepRecentAdd('nothing');
    keepRecentAdd(undefined);
    expect(recentAdds.list).toEqual(['scale', 'legend', 'text', 'zone', 'arrow', 'label']);
  });
});
