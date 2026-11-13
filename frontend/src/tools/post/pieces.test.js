import { describe, expect, it } from 'vitest';
import { cutText, fitsOn, leftWords, piecePosts, resolvePieces } from './pieces.js';
import { postCharacterCount } from '../../lib/post.js';

const upTo = (n) => (text) => text.length <= n;
const text = (value, heading = false) => ({ kind: 'text', text: value, ...(heading ? { heading: true } : {}) });
const image = (path) => ({ kind: 'media', path, type: 'image' });
const texts = (result) => result.posts.map((post) => post.text);

describe('fitsOn — the count the composer shows', () => {
  it('weighs a link as X does and a long post past 280', () => {
    const fits = fitsOn('x');
    expect(fits(`${'a'.repeat(250)} https://example.com/${'p'.repeat(200)}`)).toBe(true);
    expect(fits('a'.repeat(281))).toBe(false);
  });

  it('lets Bluesky take 300', () => {
    expect(fitsOn('bluesky')('a'.repeat(300))).toBe(true);
    expect(fitsOn('x')('a'.repeat(300))).toBe(false);
  });
});

describe('cutText — where a long text is cut', () => {
  it('gives back a text that fits, whole', () => {
    expect(cutText('  One line.\nTwo lines.  ', upTo(100))).toEqual(['One line.\nTwo lines.']);
    expect(cutText('   ', upTo(100))).toEqual([]);
  });

  it('cuts at a line break before a sentence', () => {
    const value = 'First line, short.\nSecond line. It goes on.';
    expect(cutText(value, upTo(30))).toEqual(['First line, short.', 'Second line. It goes on.']);
  });

  it('cuts at a sentence end before a word, Arabic stops included', () => {
    expect(cutText('One sentence here. Another one there.', upTo(25))).toEqual(['One sentence here.', 'Another one there.']);
    expect(cutText('هل هذا هو المكان؟ نعم هذا هو', upTo(20))).toEqual(['هل هذا هو المكان؟', 'نعم هذا هو']);
  });

  it('cuts between words, never inside one', () => {
    const chunks = cutText('alpha beta gamma delta epsilon zeta', upTo(12));
    expect(chunks).toEqual(['alpha beta', 'gamma delta', 'epsilon zeta']);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(12);
  });

  it('keeps coordinates, links and mentions whole', () => {
    const value = 'Seen at 48.858370, 2.294481 by @someone_here see https://example.com/a/b and 33°18\'45.1"N 44°21\'58.7"E too';
    const chunks = cutText(value, upTo(32));
    expect(chunks.join(' ')).toBe(value);
    expect(chunks.some((chunk) => chunk.includes('48.858370, 2.294481'))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('@someone_here'))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('https://example.com/a/b'))).toBe(true);
    expect(chunks.some((chunk) => chunk.includes('33°18\'45.1"N 44°21\'58.7"E'))).toBe(true);
  });

  it('leaves a word longer than a post whole, alone and over', () => {
    expect(cutText(`short ${'x'.repeat(30)} end`, upTo(10))).toEqual(['short', 'x'.repeat(30), 'end']);
  });

  it('judges the first chunk by the first post\'s room', () => {
    expect(cutText('aaaa bbbb cccc dddd', upTo(9), { first: upTo(4) })).toEqual(['aaaa', 'bbbb cccc', 'dddd']);
  });

  it('cuts a long text under X\'s count on the posts it makes', () => {
    const fits = fitsOn('x');
    const value = Array.from({ length: 60 }, (_, i) => `Sentence number ${i} says a little more.`).join(' ');
    const chunks = cutText(value, fits);
    expect(chunks.length).toBeGreaterThan(5);
    for (const chunk of chunks) expect(postCharacterCount('x', chunk)).toBeLessThanOrEqual(280);
    expect(chunks.join(' ')).toBe(value);
  });
});

