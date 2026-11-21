import { describe, expect, it } from 'vitest';

import {
  markedWords, pastedLinks, postBlockText, postLink, postParagraphs, quotedWords, readPost, readsRightToLeft, unreadLinks,
  withAvatar, withForm, withHighlight,
  withKept, withQr, withTranslation, withoutHighlight, writePost,
} from './postText.js';

/** A post's block: its lines, read and written as `engine/socialposts.py` reads them. Accounts are made up. */

const BLOCK = [
  '::: post',
  'post: e_first',
  'highlight: a column of vehicles',
  'translation: A column of vehicles heads south.',
  'post: e_second',
  'form: quote',
  'avatar: hidden',
  'qr: on',
  ':::',
].join('\n');

describe('a post address', () => {
  it('reads X, its mirrors and Bluesky, each by the post it names', () => {
    expect(postLink('https://x.com/coast_monitor/status/1990000000000000001')).toEqual(
      { site: 'x', handle: 'coast_monitor', ident: '1990000000000000001', key: 'x:1990000000000000001' });
    expect(postLink('https://fxtwitter.com/coast_monitor/status/12?s=20').key).toBe('x:12');
    expect(postLink('vxtwitter.com/coast_monitor/status/12').key).toBe('x:12');
    expect(postLink('https://twitter.com/i/web/status/12')).toMatchObject({ handle: '', key: 'x:12' });
    expect(postLink('https://bsky.app/profile/redseadesk.bsky.social/post/3m7kfake')).toEqual(
      { site: 'bluesky', handle: 'redseadesk.bsky.social', ident: '3m7kfake', key: 'bluesky:redseadesk.bsky.social/3m7kfake' });
  });

  it('refuses what is not a post', () => {
    expect(postLink('https://x.com/coast_monitor')).toBeNull();
    expect(postLink('https://example.org/status/12')).toBeNull();
    expect(postLink('javascript:alert(1)')).toBeNull();
    expect(postLink('')).toBeNull();
  });

  it('takes one post a line from a paste, each once, in order', () => {
    const paste = 'https://x.com/a_b/status/2\nnot a link\nhttps://twitter.com/a_b/status/2\n https://bsky.app/profile/c.d/post/3k ';
    expect(pastedLinks(paste)).toEqual(['https://x.com/a_b/status/2', 'https://bsky.app/profile/c.d/post/3k']);
  });
});

describe('a post block', () => {
  it('reads each post with its own lines, then the block’s', () => {
    expect(readPost(BLOCK)).toEqual({
      entries: [
        { kind: 'post', value: 'e_first', highlights: ['a column of vehicles'], translation: 'A column of vehicles heads south.' },
        { kind: 'post', value: 'e_second', highlights: [], translation: '' },
      ],
      form: 'quote', avatar: false, qr: true,
    });
  });

  it('writes back the bytes it read', () => {
    expect(writePost(readPost(BLOCK))).toBe(BLOCK);
  });

  it('writes a new block from posts kept and links not read yet', () => {
    expect(postBlockText({ ids: ['e_1'], links: ['https://x.com/a/status/9'] })).toBe('::: post\npost: e_1\nlink: https://x.com/a/status/9\n:::');
    expect(unreadLinks(postBlockText({ links: ['https://x.com/a/status/9'] }))).toEqual(['https://x.com/a/status/9']);
  });

  it('changes one setting at a time, the others left as they were', () => {
    expect(withForm(BLOCK, 'card')).not.toContain('form:');
    expect(withAvatar(BLOCK, true)).not.toContain('avatar:');
    expect(withQr(BLOCK, false)).not.toContain('qr:');
    const marked = withHighlight(BLOCK, 1, 'all units have left');
    expect(readPost(marked).entries[1].highlights).toEqual(['all units have left']);
    expect(withHighlight(marked, 1, 'all units have left')).toBe(marked);
    expect(readPost(withoutHighlight(BLOCK, 0, 'a column of vehicles')).entries[0].highlights).toEqual([]);
    const said = withTranslation(BLOCK, 1, 'Line one\nline two');
    expect(said).toContain('translation: Line one\\nline two');
    expect(readPost(said).entries[1].translation).toBe('Line one\nline two');
  });

  it('names an address by its post once a read kept it', () => {
    const held = postBlockText({ links: ['https://x.com/a/status/9', 'https://x.com/a/status/10'] });
    const kept = withKept(held, [{ link: 'https://x.com/a/status/9', id: 'e_9' }, { link: 'https://x.com/a/status/10', error: 'gone' }]);
    expect(kept).toBe('::: post\npost: e_9\nlink: https://x.com/a/status/10\n:::');
  });
});

describe('the highlighted words', () => {
  it('cuts the words where each passage stands, overlaps joined', () => {
    expect(markedWords('one two three four', ['two', 'two three', 'four'])).toEqual([
      { text: 'one ', lit: false }, { text: 'two three', lit: true }, { text: ' ', lit: false }, { text: 'four', lit: true },
    ]);
    expect(markedWords('nothing kept', ['absent'])).toEqual([{ text: 'nothing kept', lit: false }]);
  });

  it('quotes the passages kept, else every word', () => {
    expect(quotedWords('one two three', ['two'])).toBe('two');
    expect(quotedWords('one two three', ['one', 'three'])).toBe('one … three');
    expect(quotedWords(' one two ', [])).toBe('one two');
  });

  it('parts the words at blank lines, each paragraph read in its own direction', () => {
    const words = 'غريرة، تعز - 7H45\n\nLoyalists post photos.\nSource: x.com/a';
    expect(postParagraphs(words, ['Loyalists post'])).toEqual([
      { rtl: true, stretches: [{ text: 'غريرة، تعز - 7H45', lit: false }] },
      { rtl: false, stretches: [{ text: 'Loyalists post', lit: true }, { text: ' photos.\nSource: x.com/a', lit: false }] },
    ]);
    expect(readsRightToLeft('2026 — رتل')).toBe(true);
    expect(readsRightToLeft('@GeoConfirmed رتل')).toBe(false);
  });

  it('keeps right-to-left words as they are written', () => {
    const words = 'رتل من المركبات يتجه جنوبًا';
    expect(markedWords(words, ['رتل من المركبات'])[0]).toEqual({ text: 'رتل من المركبات', lit: true });
  });
});
