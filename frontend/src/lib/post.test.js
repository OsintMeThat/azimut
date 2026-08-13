import { describe, it, expect } from 'vitest';
import {
  TWEET_TOKENS, DEFAULT_TWEET_BODY, tweetFields, buildTweet1,
  extraPostTweetText, groupPostMedia, mediaTweetText, newPostMediaTweet,
  applyPostTemplateStructure, normalizePostMediaPickerTarget, normPostTemplate, postMediaForType,
  postCharacterCount, postComposeUrl, postReportMarkdown, postTarget,
  proofSourceMediaPaths, renumberMediaTweetText, retargetMediaTweetText,
  templateFromPost, templateUsesPostField, togglePostMedia,
} from './post.js';

const full = {
  place: 'Bakhmut, Donetsk, Ukraine',
  plusCode: '8FPGXXXX+XX',
  description: 'Rooftop match',
  lat: 48.85, lon: 2.35,
  mention: '@GeoConfirmed',
  source: 'https://x.com/a/1',
};

describe('tweetFields — resolve a draft into token values', () => {
  it('formats coordinates to six decimals and trims text', () => {
    const f = tweetFields({ ...full, place: '  Bakhmut  ' });
    expect(f.place).toBe('Bakhmut');
    expect(f.coordinates).toBe('48.850000, 2.350000');
  });

  it('leaves absent tokens empty (no coords without a point)', () => {
    const f = tweetFields({ mention: '' });
    expect(f.coordinates).toBe('');
    expect(f.mention).toBe('');
  });
});

describe('buildTweet1 — the default body', () => {
  it('renders the classic full thread', () => {
    expect(buildTweet1(DEFAULT_TWEET_BODY, full)).toBe(
      'Bakhmut, Donetsk, Ukraine - 8FPGXXXX+XX\n\n' +
      'Rooftop match\n\n' +
      '48.850000, 2.350000\n\n' +
      '@GeoConfirmed\n\n' +
      'Source: https://x.com/a/1'
    );
  });
});

describe('buildTweet1 — token ordering + line control', () => {
  it('honours a custom order', () => {
    const body = '#coordinates\n#mention\n#place';
    expect(buildTweet1(body, full)).toBe('48.850000, 2.350000\n@GeoConfirmed\nBakhmut, Donetsk, Ukraine');
  });

  it('keeps the analyst blank lines between tokens', () => {
    expect(buildTweet1('#coordinates\n\n#source', full)).toBe('48.850000, 2.350000\n\nhttps://x.com/a/1');
  });

  it('drops a line whose tokens are all empty, label and all', () => {
    // no source → the whole "Source: #source" line vanishes
    const noSource = { ...full, source: '' };
    expect(buildTweet1(DEFAULT_TWEET_BODY, noSource)).toBe(
      'Bakhmut, Donetsk, Ukraine - 8FPGXXXX+XX\n\nRooftop match\n\n48.850000, 2.350000\n\n@GeoConfirmed'
    );
  });

  it('trims a dangling separator when one side of a combined line is empty', () => {
    expect(buildTweet1('#place - #pluscode', { ...full, plusCode: '' })).toBe('Bakhmut, Donetsk, Ukraine');
    expect(buildTweet1('#place - #pluscode', { ...full, place: '' })).toBe('8FPGXXXX+XX');
  });

  it('collapses blank-line runs and trims the ends', () => {
    expect(buildTweet1('\n\n#coordinates\n\n\n\n#mention\n\n', full))
      .toBe('48.850000, 2.350000\n\n@GeoConfirmed');
  });

  it('a coords-only body posts barebones', () => {
    expect(buildTweet1('#coordinates', full)).toBe('48.850000, 2.350000');
  });

  it('keeps literal text on lines that also carry a filled token', () => {
    expect(buildTweet1('Filmed at #place today', full)).toBe('Filmed at Bakhmut, Donetsk, Ukraine today');
  });

  it('exposes the insertable token palette', () => {
    expect(TWEET_TOKENS.map((t) => t.tag)).toEqual([
      '#place', '#pluscode', '#coordinates', '#description', '#mention', '#source',
    ]);
    for (const t of TWEET_TOKENS) expect(t.sample).toBeTruthy();
  });
});

