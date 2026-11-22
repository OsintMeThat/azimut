import { expect, it, vi } from 'vitest';

const get = vi.fn();
vi.mock('../api.js', () => ({ api: { get, post: vi.fn() } }));
const { limitWords, namesWords, readReview, sizeSaid, staysWords } = await import('./reviewExport.js');

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

it('says the site\'s limit as its form says it', () => {
  expect(limitWords(1073741824)).toBe('1 GB');
  expect(limitWords(500 * 1024 * 1024)).toBe('500 MB');
});

it('weighs what leaves with the box as it stands, and says the limit only when it matters', () => {
  const GB = 1024 ** 3;
  const shown = { size: GB + 10, videos: { count: 1, size: 100 }, limit: GB };
  expect(sizeSaid(shown, true)).toEqual({ size: GB + 10, line: 'This is over the 1 GB the site takes.' });
  expect(sizeSaid(shown, false).size).toBe(GB - 90);
  expect(sizeSaid(shown, false).line).toMatch(/^osintmethat\.com\/contribute takes files up to 1 GB, so the source videos stay behind/);
  expect(sizeSaid({ ...shown, size: 200 }, false)).toEqual({ size: 100, line: '' });
});
