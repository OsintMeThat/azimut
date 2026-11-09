import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  ABANDONED, GEOLOCATING, NEW, NO_PICTURE, PROGRESS, PROVED, SLIDE_CONTENT, SLIDE_LOOK, TODO,
  findTiles, neighbour, resumeAt, slideAfterDelete, slideStyle, slideTiles, switchPlan,
} from './proofSlides.js';
import { sceneList } from './scenes.js';

const proof = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name.replace(/-/g, ' '), moments: [], at: [], stated: false,
  png: `proofs/${name}.png`, thumb: `proofs/.thumbs/${name}.webp`, points: [], when: null, ...extra,
});
const draft = (id, extra = {}) => ({
  kind: 'draft', id, start: null, end: null, label: '', state: 'todo', captures: [], abandoned: null, ...extra,
});

/** A video with three proofs, a scene to prove, one being geolocated and one given up. */
const ANSWER = {
  video: 'media/clip.mp4',
  video_id: 'e_clip',
  scenes: [
    proof('road-bridge', { title: 'Road bridge', moments: [{ start: 30, end: 45 }], at: [31] }),
    draft('s1', { start: 50, end: 60, label: 'Water tower?' }),
    draft('s2', { start: 70, end: null, abandoned: { reason: 'too blurry' }, state: 'abandoned' }),
    proof('market', { title: 'Market', at: [80] }),
    draft('s3', { start: 90, end: 95, captures: ['captures/a.png', 'captures/b.png'], state: 'progress' }),
    proof('square', { title: 'Square', png: null, thumb: null, at: [100] }),
  ],
  geolocating: 's3',
  collages: [],
};

describe('the tiles of a strip', () => {
  it('come in clip order, in the colours Inspect gives them, the abandoned last', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: 'market', title: 'Market' });
    expect(tiles.map((t) => t.key)).toEqual(['proof:road-bridge', 's1', 'proof:market', 's3', 'proof:square', 's2']);
    // the colour each has on Inspect's bar, abandoned included
    const bar = sceneList(ANSWER.scenes, ANSWER.scenes.filter((s) => s.kind === 'draft'));
    for (const tile of tiles) expect(tile.color).toBe(bar.find((s) => s.key === tile.key).color);
    expect(tiles.map((t) => t.number)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('say what each scene is: proved, without a picture, to geolocate, gathering, being geolocated, given up', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: 'market', title: 'Market' }, {
      thumbOf: (path) => `media/.thumbs/${path.split('/').pop()}.webp`,
    });
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(by['proof:road-bridge']).toMatchObject({ state: PROVED, title: 'Road bridge', words: '0:30–0:45', thumb: 'proofs/.thumbs/road-bridge.webp' });
    expect(by['proof:market']).toMatchObject({ state: PROVED, words: 'Whole video', current: true });
    expect(by['proof:square']).toMatchObject({ state: NO_PICTURE, words: 'No picture yet', thumb: null });
    expect(by.s1).toMatchObject({ kind: 'draft', state: TODO, title: 'Water tower?', words: 'To geolocate', time: '0:50–1:00', thumb: null });
    // the scene geolocated now says so; its first capture is its picture
    expect(by.s3).toMatchObject({ state: GEOLOCATING, words: 'Geolocating', title: '1:30–1:35', thumb: 'media/.thumbs/a.png.webp' });
    expect(by.s2).toMatchObject({ state: ABANDONED, words: 'Abandoned', reason: 'too blurry', thumb: null });
  });

  it('mark a slide saved with no place yet, and send one given up on to the end, greyed', () => {
    const answer = {
      ...ANSWER,
      scenes: [
        proof('road-bridge', { title: 'Road bridge', moments: [{ start: 30, end: 45 }], state: PROGRESS }),
        proof('market', { title: 'Market', at: [80], state: 'abandoned', abandoned: { reason: 'no landmark' } }),
        proof('square', { title: 'Square', at: [100], state: PROVED, points: [{ lat: 1, lon: 2 }] }),
      ],
    };
    const tiles = slideTiles(answer, { started: true, name: 'square' });
    expect(tiles.map((t) => t.key)).toEqual(['proof:road-bridge', 'proof:square', 'proof:market']);
    const by = Object.fromEntries(tiles.map((t) => [t.key, t]));
    expect(by['proof:road-bridge']).toMatchObject({ state: PROVED, unplaced: true, words: 'No place yet' });
    expect(by['proof:market']).toMatchObject({ state: ABANDONED, unplaced: false, words: 'Abandoned', reason: 'no landmark' });
    expect(by['proof:square']).toMatchObject({ state: PROVED, unplaced: false, words: 'Whole video' });
  });

  it('count a scene\'s captures once nobody geolocates it', () => {
    const tiles = slideTiles({ ...ANSWER, geolocating: null }, { started: true, name: 'market' });
    expect(tiles.find((t) => t.key === 's3')).toMatchObject({ state: PROGRESS, words: '2 captures' });
  });

  it('never show a proof\'s full picture, only its thumbnail', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: 'market' });
    for (const tile of tiles) expect(tile.thumb ?? '').not.toMatch(/^proofs\/[^/]+\.png$/);
  });

  it('put a proof not saved yet in the place of the scene it was made from', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: null, title: 'Water tower', draft: 's1' });
    const at = tiles.findIndex((t) => t.current);
    expect(at).toBe(1);
    expect(tiles[at]).toMatchObject({ kind: 'new', state: NEW, title: 'Water tower', words: 'Not saved' });
    expect(tiles.some((t) => t.key === 's1')).toBe(false);
  });

  it('put a saved proof in the place of the scene it takes up, while the server still lists that scene', () => {
    // an older proof made by hand, its frames found in the scene, or one saved a moment ago
    const tiles = slideTiles(ANSWER, { started: true, name: 'market', title: 'Market', draft: 's1' });
    expect(tiles.map((t) => t.key)).toEqual(['proof:road-bridge', 'proof:market', 's3', 'proof:square', 's2']);
    const bar = sceneList(ANSWER.scenes, ANSWER.scenes.filter((s) => s.kind === 'draft'));
    expect(tiles[1]).toMatchObject({ kind: 'proof', name: 'market', current: true, color: bar.find((s) => s.key === 's1').color });
    const fresh = slideTiles(ANSWER, { started: true, name: 'fresh', title: 'Fresh', draft: 's1', thumb: 'proofs/.thumbs/fresh.webp' });
    expect(fresh[1]).toMatchObject({ key: 'proof:fresh', current: true, title: 'Fresh', thumb: 'proofs/.thumbs/fresh.webp' });
    expect(fresh.some((t) => t.key === 's1')).toBe(false);
    // a scene the server no longer lists leaves the proof where the server puts it
    expect(slideTiles(ANSWER, { started: true, name: 'market', draft: 's9' }).map((t) => t.key))
      .toEqual(['proof:road-bridge', 's1', 'proof:market', 's3', 'proof:square', 's2']);
  });

  it('add a new slide at the end of the live ones, before the abandoned', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: null, title: 'Proof 7' });
    expect(tiles.map((t) => t.key).slice(-2)).toEqual(['new', 's2']);
    expect(tiles.at(-2)).toMatchObject({ state: NEW, current: true });
  });

  it('hold a slide saved a moment ago before the server lists it, with the thumbnail its save answered', () => {
    const tiles = slideTiles(ANSWER, { started: true, name: 'fresh', title: 'Fresh', thumb: 'proofs/.thumbs/fresh.webp' });
    expect(tiles.at(-2)).toMatchObject({ key: 'proof:fresh', kind: 'proof', current: true, thumb: 'proofs/.thumbs/fresh.webp' });
  });

  it('mark the scene whose page is shown, with no proof open', () => {
    const tiles = slideTiles(ANSWER, { started: false, page: 's2' });
    expect(tiles.filter((t) => t.current).map((t) => t.key)).toEqual(['s2']);
  });

  it('read a video holding only this proof as one tile', () => {
    const lone = slideTiles({ video: 'v', scenes: [proof('market')] }, { started: true, name: 'market' });
    expect(lone).toHaveLength(1);
    expect(slideTiles({ video: 'v', scenes: [] }, { started: true, name: null, title: 'Proof 1' })).toHaveLength(1);
    expect(slideTiles(null, {})).toEqual([]);
  });
});

