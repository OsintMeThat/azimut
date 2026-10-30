import { describe, expect, it } from 'vitest';
import { countFeatures } from './counts.js';
import { fillTokens, TOKENS } from './page.js';

const features = [
  { properties: { status: 'destroyed', category: 'Buildings' } },
  { properties: { status: 'damaged', category: 'Buildings' } },
  { properties: { category: 'Vehicles' } },
];

describe('what a plate counts', () => {
  it('counts every feature, those of a state, or those of a group whatever its case', () => {
    expect(countFeatures(features)).toBe(3);
    expect(countFeatures(features, 'destroyed')).toBe(1);
    expect(countFeatures(features, 'Damaged')).toBe(1);
    expect(countFeatures(features, 'buildings')).toBe(2);
    expect(countFeatures(features, 'nothing')).toBe(0);
  });

  it('fills the coordinates, the period and the counts into a text', () => {
    const said = fillTokens('{coords} · {mgrs} · {from} to {to} · {count} seen, {count:destroyed} destroyed, {count: Vehicles } vehicles', {
      coords: '44.6, 33.6', mgrs: '36T VK 123 456', from: '2026-10-01', to: '2026-10-20', count: (key) => countFeatures(features, key) });
    expect(said).toBe('44.6, 33.6 · 36T VK 123 456 · 1 October 2026 to 20 October 2026 · 3 seen, 1 destroyed, 1 vehicles');
    // without a counter, nothing is counted
    expect(fillTokens('{count}')).toBe('0');
    for (const token of ['{coords}', '{mgrs}', '{from}', '{to}', '{count}']) expect(TOKENS).toContain(token);
  });

  it('drops the separators a word left when it fills in empty, and only on its line', () => {
    expect(fillTokens('{handle} · {today}', { today: new Date(2026, 9, 24) })).toBe('24 October 2026');
    expect(fillTokens('Map by {handle}, {date}', { date: '2026-10-01' })).toBe('Map by 1 October 2026');
    expect(fillTokens('{case} · {handle} · {scale}', { caseName: 'Kherson' })).toBe('Kherson');
    expect(fillTokens('A · B\n{handle} · x', { handle: '' })).toBe('A · B\nx');
    // a word that is there leaves its line as written
    expect(fillTokens('· {handle} ·', { handle: '@me' })).toBe('· @me ·');
  });
});
