import { describe, expect, it } from 'vitest';
import { beatClips, beats, boundSeconds, captionOf, clipRange, clipSeconds, daySeconds, leastSeconds, playDays, readTimecode, stepSeconds, timecode, totalSeconds } from './clip.js';

describe('a clip', () => {
  it('runs forward, inside its video, ten minutes at most', () => {
    expect(clipRange({ clip: [12, 20] })).toEqual([12, 20]);
    expect(clipRange({ clip: [20, 12] })).toEqual([20, 30]);
    expect(clipRange({ clip: [5, 50] }, 30)).toEqual([5, 30]);
    expect(clipRange({ clip: [0, 9000] })).toEqual([0, 600]);
    expect(clipRange({})).toEqual([0, 10]);
    expect(clipSeconds({ clip: [1.5, 4] })).toBe(2.5);
  });

  it('writes and reads a time as minutes and seconds', () => {
    expect(timecode(75.5)).toBe('1:15.5');
    expect(timecode(8)).toBe('0:08');
    expect(readTimecode('1:15.5')).toBe(75.5);
    expect(readTimecode('75')).toBe(75);
    expect(readTimecode('1:02:03')).toBe(3723);
    expect(readTimecode('soon')).toBeNull();
    expect(readTimecode('')).toBeNull();
  });

  it('says its source from the file\'s record, else by the file\'s title', () => {
    expect(captionOf({ source: { uploader: 'GeoWatch', webpage_url: 'https://www.x.com/geo/status/1', upload_date: '20261012' } }))
      .toBe('GeoWatch · x.com · 12 October 2026');
    expect(captionOf({ source_url: 'https://t.me/channel/4', source: {} })).toBe('t.me');
    expect(captionOf({ title: 'Strike at dawn', source: { type: 'upload' } })).toBe('Strike at dawn');
  });
});

describe('a played plate', () => {
  const spec = {
    steps: { '2026-10-14': [{ id: 'a', duration: 2 }], '2026-10-15': [{ id: 'b', duration: 4 }, { id: 'c', duration: 3 }] },
    elements: [
      { id: 'v1', kind: 'video', step: 'b', src: 'media/one.mp4', clip: [10, 18], box: [0, 0, 10, 10] },
      { id: 'v2', kind: 'video', step: 'b', src: 'media/two.mp4', clip: [0, 5], box: [0, 0, 10, 10] },
      { id: 'v3', kind: 'video', step: 'c', src: '', box: [0, 0, 10, 10] },
      { id: 'v4', kind: 'video', step: 'c', src: 'media/off.mp4', hidden: true, box: [0, 0, 10, 10] },
    ],
  };

  it('holds a step its own seconds, never shorter than its longest clip', () => {
    expect(stepSeconds(spec.steps['2026-10-15'][0], spec.elements)).toBe(8);
    expect(leastSeconds(spec.steps['2026-10-15'][0], spec.elements)).toBe(8);
    // held longer than its clip, the step keeps it that long
    expect(stepSeconds({ ...spec.steps['2026-10-15'][0], duration: 12 }, spec.elements)).toBe(12);
    // a video without its file, or hidden, holds nothing
    expect(stepSeconds(spec.steps['2026-10-15'][1], spec.elements)).toBe(3);
    expect(leastSeconds(spec.steps['2026-10-15'][1], spec.elements)).toBe(0);
  });

  it('holds a day its own seconds, else the plate\'s, else one second', () => {
    expect(daySeconds({}, '2026-10-14')).toBe(1);
    expect(daySeconds({ time: { hold: 2.5 } }, '2026-10-14')).toBe(2.5);
    expect(daySeconds({ time: { hold: 2.5 }, holds: { '2026-10-14': 6 } }, '2026-10-14')).toBe(6);
    expect(daySeconds({ time: { hold: 2.5 }, holds: { now: 4 } }, null)).toBe(4);
    expect([boundSeconds('0.05'), boundSeconds('7.25'), boundSeconds('999'), boundSeconds('x')]).toEqual([0.2, 7.3, 120, null]);
  });

  it('goes through each day, then its steps, and runs their clips', () => {
    const list = beats({ ...spec, time: { hold: 0.9 }, holds: { '2026-10-15': 2 } }, ['2026-10-14', '2026-10-15']);
    expect(list.map((beat) => [beat.day, beat.step, beat.seconds])).toEqual([
      ['2026-10-14', null, 0.9], ['2026-10-14', 'a', 2], ['2026-10-15', null, 2], ['2026-10-15', 'b', 8], ['2026-10-15', 'c', 3]]);
    expect(totalSeconds(list)).toBeCloseTo(15.9);
    expect(beatClips(spec, list[3]).map((element) => element.id)).toEqual(['v1', 'v2']);
    expect(beatClips(spec, list[2])).toEqual([]);
  });

  it('plays now last, when steps stand on it', () => {
    expect(playDays(spec, ['2026-10-14'])).toEqual(['2026-10-14']);
    expect(playDays({ steps: { now: [{ id: 'n' }] } }, ['2026-10-14'], '2026-10-20')).toEqual(['2026-10-14', null]);
    // today is now: its change is played once, as now, unless steps stand on that day itself
    expect(playDays({ steps: { now: [{ id: 'n' }] } }, ['2026-10-14', '2026-10-15'], '2026-10-15')).toEqual(['2026-10-14', null]);
    expect(playDays({ steps: { now: [{ id: 'n' }], '2026-10-15': [{ id: 't' }] } }, ['2026-10-15'], '2026-10-15')).toEqual(['2026-10-15', null]);
    expect(playDays(spec, ['2026-10-15'], '2026-10-15')).toEqual(['2026-10-15']);
  });
});