describe('editable media tweets', () => {
  it('puts the media prefix in the tweet text', () => {
    expect(mediaTweetText('video', '', 2)).toBe('2/ Video:');
    expect(mediaTweetText('images', 'Caption', 2)).toBe('2/ Image:\nCaption');
    expect(mediaTweetText('images', '', 3)).toBe('3/ Image:');
  });

  it('updates an untouched prefix when the selected media type changes', () => {
    expect(retargetMediaTweetText('2/ Video:\nCaption', 'video', 'images', 2))
      .toBe('2/ Image:\nCaption');
  });

  it('preserves a prefix the analyst edited', () => {
    expect(retargetMediaTweetText('2/ Footage:\nCaption', 'video', 'images', 2))
      .toBe('2/ Footage:\nCaption');
  });

  it('creates an empty third media tweet without choosing a type', () => {
    expect(newPostMediaTweet(7, 3)).toEqual({
      id: 7,
      text: '',
      mediaPaths: [],
      mediaType: 'none',
      isMediaTweet: true,
      mediaTextIncludesPrefix: true,
    });
  });

  it('adds the numbered prefix once a media type is known', () => {
    expect(newPostMediaTweet(8, 3, 'video')).toEqual({
      id: 8,
      text: '3/ Video:',
      mediaPaths: [],
      mediaType: 'video',
      isMediaTweet: true,
      mediaTextIncludesPrefix: true,
    });
  });

  it('renumbers an untouched prefix after an earlier tweet is removed', () => {
    expect(renumberMediaTweetText('4/ Video:\nCaption', 'video', 4, 3))
      .toBe('3/ Video:\nCaption');
    expect(renumberMediaTweetText('Footage:\nCaption', 'video', 4, 3))
      .toBe('Footage:\nCaption');
  });

  it('copies new prefixes verbatim and upgrades legacy media tweets', () => {
    expect(extraPostTweetText({
      text: '3/ Image:\nCaption', mediaPaths: ['media/a.jpg'],
      mediaType: 'images', mediaTextIncludesPrefix: true,
    }, 3)).toBe('3/ Image:\nCaption');
    expect(extraPostTweetText({
      text: 'Caption', mediaPaths: ['media/a.jpg'], mediaType: 'images',
    }, 3)).toBe('3/ Image:\nCaption');
  });
});

describe('togglePostMedia — manual media override', () => {
  it('adds and removes an image', () => {
    const image = { path: 'media/a.jpg', kind: 'image' };
    const added = togglePostMedia({}, image);
    expect(added).toEqual({ mediaPaths: ['media/a.jpg'], mediaType: 'images', outcome: 'added' });
    expect(togglePostMedia(added, image)).toEqual({
      mediaPaths: [], mediaType: 'images', outcome: 'removed',
    });
  });

  it('replaces proof-filled video when an image is selected', () => {
    expect(togglePostMedia(
      { mediaPaths: ['media/source.mp4'], mediaType: 'video' },
      { path: 'media/override.jpg', kind: 'image' },
    )).toEqual({
      mediaPaths: ['media/override.jpg'], mediaType: 'images', outcome: 'replaced',
    });
  });

  it('keeps the current selection when the limit is reached', () => {
    const mediaPaths = ['media/1.jpg', 'media/2.jpg', 'media/3.jpg', 'media/4.jpg'];
    expect(togglePostMedia(
      { mediaPaths, mediaType: 'images' },
      { path: 'media/5.jpg', kind: 'image' },
    )).toEqual({ mediaPaths, mediaType: 'images', outcome: 'limit' });
  });
});

describe('postMediaForType — picker filtering', () => {
  const items = [
    { path: 'media/a.jpg', kind: 'image' },
    { path: 'media/b.mp4', kind: 'video' },
    { path: 'media/c.mp3', kind: 'audio' },
  ];

  it('shows only images in image mode', () => {
    expect(postMediaForType(items, 'images')).toEqual([items[0]]);
  });

  it('shows only videos in video mode', () => {
    expect(postMediaForType(items, 'video')).toEqual([items[1]]);
  });
});

describe('normalizePostMediaPickerTarget — tweet 2 regression', () => {
  it('treats a click event as tweet 2 instead of an extra-tweet id', () => {
    expect(normalizePostMediaPickerTarget({ type: 'click' })).toBeNull();
  });

  it('keeps an extra tweet id', () => {
    expect(normalizePostMediaPickerTarget(3)).toBe(3);
  });
});

describe('groupPostMedia — proof media tweets', () => {
  const kind = (path) => path.endsWith('.mp4') ? 'video' : 'image';

  it('packs up to four files of the same type into one tweet', () => {
    expect(groupPostMedia(
      ['media/1.mp4', 'media/2.mp4', 'media/3.mp4', 'media/4.mp4'], kind,
    )).toEqual([{
      mediaType: 'video',
      mediaPaths: ['media/1.mp4', 'media/2.mp4', 'media/3.mp4', 'media/4.mp4'],
    }]);
  });

  it('separates images and videos', () => {
    expect(groupPostMedia(
      ['media/1.mp4', 'media/1.jpg', 'media/2.mp4', 'media/2.jpg'], kind,
    )).toEqual([
      { mediaType: 'video', mediaPaths: ['media/1.mp4', 'media/2.mp4'] },
      { mediaType: 'images', mediaPaths: ['media/1.jpg', 'media/2.jpg'] },
    ]);
  });

  it('starts another same-type tweet after four files', () => {
    expect(groupPostMedia(
      ['media/1.jpg', 'media/2.jpg', 'media/3.jpg', 'media/4.jpg', 'media/5.jpg'], kind,
    )).toEqual([
      { mediaType: 'images', mediaPaths: ['media/1.jpg', 'media/2.jpg', 'media/3.jpg', 'media/4.jpg'] },
      { mediaType: 'images', mediaPaths: ['media/5.jpg'] },
    ]);
  });
});

