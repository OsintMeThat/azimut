import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { proofCaption } from '../proof/proofNote.js';
import { NOT_YET, sceneTimecode, scenePlace, scenesOffer, scenesTable } from './scenesNote.js';

/** A proof's scene as `GET /scenes` lists it. */
const proof = (over = {}) => ({
  kind: 'proof', proof: 'roundabout', proof_id: 'e_proof', title: 'Roundabout north', state: 'proved', abandoned: null,
  moments: [{ start: 24, end: 41 }], at: [26.1],
  points: [{ lat: 48.51203, lon: 35.04122, coords: '48.51203, 35.04122', label: '', pov: false, place_id: 'e_place', place_label: 'Roundabout' }],
  when: '2025-10-24', when_zone: null,
  ...over,
});
/** A scene still to geolocate, as `GET /scenes` lists it. */
const draft = (over = {}) => ({ kind: 'draft', id: 's3', start: 292, end: 320, label: 'Road bridge?', state: 'todo', abandoned: null, ...over });

const READ = {
  video: 'Sources/Telegram/clip.mp4',
  video_id: 'e_video',
  scenes: [
    draft({ id: 's1', start: null, end: null, label: '' }),
    proof(),
    proof({ proof: 'bridge', proof_id: 'e_bridge', title: 'Bridge', moments: [], at: [302],
      points: [{ lat: 48.6, lon: 35.1, coords: '48.6, 35.1', label: 'Bank', pov: true, place_id: null }],
      when: '2025-10-24T10:00:00', when_zone: 'Europe/Kyiv' }),
    draft(),
  ],
};

describe('a scene’s time in a note', () => {
  it('is the one timecode a post prints, or Whole video', () => {
    expect(sceneTimecode(proof({ moments: [{ start: 15, end: null }] }))).toBe('[0:15]');
    expect(sceneTimecode(proof({ moments: [{ start: 0, end: 7 }] }))).toBe('[0:00–0:07]');
    expect(sceneTimecode(proof({ moments: [{ start: 0, end: 7 }, { start: 65, end: 72 }] }))).toBe('[0:00–0:07] [1:05–1:12]');
    // a proof with no moment is about the whole video: its frames' instants are no time
    expect(sceneTimecode(proof({ moments: [], at: [26.1] }))).toBe('Whole video');
    expect(sceneTimecode(draft({ start: null, end: null }))).toBe('Whole video');
    expect(sceneTimecode(draft({ start: 292, end: 320, more: [{ start: 400, end: null }] }))).toBe('[4:52–5:20] [6:40]');
  });
});

describe('where a scene was geolocated', () => {
  it('cites the case place a point sits on, else writes its coordinates', () => {
    expect(scenePlace(proof())).toBe('[[entity:e_place|Roundabout]]');
    const loose = proof({ points: [{ lat: 48.6, lon: 35.1, coords: '48.6, 35.1', label: '', pov: false, place_id: null }] });
    expect(scenePlace(loose)).toBe('48.6, 35.1');
  });

  it('says which point is where the camera stood', () => {
    const two = proof({ points: [
      { coords: '48.6, 35.1', label: 'Rooftop', pov: true, place_id: 'e_roof', place_label: 'Rooftop' },
      { coords: '48.61, 35.12', label: '', pov: false, place_id: null },
    ] });
    expect(scenePlace(two)).toBe('[[entity:e_roof|Rooftop]] (point of view) · 48.61, 35.12');
  });

  it('says so for a scene still to geolocate, and for one abandoned', () => {
    expect(scenePlace(draft())).toBe(NOT_YET);
    expect(scenePlace(proof({ state: 'progress', points: [] }))).toBe(NOT_YET);
    expect(scenePlace(draft({ state: 'abandoned', abandoned: { why: 'Too dark' } }))).toBe('Abandoned');
    expect(scenePlace(proof({ state: 'abandoned', abandoned: { why: 'Too dark' }, points: [] }))).toBe('Abandoned');
  });
});

