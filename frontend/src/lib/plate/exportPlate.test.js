import { describe, expect, it, vi } from 'vitest';
import { evolutionSheet, postExport, scaleFor, scaleForWidth } from './exportPlate.js';

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

  it('posts the frames with what the backend writes them as', async () => {
    const post = vi.fn(async () => ({ file: 'x.mp4' }));
    const frames = [new Blob(['a'], { type: 'image/jpeg' }), new Blob(['b'], { type: 'image/jpeg' })];
    await postExport('case 1', { format: 'mp4', frames, filename: 'Front', widthMm: 297, heightMm: 210, interval: 700 }, post);
    const [path, body] = post.mock.calls[0];
    expect(path).toBe('/api/cases/case 1/map-plates/export');
    expect(body.getAll('frames')).toHaveLength(2);
    expect([body.get('format'), body.get('interval'), body.get('width_mm')]).toEqual(['mp4', '700', '297']);
    expect(body.has('beats')).toBe(false);
  });

  it('posts a stepped plate\'s beats and what stands over its clips', async () => {
    const post = vi.fn(async () => ({ file: 'x.mp4' }));
    const frames = [new Blob(['a'], { type: 'image/jpeg' }), new Blob(['b'], { type: 'image/jpeg' })];
    const beats = [{ seconds: 0.9 }, { seconds: 8, clips: [{ src: 'media/a.mp4', start: 2, end: 10, box: [10, 10, 320, 180] }], over: 0 }];
    await postExport('c', { format: 'mp4', frames, filename: 'Strike', widthMm: 297, heightMm: 210, beats, overs: [new Blob(['o'], { type: 'image/png' })] }, post);
    const [, body] = post.mock.calls[0];
    expect(JSON.parse(body.get('beats'))).toEqual(beats);
    expect(body.getAll('overs')).toHaveLength(1);
  });
});
