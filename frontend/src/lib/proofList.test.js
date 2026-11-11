import { describe, expect, it } from 'vitest';
import { CONTINUE_SHOWN, NO_VIDEO, continueShown, findProofs, inVideo, onVideo, proofLabel, proofVideos, recentProofs, slideTag } from './proofList.js';
import { sceneColorAt } from './scenes.js';

const ROWS = [
  { name: 'market', title: 'Market', video: 'media/clip.mp4', video_title: 'Harbour run', order: 2, slide: 2, slides: 4 },
  { name: 'holiday', title: 'Holiday snaps', video: null },
  { name: 'bridge', title: 'Road bridge', video: 'media/clip.mp4', video_title: 'Harbour run', order: 0, slide: 1, slides: 4 },
  { name: 'tower', title: 'Water tower', video: 'media/other/road.webm', order: 1, slide: 1, slides: 1 },
  { name: 'old', title: 'Old proof' },
];

describe('a proof of a video, tagged', () => {
  it('says its video by its title and its place among the slides, in its scene\'s colour', () => {
    expect(slideTag(ROWS[0])).toEqual({ name: 'Harbour run', where: 'slide 2 of 4', text: 'Harbour run · slide 2 of 4', color: sceneColorAt(2) });
    expect(slideTag(ROWS[0], { short: true })).toEqual({ name: 'Harbour run', where: '2/4', text: 'Harbour run · 2/4', color: sceneColorAt(2) });
  });

  it('states no place for a video\u2019s only slide, and names one with no title by its file, no extension', () => {
    for (const short of [false, true]) {
      expect(slideTag(ROWS[3], { short })).toMatchObject({ name: 'road', where: '', text: 'road' });
    }
  });

  it('keeps Continue to whole rows, whatever the width', () => {
    expect(continueShown(0)).toBe(CONTINUE_SHOWN);
    expect(continueShown(undefined)).toBe(CONTINUE_SHOWN);
    expect(continueShown(8)).toBe(6);
    expect(continueShown(5)).toBe(5);
    expect(continueShown(3)).toBe(3);
    expect(continueShown(2)).toBe(4);
    expect(continueShown(1)).toBe(2);
  });

  it('leaves a proof on photos exactly as it was', () => {
    expect(slideTag(ROWS[1])).toBeNull();
    expect(slideTag(ROWS[4])).toBeNull();
    expect(onVideo(ROWS[4])).toBe(false);
    // a list from a server that does not say where a proof stands tags nothing
    expect(slideTag({ name: 'x', video: 'media/clip.mp4' })).toBeNull();
  });
});

describe('the home', () => {
  it('continues from the last proofs saved', () => {
    const many = Array.from({ length: 9 }, (_, i) => ({ name: `p${i}` }));
    expect(recentProofs(many).map((p) => p.name)).toEqual(['p0', 'p1', 'p2', 'p3', 'p4', 'p5']);
    expect(CONTINUE_SHOWN).toBe(6);
    expect(recentProofs(null)).toEqual([]);
  });

  it('finds a proof by its name, every word typed', () => {
    expect(findProofs(ROWS, 'tower').map((p) => p.name)).toEqual(['tower']);
    expect(findProofs(ROWS, 'road BRIDGE').map((p) => p.name)).toEqual(['bridge']);
    expect(findProofs(ROWS, '   ')).toEqual([]);
  });
});

describe('the Open list\'s filter by video', () => {
  it('names each video once with its count, and counts the proofs on no video', () => {
    expect(proofVideos(ROWS)).toEqual({
      videos: [
        { video: 'media/clip.mp4', name: 'Harbour run', count: 2 },
        { video: 'media/other/road.webm', name: 'road', count: 1 },
      ],
      none: 2,
    });
    expect(proofVideos([])).toEqual({ videos: [], none: 0 });
  });

  it('keeps every proof, one video\'s, or those on no video', () => {
    expect(ROWS.filter((r) => inVideo(r, '')).length).toBe(5);
    expect(ROWS.filter((r) => inVideo(r, 'media/clip.mp4')).map((r) => r.name)).toEqual(['market', 'bridge']);
    expect(ROWS.filter((r) => inVideo(r, NO_VIDEO)).map((r) => r.name)).toEqual(['holiday', 'old']);
  });
});

describe('what a listed proof is called', () => {
  const now = new Date(2026, 10, 11);

  it('is its name, else where it stands and its day, else its point, else Untitled', () => {
    expect(proofLabel({ title: 'Rooftop', place: 'Al Jawf, Yemen' }, now)).toBe('Rooftop');
    // a proof saved as Proof N, before or after names were hidden, reads as its label with nothing renamed
    expect(proofLabel({ name: 'Proof 3', title: 'Proof 3', place: 'Al Jawf, Yemen', when: '2026-11-09T09:00:00', created_at: '2026-11-01T09:00:00' }, now))
      .toBe('Al Jawf, Yemen · 9 Nov');
    expect(proofLabel({ title: 'Proof 3', place: 'Al Jawf, Yemen', when: null, created_at: '2025-06-01T12:00:00' }, now)).toBe('Al Jawf, Yemen · 1 Jun 2025');
    expect(proofLabel({ title: 'Proof 3', place: '', points: [{ coords: 'text' }, { lat: 15.47123, lon: 45.32211 }] }, now)).toBe('15.4712, 45.3221');
    expect(proofLabel({ title: 'Proof 3', place: '', points: [] }, now)).toBe('Untitled proof');
    expect(proofLabel({ name: 'Proof 9' }, now)).toBe('Untitled proof');
  });

  it('is found by its place as well as by its name', () => {
    const rows = [{ name: 'Proof 1', title: 'Proof 1', place: 'Al Jawf, Yemen' }, { name: 'Rooftop', title: 'Rooftop' }];
    expect(findProofs(rows, 'jawf').map((row) => row.name)).toEqual(['Proof 1']);
    expect(findProofs(rows, 'rooftop').map((row) => row.name)).toEqual(['Rooftop']);
    // a technical name, never shown, finds nothing
    expect(findProofs(rows, 'proof 1')).toEqual([]);
  });
});
