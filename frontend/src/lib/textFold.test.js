import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { foldTerms, foldText } from './textFold.js';

const here = dirname(fileURLToPath(import.meta.url));
const { cases } = JSON.parse(
  readFileSync(join(here, '../../../tests/fixtures/fold_cases.json'), 'utf8')
);

describe('search folding', () => {
  it.each(cases)('folds %j as the server does', (text, folded) => {
    expect(foldText(text)).toBe(folded);
    expect(foldText(folded)).toBe(folded);
  });

  it('splits a search box into folded words', () => {
    expect(foldTerms('  Café   Москва ')).toEqual(['cafe', 'москва']);
    expect(foldTerms('')).toEqual([]);
    expect(foldTerms(null)).toEqual([]);
  });
});
