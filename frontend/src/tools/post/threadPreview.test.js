import { describe, expect, it } from 'vitest';
import { postCharacterCount } from '../../lib/post.js';
import { bidiSafe } from '../../lib/bidi.js';
import {
  DEFAULT_RATIO, gridFrame, postPictures, previewAuthor, previewText, replyHandle, singleFrame, textParts, threadWords,
  xDisplayUrl,
} from './threadPreview.js';

/**
 * The thread's preview, read from the posts as they go out: the words cut as each site
 * shows them, counted as the composer counts them, what runs past the limit marked, and
 * the pictures framed as the site frames one to four.
 */

const SOURCE = 'https://www.instagram.com/reel/C8kXyZaBcDe/?igsh=MWZ1dGx0a2Y0';
const POST = [
  'Al Jawf, Yemen - 7H872G9H+FC',
  '',
  'A formation of 13 helicopters heading East #Yemen',
  '[0:00–0:07]',
  '',
  '16.018740, 45.528599',
  '',
  '@GeoConfirmed @desk.bsky.social',
  '',
  `Source: ${SOURCE}`,
].join('\n');

const shown = (parts) => parts.map((part) => part.text).join('');
const kinds = (parts) => parts.filter((part) => part.kind !== 'text').map((part) => [part.kind, part.text]);

describe('the words of a post, as each site shows them', () => {
  it('keeps every word and line, and shows a link on X without its scheme, cut after 25 characters', () => {
    const { parts, count, limit, over } = previewText('x', POST);
    expect(shown(parts)).toBe(POST.replace(SOURCE, 'instagram.com/reel/C8kXyZ…'));
    expect(kinds(parts)).toEqual([
      ['tag', '#Yemen'], ['mention', '@GeoConfirmed'], ['mention', '@desk'], ['link', 'instagram.com/reel/C8kXyZ…'],
    ]);
    expect(parts.find((part) => part.kind === 'link').href).toBe(SOURCE);
    expect([count, limit, over]).toEqual([postCharacterCount('x', POST), 280, 0]);
  });

  it('shows a link on Bluesky as Bluesky writes it, and a mention only for a whole domain handle', () => {
    const { parts, count, limit } = previewText('bluesky', POST);
    expect(shown(parts)).toBe(POST.replace(SOURCE, 'www.instagram.com/reel/C8kXyZa...'));
    // @GeoConfirmed is no handle there: it stays words
    expect(kinds(parts)).toEqual([
      ['tag', '#Yemen'], ['mention', '@desk.bsky.social'], ['link', 'www.instagram.com/reel/C8kXyZa...'],
    ]);
    expect([count, limit]).toEqual([postCharacterCount('bluesky', POST), 300]);
    // Bluesky counts the link as it shows it
    expect(count).toBe([...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(shown(parts))].length);
  });

  it('leaves what is no hashtag or mention as words on both sites', () => {
    for (const target of ['x', 'bluesky']) {
      const parts = textParts(target, 'Pin #1, mail me@example.test, a#b, ## and #2024 then #Al_Jawf.');
      expect(kinds(parts), target).toEqual([['tag', '#Al_Jawf']]);
    }
  });

  it('keeps the closing punctuation a link took in X’s count as words after it', () => {
    const parts = textParts('x', 'See https://example.test/a.');
    expect(parts.map((part) => [part.kind, part.text])).toEqual([['text', 'See '], ['link', 'example.test/a'], ['text', '.']]);
    expect(xDisplayUrl('http://www.example.test/')).toBe('example.test/');
  });

  it('says the same count as the composer for every post, whatever it holds', () => {
    const samples = [
      '', 'Plain words', POST, bidiSafe('مدينة الحزم 16.018740, 45.528599 https://x.com/a/status/1'),
      'Emoji 👍🏽 and 🇾🇪 flags', `x:${SOURCE} ${SOURCE}. (${SOURCE})`, 'a'.repeat(400),
    ];
    for (const target of ['x', 'bluesky']) {
      for (const text of samples) expect(previewText(target, text).count, `${target}: ${text}`).toBe(postCharacterCount(target, text));
    }
  });
});