describe('templateFromPost / normPostTemplate — round-trip', () => {
  it('captures mention, body, media and extra-tweet skeleton, no content', () => {
    const t = templateFromPost({
      mention: '@Desk',
      body: '#coordinates\n#source',
      mediaEnabled: false,
      extraTweets: [{ id: 1, text: 'Boilerplate close' }],
    });
    expect(t).toEqual({
      mention: '@Desk',
      body: '#coordinates\n#source',
      mediaEnabled: false,
      extraTweets: [{ text: 'Boilerplate close' }],
    });
  });

  it('falls back to the default body when none is given', () => {
    expect(templateFromPost({ mention: '@x' }).body).toBe(DEFAULT_TWEET_BODY);
    expect(templateFromPost({ body: '   ' }).body).toBe(DEFAULT_TWEET_BODY);
  });

  it('fills shipped defaults for a bare blob', () => {
    expect(normPostTemplate({})).toEqual({
      mention: '@GeoConfirmed', body: DEFAULT_TWEET_BODY, mediaEnabled: true, extraTweets: [],
    });
  });

  it('migrates a legacy toggle template to a token body', () => {
    const legacy = { toggles: { showHeader: false, showDescription: false, showCoords: true, showMention: false, showSource: true } };
    expect(normPostTemplate(legacy).body).toBe('#coordinates\n\nSource: #source');
  });

  it('a token template survives a save → normalise round-trip unchanged', () => {
    const stored = templateFromPost({
      mention: '@Desk', body: '#place\n#coordinates', mediaEnabled: false,
      extraTweets: [{ text: 'a' }, { text: 'b' }],
    });
    expect(normPostTemplate(stored)).toEqual(stored);
  });

  it('preserves an intentionally blank mention', () => {
    const stored = templateFromPost({ mention: '', body: '#place' });
    expect(normPostTemplate(stored).mention).toBe('');
  });

  it('caps malformed hand-edited arrays and strings', () => {
    const normalized = normPostTemplate({
      mention: 'm'.repeat(200),
      body: 'b'.repeat(20_000),
      extraTweets: Array.from({ length: 25 }, () => ({ text: 'x'.repeat(5_000) })),
    });
    expect(normalized.mention).toHaveLength(120);
    expect(normalized.body).toHaveLength(16_000);
    expect(normalized.extraTweets).toHaveLength(20);
    expect(normalized.extraTweets[0].text).toHaveLength(4_000);
  });
});

describe('applyPostTemplateStructure — replace the whole skeleton', () => {
  it('clears existing extra posts when the template has none', () => {
    const current = {
      mention: '@Old', body: '#source', mediaEnabled: true,
      extraTweets: [{ text: 'Old', mediaPaths: ['media/a.png'] }],
    };
    const applied = applyPostTemplateStructure(current, {
      mention: '', body: '#place', mediaEnabled: false, extraTweets: [],
    });
    expect(applied).toMatchObject({
      mention: '', body: '#place', mediaEnabled: false, extraTweets: [],
    });
  });

  it('drops attachments when creating template extra posts', () => {
    const applied = applyPostTemplateStructure({}, { extraTweets: [{ text: 'Close' }] });
    expect(applied.extraTweets).toEqual([{
      text: 'Close', mediaPaths: [], mediaType: 'none',
      isMediaTweet: false, mediaTextIncludesPrefix: false,
    }]);
  });
});

describe('templateUsesPostField — compose fields controlled by a template', () => {
  it('disables fields whose tokens are absent', () => {
    const body = '#coordinates\n#source';
    expect(templateUsesPostField(body, 'coordinates')).toBe(true);
    expect(templateUsesPostField(body, 'source')).toBe(true);
    expect(templateUsesPostField(body, 'description')).toBe(false);
    expect(templateUsesPostField(body, 'place')).toBe(false);
    expect(templateUsesPostField(body, 'mention')).toBe(false);
  });

  it('keeps coordinates available when they can resolve a place or plus code', () => {
    expect(templateUsesPostField('#place', 'coordinates')).toBe(true);
    expect(templateUsesPostField('#pluscode', 'coordinates')).toBe(true);
  });
});