describe('the scenes of a video as a table', () => {
  it('writes one row per scene, in clip order, everything cited by id', () => {
    const text = scenesTable(READ, { title: 'clip.mp4' });
    expect(text).toBe([
      '> Scenes of [[entity:e_video|clip.mp4]]',
      '',
      '| Time | Scene | Place | Date | Proof |',
      '| --- | --- | --- | --- | --- |',
      `| Whole video | To geolocate | ${NOT_YET} |  |  |`,
      '| [0:24–0:41] | Roundabout north | [[entity:e_place|Roundabout]] | 2025-10-24 | [[entity:e_proof|Roundabout north]] |',
      '| Whole video | Bridge | 48.6, 35.1 (point of view) | 2025-10-24 10:00 UTC+3 | [[entity:e_bridge|Bridge]] |',
      `| [4:52–5:20] | Road bridge? | ${NOT_YET} |  |  |`,
      '',
    ].join('\n'));
    // never a path
    expect(text).not.toContain('Sources/');
  });

  it('writes the proof’s date the way a proof put in a note does', () => {
    const [, bridge] = READ.scenes.filter((scene) => scene.kind === 'proof');
    const row = scenesTable({ ...READ, scenes: [bridge] }).trim().split('\n').at(-1);
    expect(row).toContain(`| ${proofCaption({ when: bridge.when, whenZone: bridge.when_zone })} |`);
  });

  it('says how many were left out past the cut', () => {
    const many = { ...READ, scenes: Array.from({ length: 5 }, (_, at) => draft({ id: `s${at}`, start: at * 10, end: null })) };
    const text = scenesTable(many, { title: 'clip.mp4', limit: 3 });
    expect(text).toContain('> Only the first 3 of 5 scenes.\n');
    expect(text.trim().split('\n').filter((line) => line.startsWith('| ['))).toHaveLength(3);
  });

  it('is nothing for a video with no scene', () => {
    expect(scenesTable({ video_id: 'e_video', scenes: [] })).toBe('');
    expect(scenesTable(null)).toBe('');
  });
});

describe('the offer', () => {
  const video = { path: 'Sources/Telegram/clip #2.mp4', kind: 'video', title: 'Clip two', entity_id: 'e_video' };

  it('is offered only for a video that has scenes', () => {
    expect(scenesOffer({ caseId: 'c1', video, scenes: 0 })).toBeNull();
    expect(scenesOffer({ caseId: 'c1', video: null, scenes: 2 })).toBeNull();
    expect(scenesOffer({ caseId: '', video, scenes: 2 })).toBeNull();
    const offer = scenesOffer({ caseId: 'c1', video, scenes: 2 });
    expect(offer).toMatchObject({ id: 'scenes', label: 'The scenes of this video', hint: 'As a table', icon: 'table' });
    expect(offer.picture).toBeUndefined();
  });

  it('reads the scenes from the server and files nothing', async () => {
    const get = vi.fn().mockResolvedValue(READ);
    const signal = new AbortController().signal;
    const answer = await scenesOffer({ caseId: 'c1', video, scenes: 2, get }).put({ signal });
    expect(get).toHaveBeenCalledWith('/api/cases/c1/scenes?video=Sources%2FTelegram%2Fclip%20%232.mp4', { signal });
    expect(answer.text).toContain('> Scenes of [[entity:e_video|Clip two]]');
    expect(answer.filed).toBeUndefined();
  });

  it('says so when nothing is saved for the video yet', async () => {
    const get = vi.fn().mockResolvedValue({ video_id: 'e_video', scenes: [] });
    await expect(scenesOffer({ caseId: 'c1', video, scenes: 1, get }).put()).rejects.toThrow('No scene of this video is saved yet');
  });

  it('sits beside the frame in Inspect’s offers', () => {
    const source = readFileSync(new URL('../Inspector.svelte', import.meta.url), 'utf8');
    const line = source.split('\n').find((row) => row.includes("offerPuts('inspect'"));
    expect(line).toContain('noteFrame');
    expect(line).toContain('scenesOffer({ caseId: work.caseId, video: isVideo ? work.source : null, scenes: scenes.length })');
  });
});
