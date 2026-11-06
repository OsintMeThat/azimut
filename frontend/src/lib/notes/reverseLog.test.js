import { describe, expect, it } from 'vitest';
import { engineName, enginesSaid, frameTime, searchLine, searchOffer, utcStamp } from './reverseLog.js';
import { UPLOAD_PAGES } from '../reverseSearch.js';

const NOW = new Date('2026-11-04T21:40:12Z');

describe('the line a reverse search leaves in a note', () => {
  it('dates the minute it was logged, in UTC whatever the analyst\'s clock', () => {
    expect(utcStamp(NOW)).toBe('4 Nov 2026 21:40 UTC');
    expect(utcStamp(new Date('2026-01-09T03:05:00Z'))).toBe('9 Jan 2026 03:05 UTC');
  });

  it('says a moment of a video as a log does, to the second', () => {
    expect(frameTime(12.48)).toBe('00:12');
    expect(frameTime(62)).toBe('01:02');
    expect(frameTime(3750)).toBe('1:02:30');
    expect(frameTime(-3)).toBe('00:00');
    expect(frameTime(null)).toBe('00:00');
  });

  it('names Google as Lens and lists the engines the tool offers, all four when none was pressed', () => {
    expect(engineName(UPLOAD_PAGES[0])).toBe('Lens');
    expect(enginesSaid([])).toEqual(['Lens', 'Yandex', 'Bing', 'TinEye']);
    // only what was pressed is claimed, in the order the tool lists them
    expect(enginesSaid(['tineye', 'google'])).toEqual(['Lens', 'TinEye']);
    expect(enginesSaid(['nothing'])).toEqual(['Lens', 'Yandex', 'Bing', 'TinEye']);
  });

  it('writes the frame of a case video as a chip, ending on Result: for the analyst', () => {
    expect(searchLine({ now: NOW, entity: { id: 'e_clip', label: 'Convoy clip' }, time: 12.48 }))
      .toBe('Reverse search, 4 Nov 2026 21:40 UTC: frame 00:12 of [[entity:e_clip|Convoy clip]] on Lens, Yandex, Bing, TinEye. Result:');
    expect(searchLine({ now: NOW, entity: { id: 'e_photo', label: 'Quai' }, pressed: ['google', 'yandex'] }))
      .toBe('Reverse search, 4 Nov 2026 21:40 UTC: [[entity:e_photo|Quai]] on Lens, Yandex. Result:');
  });

  it('names a picture held only in memory by its label, and falls back on a word', () => {
    expect(searchLine({ now: NOW, label: 'Convoy clip · t=12.48s', pressed: ['bing'] }))
      .toBe('Reverse search, 4 Nov 2026 21:40 UTC: Convoy clip · t=12.48s on Bing. Result:');
    expect(searchLine({ now: NOW })).toContain(': a picture on ');
  });

  it('is offered as a line with the cursor after it, and refuses with a sentence when no picture is picked', async () => {
    const offer = searchOffer({ read: async () => ({ label: 'Quai', pressed: ['google'] }), now: () => NOW });
    expect(offer).toMatchObject({ id: 'reverse-log', label: 'This search' });
    expect(offer.picture).toBeUndefined();
    expect(await offer.put({})).toEqual({
      text: 'Reverse search, 4 Nov 2026 21:40 UTC: Quai on Lens. Result:', caret: true,
    });
    await expect(searchOffer({ read: async () => null }).put({})).rejects.toThrow('Pick a picture');
  });
});