describe('a post past its limit', () => {
  it('marks only what runs past the limit, cut at the character on X', () => {
    const text = `${'a'.repeat(275)} hello world`;
    const { parts, count, over } = previewText('x', text);
    expect([count, over]).toEqual([287, 7]);
    expect(parts.filter((part) => !part.over).map((part) => part.text).join('')).toBe(`${'a'.repeat(275)} hell`);
    expect(parts.filter((part) => part.over).map((part) => part.text).join('')).toBe('o world');
  });

  it('cuts at a whole grapheme on Bluesky, and marks a link past the limit whole', () => {
    const flags = '🇾🇪'.repeat(4);
    const { parts, over } = previewText('bluesky', `${'a'.repeat(298)}${flags}`);
    expect(over).toBe(2);
    expect(parts.filter((part) => part.over).map((part) => part.text).join('')).toBe('🇾🇪🇾🇪');
    const linked = previewText('x', `${'a'.repeat(270)} https://example.test/long`);
    expect(linked.parts.at(-1)).toMatchObject({ kind: 'link', over: true });
    expect(linked.parts[0]).toMatchObject({ kind: 'text', over: false });
  });

  it('marks nothing on a post that fits, to the last character', () => {
    expect(previewText('x', 'a'.repeat(280)).parts.every((part) => !part.over)).toBe(true);
    expect(previewText('bluesky', 'a'.repeat(300)).over).toBe(0);
  });
});

describe('the pictures of a post', () => {
  const media = new Map([
    ['media/yard.jpg', { path: 'media/yard.jpg', kind: 'image', thumbnail: 'media/.thumbs/yard.jpg' }],
    ['media/raw.png', { path: 'media/raw.png', kind: 'image', thumbnail: null }],
    ['media/convoy.mp4', { path: 'media/convoy.mp4', kind: 'video', thumbnail: 'media/.thumbs/convoy.jpg' }],
    ['media/new.mp4', { path: 'media/new.mp4', kind: 'video', thumbnail: null }],
  ]);
  const proofs = [{ name: 'bridge', png: 'proofs/bridge.png', thumb: 'media/.thumbs/bridge.jpg' }];

  it('shows a thumbnail the case keeps, else the picture, and never a video’s bytes', () => {
    const pictures = postPictures(
      ['proofs/bridge.png', 'media/yard.jpg', 'media/raw.png', 'media/convoy.mp4', 'media/new.mp4', 'plates/map.webm'],
      { caseId: 'case 1', media, proofs, alt: { 'media/yard.jpg': '  A container yard  ', 'media/raw.png': ' ' } },
    );
    // four at most: the hand-off leaves the rest behind
    expect(pictures.map((one) => [one.path, one.video, one.src, one.alt])).toEqual([
      ['proofs/bridge.png', false, '/files/case%201/media/.thumbs/bridge.jpg', ''],
      ['media/yard.jpg', false, '/files/case%201/media/.thumbs/yard.jpg', 'A container yard'],
      ['media/raw.png', false, '/files/case%201/media/raw.png', ''],
      ['media/convoy.mp4', true, '/files/case%201/media/.thumbs/convoy.jpg', ''],
    ]);
    expect(postPictures(['media/new.mp4', 'plates/map.webm'], { caseId: 'c', media })).toMatchObject([
      { video: true, src: null }, { video: true, src: null },
    ]);
  });

  it('frames one picture as each site does: X between 3:4 and 2:1, Bluesky never taller than wide', () => {
    expect(singleFrame('x', 4 / 3)).toEqual({ frame: 4 / 3, picture: 4 / 3 });
    expect(singleFrame('x', 9 / 16)).toEqual({ frame: 3 / 4, picture: 3 / 4 });
    expect(singleFrame('x', 3)).toEqual({ frame: 2, picture: 2 });
    expect(singleFrame('bluesky', 9 / 16)).toEqual({ frame: 1, picture: 9 / 16 });
    expect(singleFrame('bluesky', 3)).toEqual({ frame: 3, picture: 3 });
    expect(singleFrame('x', undefined).frame).toBe(DEFAULT_RATIO);
  });

  it('lays two to four pictures in X’s 16:9 block, or Bluesky’s 2:1 and 3:2 ones', () => {
    expect([1, 2, 3, 4].map((n) => gridFrame('x', n))).toEqual([null, 16 / 9, 16 / 9, 16 / 9]);
    expect([1, 2, 3, 4].map((n) => gridFrame('bluesky', n))).toEqual([null, 2, 2, 3 / 2]);
  });
});

describe('who it reads as', () => {
  it('names the source a reply goes under, from its address', () => {
    expect(replyHandle({ site: 'x', url: 'https://x.com/someone/status/1' })).toBe('@someone');
    expect(replyHandle({ site: 'bluesky', url: 'https://bsky.app/profile/desk.bsky.social/post/3k' })).toBe('@desk.bsky.social');
    expect(replyHandle({ site: 'bluesky', url: 'https://bsky.app/profile/did:plc:abc/post/3k' })).toBe('');
    expect(replyHandle(null)).toBe('');
  });

  it('reads as the signature handle, else as You', () => {
    expect(previewAuthor('@analyst')).toEqual({ name: '@analyst', initial: 'A' });
    expect(previewAuthor('  ')).toEqual({ name: 'You', initial: '' });
    expect(threadWords(1)).toBe('1 post');
    expect(threadWords(4)).toBe('4 posts');
  });
});