describe('the next and the previous slide', () => {
  const tiles = slideTiles(ANSWER, { started: true, name: 'market' });

  it('walk every tile, the drafts and the abandoned included, and stop at the ends', () => {
    expect(neighbour(tiles, 'proof:market', 1).key).toBe('s3');
    expect(neighbour(tiles, 'proof:market', -1).key).toBe('s1');
    expect(neighbour(tiles, 'proof:square', 1).key).toBe('s2');
    expect(neighbour(tiles, 's2', 1)).toBeNull();
    expect(neighbour(tiles, 'proof:road-bridge', -1)).toBeNull();
  });

  it('start from an end when no slide is shown', () => {
    expect(neighbour(tiles, 'nothing', 1).key).toBe('proof:road-bridge');
    expect(neighbour(tiles, 'nothing', -1).key).toBe('s2');
    expect(neighbour([], 'x', 1)).toBeNull();
  });
});

describe('where a delete goes', () => {
  const tiles = slideTiles(ANSWER, { started: true, name: 'market' });

  it('goes to the next proof of the video, past a scene still to prove', () => {
    expect(tiles.map((t) => t.key)).toEqual(['proof:road-bridge', 's1', 'proof:market', 's3', 'proof:square', 's2']);
    expect(slideAfterDelete(tiles, 'proof:market').key).toBe('proof:square');
    expect(slideAfterDelete(tiles, 'proof:road-bridge').key).toBe('proof:market');
  });

  it('goes back to the proof before when it was the last, and home when it was alone', () => {
    expect(slideAfterDelete(tiles, 'proof:square').key).toBe('proof:market');
    expect(slideAfterDelete(tiles.filter((t) => t.key === 'proof:market' || t.kind === 'draft'), 'proof:market')).toBeNull();
    expect(slideAfterDelete(tiles, 'gone')).toBeNull();
  });
});