describe('piecePosts — a note laid out as posts', () => {
  it('opens a post on a heading and groups the paragraphs after it while they fit', () => {
    const result = piecePosts([
      text('Title', true), text('First paragraph.'), text('Second one.'),
      text('Next', true), text('Third.'),
    ], { fits: upTo(60) });
    expect(texts(result)).toEqual(['Title\n\nFirst paragraph.\n\nSecond one.', 'Next\n\nThird.']);
    expect(result.past).toBe(0);
  });

  it('joins a heading right after a heading, and opens a post on a paragraph that does not fit', () => {
    const result = piecePosts([text('Part', true), text('Section', true), text('a'.repeat(20)), text('b'.repeat(20))], { fits: upTo(40) });
    expect(texts(result)).toEqual([`Part\n\nSection\n\n${'a'.repeat(20)}`, 'b'.repeat(20)]);
  });

  it('cuts a paragraph too long for one post over the next ones', () => {
    const result = piecePosts([text('aaaa bbbb cccc')], { fits: upTo(9) });
    expect(texts(result)).toEqual(['aaaa bbbb', 'cccc']);
  });

  it('gives the first post less room when the template shares it', () => {
    const result = piecePosts([text('aaaa bbbb'), text('cccc')], { fits: upTo(20), first: upTo(4) });
    expect(texts(result)).toEqual(['aaaa', 'bbbb\n\ncccc']);
  });

  it('puts up to four pictures on the post before them, and the fifth on a post of its own', () => {
    const result = piecePosts([text('Look.'), ...['a', 'b', 'c', 'd', 'e'].map((n) => image(`media/${n}.jpg`))], { fits: upTo(50) });
    expect(result.posts).toEqual([
      { text: 'Look.', mediaPaths: ['media/a.jpg', 'media/b.jpg', 'media/c.jpg', 'media/d.jpg'], mediaType: 'images' },
      { text: '', mediaPaths: ['media/e.jpg'], mediaType: 'images' },
    ]);
  });

  it('sends a video or a GIF alone, and never mixes it with pictures', () => {
    const result = piecePosts([
      text('Clip.'), image('media/a.jpg'),
      { kind: 'media', path: 'media/v.mp4', type: 'video' },
      image('media/b.jpg'),
      { kind: 'media', path: 'media/g.gif', type: 'gif' },
      image('media/c.jpg'),
    ], { fits: upTo(50) });
    expect(result.posts.map((post) => [post.mediaType, post.mediaPaths])).toEqual([
      ['images', ['media/a.jpg']],
      ['video', ['media/v.mp4']],
      ['images', ['media/b.jpg']],
      ['images', ['media/g.gif']],
      ['images', ['media/c.jpg']],
    ]);
  });

  it('ends the grouping on a file, so the next paragraph opens a post', () => {
    const result = piecePosts([text('One.'), image('media/a.jpg'), text('Two.')], { fits: upTo(50) });
    expect(result.posts.map((post) => [post.text, post.mediaPaths])).toEqual([['One.', ['media/a.jpg']], ['Two.', []]]);
  });

  it('gives a proof a post of its own, its picture and its points', () => {
    const result = piecePosts([
      text('Before.'), { kind: 'proof', png: 'proofs/strike.png', text: '15.1, 44.2' }, text('After.'),
    ], { fits: upTo(50) });
    expect(result.posts).toEqual([
      { text: 'Before.', mediaPaths: [], mediaType: 'none' },
      { text: '15.1, 44.2', mediaPaths: ['proofs/strike.png'], mediaType: 'images' },
      { text: 'After.', mediaPaths: [], mediaType: 'none' },
    ]);
  });

  it('writes a source as a line of the post before it, the next sources a line each', () => {
    const result = piecePosts([
      text('Claim.'),
      { kind: 'source', url: 'https://a.example/1' },
      { kind: 'source', url: 'https://b.example/2', label: 'Video' },
      text('Next.'),
    ], { fits: upTo(80) });
    expect(texts(result)).toEqual(['Claim.\n\nhttps://a.example/1\nVideo https://b.example/2', 'Next.']);
  });

  it('opens a post for a source that does not fit the one before', () => {
    const result = piecePosts([text('a'.repeat(20)), { kind: 'source', url: 'https://example.com/x' }], { fits: upTo(25) });
    expect(texts(result)).toEqual(['a'.repeat(20), 'https://example.com/x']);
  });

  it('counts the posts past what a thread holds and keeps the first ones', () => {
    const result = piecePosts(Array.from({ length: 5 }, (_, i) => text(`P${i}`, true)), { fits: upTo(5), max: 3 });
    expect(texts(result)).toEqual(['P0', 'P1', 'P2']);
    expect(result.past).toBe(2);
  });

  it('starts nothing from nothing', () => {
    expect(piecePosts([], { fits: upTo(10) })).toEqual({ posts: [], past: 0 });
  });
});

describe('resolvePieces — the case behind each piece', () => {
  const proofs = [
    { name: 'strike', png: 'proofs/strike.png', points: [{ coords: '15.1, 44.2' }] },
    { name: 'unexported', png: null, points: [] },
  ];
  const pointsText = (row) => row.points.map((point) => point.coords).join('\n');

  it('reads a proof by its name and counts what the case does not hold', () => {
    const { pieces, missing } = resolvePieces([
      text('Words.'),
      { kind: 'proof', name: 'strike' },
      { kind: 'proof', name: 'unexported' },
      { kind: 'proof', name: 'gone' },
      { kind: 'proof', name: '', id: 'e1' },
      { kind: 'media', path: '', id: 'e2', type: 'image' },
      image('media/a.jpg'),
    ], { proofs, pointsText });
    expect(pieces).toEqual([
      text('Words.'),
      { kind: 'proof', png: 'proofs/strike.png', text: '15.1, 44.2' },
      image('media/a.jpg'),
    ]);
    expect(missing).toBe(4);
  });
});

describe('leftWords — what stayed out, said once', () => {
  it('says nothing when nothing stayed out', () => {
    expect(leftWords({})).toBe('');
  });

  it('names each reason in one sentence', () => {
    expect(leftWords({ missing: 1 })).toBe('Left out of the thread: 1 file or proof not found in the case.');
    expect(leftWords({ missing: 2, past: 3 })).toBe(
      'Left out of the thread: 2 files or proofs not found in the case, and 3 posts past the 21 a thread holds.',
    );
  });
});
