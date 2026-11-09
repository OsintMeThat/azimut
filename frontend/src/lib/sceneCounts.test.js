import { describe, expect, it } from 'vitest';
import { countWords, mapCount, sceneStage, videoCount } from './sceneCounts.js';

/** A scene's two counts: what the map gave it, and what its video gives it. */

const scene = (extra = {}) => ({ kind: 'draft', state: 'todo', captures: [], footage: 0, file_kind: 'video', ...extra });

describe('a scene\'s counts', () => {
  it('counts the captures and the pictures its video gives it, as the server counted them', () => {
    expect(mapCount(scene({ captures: ['a.png', 'b.png'] }))).toBe(2);
    // the number a nudge said, until the rows are read again
    expect(mapCount(scene({ captures: ['a.png'], captureCount: 3 }))).toBe(3);
    expect(videoCount(scene({ footage: 4 }))).toBe(4);
    expect(videoCount(scene({ footage: null }))).toBe(0);
    expect(videoCount({})).toBe(0);
    // a picture marked to geolocate gives itself
    expect(videoCount(scene({ file_kind: 'image', footage: 0 }))).toBe(1);
  });

  it('marks where it stands', () => {
    expect(sceneStage(scene())).toBe('todo');
    expect(sceneStage(scene({ state: 'progress', captures: ['a.png'] }))).toBe('progress');
    expect(sceneStage(scene({ state: 'progress', captures: ['a.png'] }), true)).toBe('live');
    expect(sceneStage(scene({ state: 'abandoned' }))).toBe('abandoned');
  });

  it('says them in words for the hover', () => {
    expect(countWords(scene())).toBe('To geolocate: no map capture yet, nothing from the video yet');
    expect(countWords(scene({ state: 'progress', captures: ['a.png'], footage: 1 }))).toBe('In progress: 1 map capture, 1 picture from the video');
    expect(countWords(scene({ state: 'progress', captures: ['a.png', 'b.png'], footage: 5 }), true)).toBe('Geolocating: 2 map captures, 5 pictures from the video');
    expect(countWords(scene({ file_kind: 'image' }))).toBe('To geolocate: no map capture yet, the picture itself');
  });
});