describe('proofSourceMediaPaths — source media selected from a proof', () => {
  it('uses original source media behind a derived frame', () => {
    const data = {
      entities: [
        { id: 'proof', type: 'proof', attrs: { path: 'proofs/check.png' } },
        { id: 'frame', type: 'media', attrs: { path: 'media/frame.jpg', kind: 'image' } },
        { id: 'video', type: 'media', attrs: { path: 'media/clip.mp4', kind: 'video' } },
        { id: 'photo', type: 'media', attrs: { path: 'media/still.jpg', kind: 'image' } },
        { id: 'capture', type: 'capture', attrs: { path: 'media/satellite.png', kind: 'image' } },
        { id: 'collage', type: 'media', attrs: { path: 'media/collage.png', kind: 'image' } },
      ],
      links: [
        { from: 'proof', to: 'frame', type: 'derived-from' },
        { from: 'proof', to: 'photo', type: 'derived-from' },
        { from: 'proof', to: 'capture', type: 'derived-from' },
        { from: 'proof', to: 'collage', type: 'derived-from' },
        { from: 'frame', to: 'video', type: 'derived-from' },
      ],
    };
    const media = [
      { path: 'media/frame.jpg', source: { type: 'inspect', from: 'media/clip.mp4' } },
      { path: 'media/clip.mp4', source: { type: 'download', url: 'https://source.test/post', webpage_url: 'https://source.test/post' } },
      { path: 'media/still.jpg', source: { type: 'download', url: 'https://other.test/post' } },
      { path: 'media/collage.png', source: { op: 'collage', sources: ['media/still.jpg'] } },
    ];
    expect(proofSourceMediaPaths(data, 'proofs/check.png', 'https://source.test/post', media))
      .toEqual(['media/clip.mp4']);
  });

  it('does not select media without a matching proof source', () => {
    expect(proofSourceMediaPaths({ entities: [], links: [] }, 'proofs/missing.png', 'https://source.test/post')).toEqual([]);
  });
});

describe('post targets', () => {
  it('keeps legacy and unknown draft targets on X', () => {
    expect(postTarget()).toMatchObject({ id: 'x', limit: 280 });
    expect(postTarget('unknown')).toMatchObject({ id: 'x' });
  });

  it('counts links for X and Mastodon, but graphemes for Bluesky', () => {
    expect(postCharacterCount('x', 'A https://example.test/very-long-url')).toBe(25);
    expect(postCharacterCount('mastodon', 'A https://example.test/very-long-url')).toBe(25);
    expect(postCharacterCount('bluesky', 'A https://example.test/very-long-url')).toBe(36);
    expect(postCharacterCount('bluesky', '👍🏽')).toBe(1);
  });

  it('builds the official compose handoff for each social target', () => {
    expect(postComposeUrl('x', 'A post')).toBe('https://x.com/intent/post?text=A%20post');
    expect(postComposeUrl('bluesky', 'A post')).toBe('https://bsky.app/intent/compose?text=A%20post');
    expect(postComposeUrl('mastodon', 'A post')).toBe('https://share.joinmastodon.org/#text=A%20post');
  });
});

describe('postReportMarkdown', () => {
  it('renders a structured report with links, maps and embedded case media', () => {
    const report = postReportMarkdown({
      title: 'Rooftop match',
      place: 'Bakhmut, Ukraine',
      plusCode: '8FPGXXXX+XX',
      coordinates: '48.850000, 2.350000',
      dms: '48°51′00.0″N 2°21′00.0″E',
      mapLinks: {
        Google: 'https://maps.example.test',
        OSM: 'https://osm.example.test',
      },
      description: 'Match against reference imagery.',
      source: 'https://example.test/source',
      attachments: ['proofs/match.png', 'media/a.jpg', 'media/a.jpg'],
      proofEntity: { id: 'e_proof', label: 'Rooftop proof', attrs: { path: 'proofs/match.png' } },
      mediaEntities: [{ id: 'e_frame', label: 'Frame', attrs: { path: 'media/a.jpg', kind: 'image' } }],
    });

    expect(report).toContain('| Coordinates | `48.850000, 2.350000` |');
    expect(report).toContain('| Maps | [Google](https://maps.example.test) · [OSM](https://osm.example.test) |');
    expect(report).toContain('[Open original source](https://example.test/source)');
    expect(report).toContain('## Assessment\n\nMatch against reference imagery.');
    expect(report).not.toContain('## Prepared thread');
    expect(report).toContain('[[entity:e_proof|Rooftop proof]]');
    expect(report).toContain('[[media:e_proof|Rooftop proof]]{width=100% align=center}');
    expect(report).toContain('[[entity:e_frame|Frame]]');
    expect(report).toContain('[[media:e_frame|Frame]]{width=100% align=center}');
    expect(report).not.toContain('- proofs/match.png');
  });

  it('always gives an otherwise empty export a title', () => {
    expect(postReportMarkdown()).toBe('# Untitled report\n');
  });
});