describe('the list of slides', () => {
  const tiles = slideTiles(ANSWER, { started: true, name: 'market' });

  it('finds a slide by its title, its label, its time or what it is', () => {
    expect(findTiles(tiles, 'bridge').map((t) => t.key)).toEqual(['proof:road-bridge']);
    expect(findTiles(tiles, 'water').map((t) => t.key)).toEqual(['s1']);
    expect(findTiles(tiles, '1:30').map((t) => t.key)).toEqual(['s3']);
    expect(findTiles(tiles, 'blurry').map((t) => t.key)).toEqual(['s2']);
    expect(findTiles(tiles, '  ')).toHaveLength(tiles.length);
  });
});

describe('where a new scene starts in the player', () => {
  it('after the last moment proved, else the last frame a proof rests on', () => {
    expect(resumeAt(slideTiles(ANSWER, {}))).toBe(100);
    expect(resumeAt(slideTiles({ scenes: [proof('a', { moments: [{ start: 3, end: 9 }, { start: 20, end: null }] })] }, {}))).toBe(20);
    expect(resumeAt(slideTiles({ scenes: [draft('s1', { start: 5, end: 8 })] }, {}))).toBeNull();
  });
});

describe('what a new slide keeps of the one before it', () => {
  const composer = readFileSync(new URL('../tools/ProofComposer.svelte', import.meta.url), 'utf8');
  // the composer's document: every key of `const proof = $state({ ... })`
  const block = composer.slice(composer.indexOf('const proof = $state({'), composer.indexOf('\n  });', composer.indexOf('const proof = $state({')));
  const fields = [...block.replace(/\/\/[^\n]*/g, '').matchAll(/([A-Za-z]+):/g)].map((m) => m[1])
    .filter((key) => !['pad', 'gap', 'rowGap', 'coords', 'label', 'pov'].includes(key));

  it('classes every field of the composer\'s proof as look or content', () => {
    const classed = new Set([...SLIDE_LOOK, ...SLIDE_CONTENT]);
    for (const key of fields) expect(classed.has(key), `${key} is neither look nor content`).toBe(true);
    for (const key of classed) expect(fields, key).toContain(key);
    expect(SLIDE_LOOK.filter((key) => SLIDE_CONTENT.includes(key))).toEqual([]);
  });

  it('copies the look and nothing of the content', () => {
    const style = slideStyle({
      title: 'Road bridge', panels: [{ id: 'p1', row: 0 }, { id: 'p2', row: 1 }], pastes: [{ id: 'x' }], shapes: [{ id: 's' }],
      notes: { '#ff0000': 'impact' }, legendOrder: ['#ff0000'], points: [{ coords: '1, 2' }], sources: ['https://x'],
      material: ['media/a.mp4'], when: '2025-10-24', whenZone: 'Europe/Kyiv', description: 'A bridge',
      templateId: 'house', bg: '#101010', font: 'oxanium', fontBold: false, footer: 'By me', footerCredits: true,
      sceneBadge: true, footerCoords: true, signature: { anchor: 'tr', dx: 4, dy: 4, scale: 0.2, opacity: 0.8 },
      signatureText: null, palette: ['#ff0000', '#00ff00'], layout: 'grid', captionsEnabled: false,
    });
    expect(Object.keys(style).sort()).toEqual([...SLIDE_LOOK].sort());
    for (const key of SLIDE_CONTENT) expect(style, key).not.toHaveProperty(key);
    expect(style).toMatchObject({
      templateId: 'house', bg: '#101010', font: 'oxanium', fontBold: false, footer: 'By me', footerCredits: true,
      sceneBadge: true, footerCoords: true, captionsEnabled: false, panelDirection: 'vertical',
      signature: { anchor: 'tr', dx: 4, dy: 4, scale: 0.2, opacity: 0.8 },
    });
  });

  it('keeps the switches off when the slide had them off', () => {
    expect(slideStyle({ templateId: 3 })).toMatchObject({ footerCredits: false, sceneBadge: false, templateId: null });
  });
});

describe('moving to another slide', () => {
  it('opens at once when there is nothing to keep', () => {
    expect(switchPlan({ started: false })).toBe('open');
    expect(switchPlan({ started: true, dirty: false, saved: true, panels: 2 })).toBe('open');
  });

  it('saves first a slide with something to save', () => {
    expect(switchPlan({ started: true, dirty: true, saved: true, panels: 1 })).toBe('save');
    expect(switchPlan({ started: true, dirty: true, saved: false, panels: 1 })).toBe('save');
  });

  it('drops a slide never started, and asks about one holding words a save could not keep', () => {
    expect(switchPlan({ started: true, dirty: true, saved: false, panels: 0 })).toBe('drop');
    expect(switchPlan({ started: true, dirty: true, saved: false, panels: 0, facts: true })).toBe('ask');
    expect(switchPlan({ started: true, dirty: true, saved: false, panels: 0, pastes: 1 })).toBe('ask');
    // a saved proof whose panels were all taken off cannot be saved: asked, never dropped
    expect(switchPlan({ started: true, dirty: true, saved: true, panels: 0 })).toBe('ask');
  });
});
