import { describe, expect, it } from 'vitest';
import { creditLines } from './creditLines.js';

// one unit a character, so a room is a count of characters
const measure = (line) => line.length;

describe('a credit line cut to fit a width', () => {
  it('stays one line when it fits', () => {
    expect(creditLines('Esri · © Mapterhorn', 40, measure)).toEqual(['Esri · © Mapterhorn']);
  });

  it('breaks between credits first, so each reads whole', () => {
    expect(creditLines('Esri, Vantor, Earthstar · © Mapterhorn · OpenFreeMap', 30, measure)).toEqual([
      'Esri, Vantor, Earthstar',
      '© Mapterhorn · OpenFreeMap',
    ]);
    // a comparison's two sides part at their bar, and a figure's wide separator is kept
    expect(creditLines('A: Esri   |   B: Copernicus', 15, measure)).toEqual(['A: Esri', 'B: Copernicus']);
    expect(creditLines('Date: 2026-10-04  ·  Source: Sentinel-2 L2A', 24, measure)).toEqual([
      'Date: 2026-10-04',
      'Source: Sentinel-2 L2A',
    ]);
  });

  it('breaks inside a credit only when it is wider than the line on its own', () => {
    const notice = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014';
    const lines = creditLines(`Esri · ${notice}`, 30, measure);
    expect(lines[0]).toBe('Esri');
    expect(lines.slice(1).join(' ')).toBe(notice);
    expect(lines.every((line) => line.length <= 30)).toBe(true);
  });

  it('never drops a word, even one wider than the line', () => {
    expect(creditLines('https://cloudless.eox.at/a-very-long-address', 10, measure))
      .toEqual(['https://cloudless.eox.at/a-very-long-address']);
  });

  it('answers one empty line for no credit', () => {
    expect(creditLines('', 10, measure)).toEqual(['']);
    expect(creditLines(undefined, 10, measure)).toEqual(['']);
  });
});
