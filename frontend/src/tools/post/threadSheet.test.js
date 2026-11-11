import { describe, expect, it, vi } from 'vitest';
import { fileRecapMap, fileThreadSheet } from './threadSheet.js';

/** A video thread's recap pictures, filed in Media through their own routes. */

const sent = (post) => {
  const [path, form] = post.mock.calls[0];
  return { path, video: form.get('video'), image: form.get('image') };
};

describe('filing a recap picture', () => {
  it('files the sheet drawn of the places, made from the video, and answers its path', async () => {
    const build = vi.fn(async () => new Blob(['sheet'], { type: 'image/jpeg' }));
    const post = vi.fn(async () => ({ path: 'media/convoy contact sheet.jpg' }));
    const slides = [{ name: 'a' }];
    expect(await fileThreadSheet('case 1', { video: 'media/convoy.mp4', slides }, { build, post })).toBe('media/convoy contact sheet.jpg');
    expect(build).toHaveBeenCalledWith(slides, { caseId: 'case 1' });
    expect(sent(post)).toMatchObject({ path: '/api/cases/case%201/scenes/sheet', video: 'media/convoy.mp4' });
  });

  it('files the map made, and says so when the case answers no path', async () => {
    const blob = new Blob(['map'], { type: 'image/jpeg' });
    const post = vi.fn(async () => ({ path: 'media/convoy recap map.jpg' }));
    expect(await fileRecapMap('case-1', { video: 'media/convoy.mp4', blob }, { post })).toBe('media/convoy recap map.jpg');
    const { path, video, image } = sent(post);
    expect([path, video, image.name, image.size]).toEqual(['/api/cases/case-1/scenes/map', 'media/convoy.mp4', 'recap-map.jpg', 3]);
    await expect(fileRecapMap('case-1', { video: 'media/convoy.mp4', blob }, { post: async () => ({}) })).rejects.toThrow('the map was not filed');
  });
});
