import { expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../api.js', () => ({ api: { get, post: vi.fn() } }));
const { namesWords, readReview, staysWords } = await import('./reviewExport.js');

it('lists a group by its first names and counts the rest', () => {
  expect(namesWords({ count: 2, names: ['Photo', 'Proof'] })).toBe('Photo, Proof');
  expect(namesWords({ count: 15, names: ['Photo', 'Proof'] })).toBe('Photo, Proof, and 13 more');
});

it('says what stays, the internal passages first when there are any', () => {
  expect(staysWords(0)).toBe('The rest of the case.');
  expect(staysWords(1)).toBe('1 internal passage, left out of the text, and the rest of the case.');
  expect(staysWords(3)).toBe('3 internal passages, left out of the text, and the rest of the case.');
});

it('asks for the reading with a picture only when one is picked, none included', () => {
  readReview('c1', 'n1');
  readReview('c1', 'n1', '');
  readReview('c1', 'n1', 'logo');
  expect(get.mock.calls.map(([url]) => url)).toEqual([
    '/api/cases/c1/notes/n1/review', '/api/cases/c1/notes/n1/review?picture=', '/api/cases/c1/notes/n1/review?picture=logo',
  ]);
});
