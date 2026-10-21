import { describe, expect, it, vi } from 'vitest';
import { evolutionSheet, postExport, release, scaleFor, scaleForWidth, stagedPictures } from './exportPlate.js';

const page = { page: { paper: 'a4', orientation: 'landscape' } };

describe('a plate out of the tab', () => {
  it('draws a page at its dpi, held under the largest canvas a browser draws', () => {
    expect(scaleFor(page, 300) * 297).toBeCloseTo(3508, -1);
    expect(scaleFor({ page: { paper: 'a3', orientation: 'portrait' } }, 2400) * 420).toBeLessThanOrEqual(16_000);
    expect(scaleForWidth(page, 1920) * 297).toBeCloseTo(1920);
  });

  it('lays its days side by side, each under its day', () => {
    const calls = [];
    const ctx = new Proxy({}, { get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => { target[key] = value; return true; } });
    const canvas = { getContext: () => ctx };
    const pages = Array.from({ length: 5 }, () => ({ width: 300, height: 200 }));
    const sheet = evolutionSheet(pages, ['1', '2', '3', '4', '5'], { paper: '#fff', ink: '#000', font: 'inter' }, () => canvas);
    // five days take three columns and two rows
    expect(sheet.width).toBe(3 * 300 + 4 * 12);
    expect(calls.filter(([name]) => name === 'drawImage')).toHaveLength(5);
    expect(calls.filter(([name]) => name === 'fillText').map(([, text]) => text)).toEqual(['1', '2', '3', '4', '5']);
  });

  it('lets the canvases it drew go at once, passing over what is not one', () => {
    const page = { width: 3508, height: 2480 };
    const map = { width: 2000, height: 1400 };
    release(page, null, map, undefined, { picture: true });
    expect([page.width, page.height, map.width, map.height]).toEqual([0, 0, 0, 0]);
  });

  it('posts a page with what the backend writes it as', async () => {
    const post = vi.fn(async () => ({ file: 'x.png' }));
    await postExport('case 1', { format: 'png', frames: [new Blob(['a'], { type: 'image/png' })], filename: 'Front', widthMm: 297, heightMm: 210 }, post);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/api/cases/case 1/map-plates/export');
    expect(body.getAll('frames')).toHaveLength(1);
    expect([body.get('format'), body.get('width_mm'), body.has('staged'), body.has('beats')]).toEqual(['png', '297', false, false]);
  });

  /** A server keeping what each batch brings, as `api/mapplates.stage_pictures` does. */
  function stagingServer() {
    const kept = { frames: [], overs: [], tweens: [] };
    const exports = [];
    const post = vi.fn(async (path, body) => {
      if (path.endsWith('/export')) { exports.push(body); return { file: 'x.mp4' }; }
      kept[body.get('series')].push(...body.getAll('pictures').map((blob) => blob.name));
      return { staged: body.get('staged') || 'token' };
    });
    return { kept, exports, post, del: vi.fn(async () => ({ dropped: true })) };
  }
  const jpeg = (size = 1000) => new Blob([new Uint8Array(size)], { type: 'image/jpeg' });

  it('sends a played plate\'s pictures in batches as they are drawn, each series in its order', async () => {
    const server = stagingServer();
    const pictures = stagedPictures('c', server);
    for (let index = 0; index < 30; index += 1) await pictures.add('tweens', jpeg());
    // two full batches went out while the drawing went on; what is left waits for the next
    expect(server.post).toHaveBeenCalledTimes(2);
    expect(server.kept.tweens).toHaveLength(24);
    // a batch also goes once it is heavy, however few it holds
    await pictures.add('frames', jpeg(3_000_000));
    await pictures.add('frames', jpeg(2_000_000));
    expect(server.kept.frames).toEqual(['frames0.jpg', 'frames1.jpg']);
    await pictures.add('overs', new Blob(['o'], { type: 'image/png' }));
    expect([pictures.count('frames'), pictures.count('overs'), pictures.count('tweens')]).toEqual([2, 1, 30]);
    const beats = [{ seconds: 1 }, { seconds: 2, tween: [0, 30] }];
    await pictures.finish({ format: 'mp4', filename: 'Moving', widthMm: 297, heightMm: 210, beats });
    expect(server.kept.tweens).toEqual(Array.from({ length: 30 }, (_, index) => `tweens${index}.jpg`));
    expect(server.kept.overs).toEqual(['overs0.png']);
    // every batch after the first names the folder the first opened, and so does the export
    expect(server.post.mock.calls.slice(1).every(([, body]) => body.get('staged') === 'token')).toBe(true);
    const [body] = server.exports;
    expect([body.get('staged'), body.has('frames'), JSON.parse(body.get('beats'))]).toEqual(['token', false, beats]);
    expect(server.del).not.toHaveBeenCalled();
  });

  it('lets the server forget the pictures of an export stopped on the way', async () => {
    const server = stagingServer();
    const pictures = stagedPictures('c', server);
    for (let index = 0; index < 12; index += 1) await pictures.add('tweens', jpeg());
    pictures.drop();
    expect(server.del).toHaveBeenCalledWith('/api/cases/c/map-plates/export/pictures/token');
    // nothing was sent yet: nothing to forget
    const idle = stagingServer();
    stagedPictures('c', idle).drop();
    expect(idle.del).not.toHaveBeenCalled();
  });
});
