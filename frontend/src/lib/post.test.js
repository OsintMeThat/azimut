import { describe, it, expect } from 'vitest';
import {
  TWEET_TOKENS, DEFAULT_TWEET_BODY, tweetFields, buildTweet1,
  extraPostTweetText, groupPostMedia, mediaTweetText, newPostMediaTweet,
  applyPostTemplateStructure, normalizePostMediaPickerTarget, normPostTemplate, postMediaForType,
  handoffThread, postCharacterCount, postComposeUrl, postHandoffUrl, postReportMarkdown, postTarget,
  proofSourceMediaPaths, renumberMediaTweetText, retargetMediaTweetText, withPostClip,
  sourceSection, sourceUrls,
  templateFromPost, templateUsesPostField, togglePostMedia,
  pointLines, postCoordinates, splitPointLine, postDate,
  POST_TEMPLATE_STARTERS, bodyTokens, fixMisspelledToken, misspelledTokens,
  POST_KINDS, STARTABLE_POST_KINDS, normalizePostKind, statedPostKind, postKind, tokensForKind,
  videoTitle, postTemplateKind, postStarters, defaultPostTemplate, templatesOfKind,
  startMediaPlan, replyTarget, replyIntentUrl, replyPostText, replyByDefault,
  postedAddress, postedDay, postedWhen, postLinkDate, postState, postStateLabel, postFingerprint, POST_STATES,
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

describe('#timecode — the time a proof of a video states', () => {
  const timed = { ...full, timecode: '[0:00–0:07]' };

  it('prints on its own line right under the description in the classic layout', () => {
    expect(buildTweet1(DEFAULT_TWEET_BODY, timed)).toBe(
      'Bakhmut, Donetsk, Ukraine - 8FPGXXXX+XX\n\n' +
      'Rooftop match\n[0:00–0:07]\n\n' +
      '48.850000, 2.350000\n\n' +
      '@GeoConfirmed\n\n' +
      'Source: https://x.com/a/1'
    );
  });

  it('drops its line for a photo or the whole video, so that post is as it always was', () => {
    expect(buildTweet1(DEFAULT_TWEET_BODY, { ...full, timecode: '' })).toBe(buildTweet1(DEFAULT_TWEET_BODY, full));
  });

  it('is in the Classic, With date and Short layouts, and not in Coordinates only', () => {
    const byId = Object.fromEntries(POST_TEMPLATE_STARTERS.map((one) => [one.id, one]));
    for (const id of ['classic', 'dated', 'short']) expect(bodyTokens(byId[id].body), id).toContain('#timecode');
    expect(bodyTokens(byId.coordinates.body)).not.toContain('#timecode');
    expect(buildTweet1(byId.dated.body, { ...timed, date: '2025-10-24' })).toContain('Rooftop match\n[0:00–0:07]\n\nFilmed: 2025-10-24');
    expect(buildTweet1(byId.short.body, timed)).toBe('Bakhmut, Donetsk, Ukraine\n48.850000, 2.350000\n[0:00–0:07]\n\nSource: https://x.com/a/1');
  });

  it('is offered to a geolocation template as well as a video thread', () => {
    expect(tokensForKind('geolocation').map((t) => t.tag)).toContain('#timecode');
    expect(tokensForKind('video').map((t) => t.tag)).toContain('#timecode');
    expect(tokensForKind('free').map((t) => t.tag)).not.toContain('#timecode');
    expect(templateUsesPostField(DEFAULT_TWEET_BODY, 'timecode')).toBe(true);
    expect(templateUsesPostField('#coordinates', 'timecode')).toBe(false);
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
      '#place', '#pluscode', '#coordinates', '#description', '#mention', '#source', '#date',
      '#video', '#timecode', '#scenes', '#credits',
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
      mention: 'm'.repeat(400),
      body: 'b'.repeat(20_000),
      extraTweets: Array.from({ length: 25 }, () => ({ text: 'x'.repeat(5_000) })),
    });
    expect(normalized.mention).toHaveLength(280);
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

describe('bodyTokens and misspelledTokens — what a layout will and will not fill', () => {
  it('lists the tokens a body holds, in order, and leaves a longer word alone', () => {
    expect(bodyTokens('#Place - #pluscode\n#placement #dates')).toEqual(['#place', '#pluscode']);
  });

  it('names a word that is one edit from a token, with the token it meant', () => {
    expect(misspelledTokens('#coordinate\n#Sources and #plus_code')).toEqual([
      { written: '#coordinate', meant: '#coordinates' },
      { written: '#Sources', meant: '#source' },
      { written: '#plus_code', meant: '#pluscode' },
    ]);
  });

  it('says nothing about real tokens, real hashtags, or a word named twice', () => {
    expect(misspelledTokens('#place #mention #osint #geolocation')).toEqual([]);
    expect(misspelledTokens('#coordinate and #coordinate')).toHaveLength(1);
  });
});

describe('fixMisspelledToken — the one-click correction', () => {
  it('swaps every whole-word occurrence and leaves the longer token next to it alone', () => {
    const body = '#coordinate\n#coordinates\nagain #coordinate, and #coordinate-x';
    expect(fixMisspelledToken(body, '#coordinate', '#coordinates')).toBe(
      '#coordinates\n#coordinates\nagain #coordinates, and #coordinate-x',
    );
  });

  it('matches the case it was written in, and takes a separator as part of the word', () => {
    expect(fixMisspelledToken('#Sources #sources', '#Sources', '#source')).toBe('#source #sources');
    expect(fixMisspelledToken('#plus_code and #plus_codes', '#plus_code', '#pluscode')).toBe(
      '#pluscode and #plus_codes',
    );
  });

  it('leaves a body with no such word exactly as it was, and a fixed one clean', () => {
    expect(fixMisspelledToken('#place', '#coordinate', '#coordinates')).toBe('#place');
    const fixed = fixMisspelledToken('#coordinate\n#Sources', '#coordinate', '#coordinates');
    expect(misspelledTokens(fixed)).toEqual([{ written: '#Sources', meant: '#source' }]);
  });
});

describe('POST_TEMPLATE_STARTERS — where a new template starts', () => {
  it('starts with the classic thread, unchanged', () => {
    expect(POST_TEMPLATE_STARTERS[0]).toMatchObject({ id: 'classic', body: DEFAULT_TWEET_BODY });
  });

  it('gives every starter its own id and a name to show', () => {
    const ids = POST_TEMPLATE_STARTERS.map((starter) => starter.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const starter of POST_TEMPLATE_STARTERS) expect(starter.label.trim()).not.toBe('');
  });

  it('writes only real tokens, so no starter goes out with text that looks like one', () => {
    for (const starter of POST_TEMPLATE_STARTERS) {
      expect(misspelledTokens(starter.body), starter.id).toEqual([]);
      expect(bodyTokens(starter.body).length, starter.id).toBeGreaterThan(0);
    }
  });

  it('is read-only, so one editor cannot change what the next one offers', () => {
    expect(Object.isFrozen(POST_TEMPLATE_STARTERS)).toBe(true);
    for (const starter of POST_TEMPLATE_STARTERS) expect(Object.isFrozen(starter)).toBe(true);
  });

  it('offers a dated layout that shows the date, and one that leaves it out', () => {
    const byId = Object.fromEntries(POST_TEMPLATE_STARTERS.map((s) => [s.id, s]));
    const fields = { ...full, date: '2025-10-24 14:30 UTC+3' };
    expect(buildTweet1(byId.dated.body, fields)).toContain('Filmed: 2025-10-24 14:30 UTC+3');
    expect(buildTweet1(byId.classic.body, fields)).not.toContain('2025-10-24');
    expect(buildTweet1(byId.dated.body, full)).not.toContain('Filmed');
  });

  it('builds the short and coordinates-only layouts the way their names promise', () => {
    const byId = Object.fromEntries(POST_TEMPLATE_STARTERS.map((s) => [s.id, s]));
    expect(buildTweet1(byId.coordinates.body, full)).toBe('48.850000, 2.350000\n\n@GeoConfirmed');
    expect(buildTweet1(byId.short.body, full)).toBe(
      'Bakhmut, Donetsk, Ukraine\n48.850000, 2.350000\n\nSource: https://x.com/a/1',
    );
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

describe('withPostClip — the clip cut for the post, in place of its video', () => {
  const clip = { video: 'media/convoy.mp4', path: 'media/convoy 0.03-0.09.mp4' };

  it('puts the clip where the whole video was, and keeps the rest in their order', () => {
    expect(withPostClip(['media/still.jpg', 'media/convoy.mp4', 'media/other.mp4'], clip))
      .toEqual(['media/still.jpg', 'media/convoy 0.03-0.09.mp4', 'media/other.mp4']);
  });

  it('leads with the clip when its video was not among them, and never lists it twice', () => {
    expect(withPostClip(['media/still.jpg'], clip)).toEqual(['media/convoy 0.03-0.09.mp4', 'media/still.jpg']);
    expect(withPostClip([], clip)).toEqual(['media/convoy 0.03-0.09.mp4']);
    expect(withPostClip(['media/convoy 0.03-0.09.mp4', 'media/convoy.mp4'], clip)).toEqual(['media/convoy 0.03-0.09.mp4']);
  });

  it('leaves the media as they were without a clip', () => {
    for (const none of [null, undefined, {}, { video: 'media/convoy.mp4', path: '' }]) {
      expect(withPostClip(['media/convoy.mp4', null], none)).toEqual(['media/convoy.mp4']);
    }
  });
});

describe('post targets', () => {
  it('keeps legacy and unknown draft targets on X', () => {
    expect(postTarget()).toMatchObject({ id: 'x', limit: 280 });
    expect(postTarget('unknown')).toMatchObject({ id: 'x' });
  });

  it('counts links for X, but graphemes for Bluesky', () => {
    expect(postCharacterCount('x', 'A https://example.test/very-long-url')).toBe(25);
    expect(postCharacterCount('bluesky', 'A https://example.test/very-long-url')).toBe(36);
    expect(postCharacterCount('bluesky', '👍🏽')).toBe(1);
  });

  it('builds the official compose handoff for each social target', () => {
    expect(postComposeUrl('x', 'A post')).toBe('https://x.com/intent/post?text=A%20post');
    expect(postComposeUrl('bluesky', 'A post')).toBe('https://bsky.app/intent/compose?text=A%20post');
  });

  it('opens the full composer where the extension takes over, since that is the one that threads', () => {
    // The intent page posts one message. The run of posts under the first is the
    // whole point of handing over, so it needs the composer that builds a thread.
    expect(postHandoffUrl('x', 'A post')).toBe('https://x.com/compose/post?text=A%20post');
    expect(postHandoffUrl('bluesky', 'A post')).toBe('https://bsky.app/intent/compose?text=A%20post');
  });

  it('opens a dropped or hand-edited target on X, like every other reader of one', () => {
    // Mastodon was a target and is not: its share link is a redirector that asks
    // which server first, so nothing could say where the thread was going.
    expect(postHandoffUrl('mastodon', 'A post')).toBe('https://x.com/compose/post?text=A%20post');
    expect(postComposeUrl('mastodon', 'A post')).toBe('https://x.com/intent/post?text=A%20post');
    expect(postTarget('mastodon').id).toBe('x');
  });
});

describe('handoffThread — the thread as the extension receives it', () => {
  it('pairs each post with the case files it carries', () => {
    const { posts, dropped } = handoffThread([
      { text: 'Geolocated.', files: ['proofs/strike.png'] },
      { text: 'Video:', files: ['media/clip.mp4'] },
    ]);

    expect(posts).toEqual([
      { text: 'Geolocated.', files: ['proofs/strike.png'] },
      { text: 'Video:', files: ['media/clip.mp4'] },
    ]);
    expect(dropped).toBe(0);
  });

  it('keeps a post that is only a picture, and drops one that is nothing', () => {
    const { posts } = handoffThread([
      { text: '   ', files: ['media/a.jpg'] },
      { text: '', files: [] },
      { text: 'Context.' },
    ]);

    expect(posts).toEqual([
      { text: '   ', files: ['media/a.jpg'] },
      { text: 'Context.', files: [] },
    ]);
  });

  it('counts what a post cannot carry rather than losing it quietly', () => {
    const files = ['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg', 'e.jpg', 'f.jpg'];
    const { posts, dropped } = handoffThread([{ text: 'Five angles', files }]);

    expect(posts[0].files).toEqual(['a.jpg', 'b.jpg', 'c.jpg', 'd.jpg']);
    expect(dropped).toBe(2);
  });

  it('survives an absent list', () => {
    expect(handoffThread()).toEqual({ posts: [], dropped: 0 });
  });
});

describe('sourceSection — a proof resting on more than one post', () => {
  it('links every address when the line is nothing but addresses', () => {
    // The composer hands over one address per line, so this is the ordinary shape of a
    // proof built from two posts. A run separated by dots is what proofs saved before
    // that carried, and it reads the same.
    const listed = [
      '- [https://x.com/a/1](https://x.com/a/1)',
      '- [https://t.me/b/2](https://t.me/b/2)',
    ].join('\n');
    expect(sourceSection('https://x.com/a/1\nhttps://t.me/b/2')).toBe(listed);
    expect(sourceSection('https://x.com/a/1  ·  https://t.me/b/2')).toBe(listed);
    // One address keeps the reading it always had.
    expect(sourceSection('https://x.com/a/1')).toBe('[Open original source](https://x.com/a/1)');
  });

  it('prints prose instead of linking it', () => {
    expect(sourceSection('handed to me on a stick')).toBe('handed to me on a stick');
    // A line that starts with an address and goes on saying something used to be
    // wrapped whole in one href, which is a dead link either way.
    expect(sourceSection('https://x.com/a/1 reposted from elsewhere')).toBe(
      'https://x.com/a/1 reposted from elsewhere',
    );
    expect(sourceSection('')).toBe('');
  });

  it('keeps the report and the media matcher reading the same line', () => {
    const line = 'https://x.com/a/1\nhttps://t.me/b/2';
    const report = postReportMarkdown({ title: 'Two posts', source: line });
    expect(report).toContain('- [https://x.com/a/1](https://x.com/a/1)');
    expect(report).toContain('- [https://t.me/b/2](https://t.me/b/2)');
    expect(report).not.toContain(`(${line})`); // the one broken href this replaces
    // And the matcher reads the same block the report just rendered.
    expect(sourceUrls(line)).toEqual(['https://x.com/a/1', 'https://t.me/b/2']);
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


describe('the points a post carries', () => {
  it('reads a line with a name and a line without', () => {
    expect(splitPointLine('impact 2 — 64.148100, -21.940100')).toEqual({
      label: 'impact 2', coords: '64.148100, -21.940100',
    });
    expect(splitPointLine('  64.148100, -21.940100 ')).toEqual({
      label: '', coords: '64.148100, -21.940100',
    });
  });

  it('drops the blank lines a pasted block leaves behind', () => {
    expect(pointLines('64.1466, -21.9426\n\n  \nb — 1, 2')).toEqual([
      { label: '', coords: '64.1466, -21.9426' },
      { label: 'b', coords: '1, 2' },
    ]);
  });

  it('reads the resolved point in decimal and the rest as written', () => {
    // the first line is the one the post looked up, so it reads as it always has
    expect(postCoordinates('64°08\'48"N 21°56\'33"W\nimpact 2 — 64.1481, -21.9401', {
      lat: 64.1466, lon: -21.9426,
    })).toBe('64.146600, -21.942600\nimpact 2 — 64.1481, -21.9401');
  });

  it('keeps the name of the point it resolved', () => {
    expect(postCoordinates('caméra — 64.1466, -21.9426', { lat: 64.1466, lon: -21.9426 }))
      .toBe('caméra — 64.146600, -21.942600');
  });

  it('carries one point exactly as it did before the list', () => {
    expect(tweetFields({ lat: 48.85, lon: 2.35 }).coordinates).toBe('48.850000, 2.350000');
  });

  it('carries every point into the tweet, one per line', () => {
    const fields = tweetFields({
      lat: 64.1466, lon: -21.9426,
      coordsText: 'impact 1 — 64.1466, -21.9426\nimpact 2 — 64.1481, -21.9401',
    });
    expect(fields.coordinates).toBe(
      'impact 1 — 64.146600, -21.942600\nimpact 2 — 64.1481, -21.9401'
    );
  });

  it('tables the points in the report, once there is more than one', () => {
    const report = postReportMarkdown({
      title: 'Harbour strike',
      coordinates: '64.146600, -21.942600',
      points: [
        { label: 'impact 1', coords: '64.1466, -21.9426' },
        { label: '', coords: '64.1481, -21.9401' },
      ],
    });
    expect(report).toContain('## Points');
    expect(report).toContain('| impact 1 | `64.1466, -21.9426` |');
    expect(report).toContain('| Point 2 | `64.1481, -21.9401` |'); // unnamed takes its rank
  });

  it('leaves a single-point report the shape it had', () => {
    const report = postReportMarkdown({
      title: 'One point',
      coordinates: '64.146600, -21.942600',
      points: [{ label: '', coords: '64.1466, -21.9426' }],
    });
    expect(report).not.toContain('## Points');
  });
});

describe('#date — the date a proof states, only where a template asks for it', () => {
  it('fills its own line and drops it when there is no date', () => {
    const body = '#place\n\nFilmed: #date\n\n#coordinates';
    expect(buildTweet1(body, { ...full, date: '2024-03-12' }))
      .toBe('Bakhmut, Donetsk, Ukraine\n\nFilmed: 2024-03-12\n\n48.850000, 2.350000');
    expect(buildTweet1(body, { ...full, date: '' }))
      .toBe('Bakhmut, Donetsk, Ukraine\n\n48.850000, 2.350000');
  });

  it('never enters the classic thread on its own', () => {
    expect(DEFAULT_TWEET_BODY).not.toContain('#date');
    expect(templateUsesPostField(DEFAULT_TWEET_BODY, 'date')).toBe(false);
    expect(templateUsesPostField('Filmed: #Date', 'date')).toBe(true);
  });

  it('leaves a longer hashtag a template already carried alone', () => {
    expect(templateUsesPostField('#dates #placement', 'date')).toBe(false);
    expect(templateUsesPostField('#dates #placement', 'place')).toBe(false);
    expect(buildTweet1('#placement #dates', { ...full, date: '2024-03-12' })).toBe('#placement #dates');
  });
});

describe('postDate — the stored value, in no language, with its clock', () => {
  it('keeps a date or a range of dates exactly as the case holds it', () => {
    expect(postDate('2024-03-12', 'Europe/Kyiv')).toBe('2024-03-12');
    expect(postDate('2024-03~')).toBe('2024-03~');
    expect(postDate('2024-03-12/2024-03-15?')).toBe('2024-03-12/2024-03-15?');
    expect(postDate('')).toBe('');
  });

  it('says which clock a time is on, as an offset from UTC on that day', () => {
    expect(postDate('2024-07-12T14:30:00', 'Europe/Kyiv')).toBe('2024-07-12 14:30 UTC+3');
    expect(postDate('2024-01-12T14:30:00', 'Europe/Kyiv')).toBe('2024-01-12 14:30 UTC+2');
    expect(postDate('2024-01-12T14:30:00Z')).toBe('2024-01-12 14:30 UTC');
    expect(postDate('2024-01-12T14:30:15+05:30')).toBe('2024-01-12 14:30:15 UTC+5:30');
    // Across a clock change the offset is the one in force at that hour.
    expect(postDate('2024-03-31T01:30:00', 'Europe/Paris')).toBe('2024-03-31 01:30 UTC+1');
    expect(postDate('2024-03-31T03:30:00', 'Europe/Paris')).toBe('2024-03-31 03:30 UTC+2');
  });

  it('names no clock it does not know', () => {
    expect(postDate('2024-01-12T14:30:00')).toBe('2024-01-12 14:30');
    expect(postDate('2024-01-12T14:30:00', 'Not/AZone')).toBe('2024-01-12 14:30');
  });

  it('writes a span of times once, with its clock at the end', () => {
    expect(postDate('2024-01-12T14:30:00/2024-01-12T15:00:00', 'Asia/Tokyo')).toBe('2024-01-12 14:30/15:00 UTC+9');
    expect(postDate('2024-01-12T23:30:00Z/2024-01-13T01:00:00Z')).toBe('2024-01-12 23:30/2024-01-13 01:00 UTC');
  });
});


// -- Post: kinds, the new tokens, the reply under the source -----------------------

describe('the geolocation road, pinned', () => {
  // What a proof sent with To Post has always written with the classic layout. Kinds,
  // new tokens and replies are layered over this; none of them may move a character.
  const proof = {
    place: 'Los Anacuos, Miranda, Venezuela',
    plusCode: '76XH+8F5',
    description: 'A formation of 13 helicopters was spotted heading East',
    lat: 10.303315, lon: -66.874095,
    coordsText: '10.303315, -66.874095\nCamera — 10.3031, -66.8745',
    mention: '@GeoConfirmed',
    source: 'https://x.com/someone/status/1850000000000000000',
    date: '2025-10-24 14:30 UTC+3',
  };

  it('writes the same first post as before', () => {
    expect(buildTweet1(DEFAULT_TWEET_BODY, proof)).toBe([
      'Los Anacuos, Miranda, Venezuela - 76XH+8F5',
      '',
      'A formation of 13 helicopters was spotted heading East',
      '',
      '10.303315, -66.874095',
      'Camera — 10.3031, -66.8745',
      '',
      '@GeoConfirmed',
      '',
      'Source: https://x.com/someone/status/1850000000000000000',
    ].join('\n'));
  });

  it('opens the same pages as before', () => {
    expect(postComposeUrl('x', 'A')).toBe('https://x.com/intent/post?text=A');
    expect(postHandoffUrl('x', 'A')).toBe('https://x.com/compose/post?text=A');
  });
});

describe('POST_KINDS — what a post is made from', () => {
  it('offers five starts, Geolocation first, and opens the four that are built', () => {
    expect(POST_KINDS.map((k) => k.id)).toEqual(['geolocation', 'video', 'plate', 'compare', 'free']);
    expect(STARTABLE_POST_KINDS).toEqual(['geolocation', 'plate', 'compare', 'free']);
    expect(postKind('compare')).toMatchObject({ label: 'Compare', icon: 'compare' });
    for (const k of POST_KINDS) expect(k.label && k.icon && k.text).toBeTruthy();
  });

  it('reads anything unknown or absent as a geolocation, and writes a geolocation as nothing', () => {
    for (const odd of [undefined, null, '', 'telegram', 3]) expect(normalizePostKind(odd)).toBe('geolocation');
    expect(normalizePostKind('free')).toBe('free');
    expect(normalizePostKind('compare')).toBe('compare');
    expect(normalizePostKind('Compare')).toBe('geolocation');
    expect(statedPostKind('compare')).toBe('compare');
    expect(statedPostKind('geolocation')).toBeUndefined();
    expect(statedPostKind('nonsense')).toBeUndefined();
    expect(statedPostKind('plate')).toBe('plate');
    expect(postKind('video').label).toBe('Video thread');
  });

  it('offers each kind the tokens it can fill', () => {
    expect(tokensForKind('free').map((t) => t.tag)).not.toContain('#coordinates');
    expect(tokensForKind('compare').map((t) => t.tag)).toEqual(['#description', '#mention', '#source', '#date', '#credits']);
    expect(tokensForKind('video').map((t) => t.tag)).toEqual(expect.arrayContaining(['#timecode', '#scenes', '#video']));
    expect(tokensForKind(undefined).map((t) => t.tag)).toContain('#coordinates');
    expect(tokensForKind('geolocation').map((t) => t.tag)).not.toContain('#scenes');
  });
});

describe('the new tokens', () => {
  it('fill #video with the title, never the file name', () => {
    expect(videoTitle({ title: '  Convoy at dawn ', filename: 'clip.mp4' })).toBe('Convoy at dawn');
    expect(videoTitle({ filename: 'clip.mp4' })).toBe('');
    expect(buildTweet1('#video\n\n#coordinates', { ...full, video: 'Convoy at dawn' }))
      .toBe('Convoy at dawn\n\n48.850000, 2.350000');
  });

  it('drop their line while nothing fills them, so a template can name them today', () => {
    const body = '#description\nAt #timecode\n#scenes\nImagery: #credits\nFrom #video';
    expect(buildTweet1(body, full)).toBe('Rooftop match');
    expect(buildTweet1(body, { ...full, timecode: '[0:00–0:07]', credits: 'Copernicus Sentinel-2' }))
      .toBe('Rooftop match\nAt [0:00–0:07]\nImagery: Copernicus Sentinel-2');
  });

  it('are known to the typo check, like the tokens before them', () => {
    expect(bodyTokens('#credits #timecode #scenes #video')).toEqual(['#credits', '#timecode', '#scenes', '#video']);
    expect(misspelledTokens('#credit and #timecodes and #vide')).toEqual([
      { written: '#credit', meant: '#credits' },
      { written: '#timecodes', meant: '#timecode' },
      { written: '#vide', meant: '#video' },
    ]);
  });
});

describe('post templates per kind', () => {
  it('writes the kind and the reply default only when they say something', () => {
    expect(templateFromPost({ body: '#place', kind: 'geolocation' })).not.toHaveProperty('kind');
    expect(templateFromPost({ body: '#place', kind: 'free', reply: true }))
      .toMatchObject({ kind: 'free', reply: true });
    for (const none of [false, 'keep-source', 'drop-source', 'sometimes']) {
      expect(templateFromPost({ body: '#place', reply: none })).not.toHaveProperty('reply');
      expect(normPostTemplate({ body: '#place', reply: none })).not.toHaveProperty('reply');
    }
    expect(normPostTemplate({ body: '#place', reply: true }).reply).toBe(true);
    expect(normPostTemplate({ body: '#place', kind: 'plate' }).kind).toBe('plate');
    expect(postTemplateKind({ body: '#place' })).toBe('geolocation');
  });

  it('starts Geolocation on the four layouts it had, the plate and the free post on one each, and Compare on two', () => {
    expect(postStarters('geolocation')).toBe(POST_TEMPLATE_STARTERS);
    expect(postStarters('plate').map((s) => s.id)).toEqual(['plate']);
    expect(postStarters('free').map((s) => s.id)).toEqual(['free']);
    expect(postStarters('compare').map((s) => s.label)).toEqual(['Before and after', 'Dates first']);
    expect(postStarters('compare')[0].body).toBe('#description\n\n#date\n\n#credits\n\n#mention');
    expect(postStarters('video')).toEqual([]);
    for (const starter of [...postStarters('plate'), ...postStarters('free'), ...postStarters('compare')]) {
      expect(misspelledTokens(starter.body)).toEqual([]);
      expect(starter.mediaEnabled).toBe(false);
    }
  });

  const templates = [
    { id: 'geo', name: 'Geo', data: { body: '#place' } },
    { id: 'free', name: 'Free', data: { body: '#description', kind: 'free' } },
    { id: 'plate', name: 'Plate', data: { body: '#description', kind: 'plate' } },
    { id: 'cmp', name: 'Before after', data: { body: '#description\n\n#date', kind: 'compare' } },
  ];

  it('finds each kind its default, Geolocation through the bookmark it always had', () => {
    const prefs = { geolocation: 'geo', byKind: { free: 'free', plate: 'geo' } };
    expect(defaultPostTemplate(templates, 'geolocation', prefs)?.id).toBe('geo');
    expect(defaultPostTemplate(templates, 'free', prefs)?.id).toBe('free');
    // an id that now names another kind's template is no default for this one
    expect(defaultPostTemplate(templates, 'plate', prefs)).toBeNull();
    expect(defaultPostTemplate(templates, 'geolocation', { geolocation: 'gone' })).toBeNull();
    expect(defaultPostTemplate(templates, 'video', prefs)).toBeNull();
    // Compare keeps a default of its own, and never takes the free post's
    expect(defaultPostTemplate(templates, 'compare', { byKind: { compare: 'cmp' } })?.id).toBe('cmp');
    expect(defaultPostTemplate(templates, 'compare', { byKind: { compare: 'free' } })).toBeNull();
    expect(defaultPostTemplate(templates, 'compare', prefs)).toBeNull();
  });

  it('lists a post only the templates of its kind', () => {
    expect(templatesOfKind(templates, 'geolocation').map((t) => t.id)).toEqual(['geo']);
    expect(templatesOfKind(templates, 'free').map((t) => t.id)).toEqual(['free']);
    expect(templatesOfKind(templates, 'compare').map((t) => t.id)).toEqual(['cmp']);
    // a template of a kind this build does not know reads as a geolocation one, as before
    expect(templatesOfKind([{ id: 'odd', data: { body: '#place', kind: 'telegram' } }], 'geolocation').map((t) => t.id)).toEqual(['odd']);
  });
});

describe('startMediaPlan — where a started post puts its media', () => {
  const kindOf = (path) => (path.endsWith('.mp4') ? 'video' : 'image');

  it('leaves a geolocation its first post for the proof', () => {
    const plan = startMediaPlan('geolocation', ['media/a.png', 'media/b.png'], kindOf);
    expect(plan.first).toBeNull();
    expect(plan.media).toEqual({ mediaType: 'images', mediaPaths: ['media/a.png', 'media/b.png'] });
  });

  it('puts another kind\'s first group on its first post, and the rest after it', () => {
    const plan = startMediaPlan('free', ['media/a.png', 'media/clip.mp4', 'media/b.png'], kindOf);
    expect(plan.first).toEqual({ mediaType: 'images', mediaPaths: ['media/a.png', 'media/b.png'] });
    expect(plan.media).toEqual({ mediaType: 'video', mediaPaths: ['media/clip.mp4'] });
    expect(plan.more).toEqual([]);
    expect(startMediaPlan('compare', ['media/Comparison blink.gif'], () => 'image').first)
      .toEqual({ mediaType: 'images', mediaPaths: ['media/Comparison blink.gif'] });
  });

  it('reads a file the media list does not know by its extension, and drops what is not a path', () => {
    const plan = startMediaPlan('plate', ['exports/plate.mp4', null, 'exports/plate.mp4', 3], () => undefined);
    expect(plan.first).toEqual({ mediaType: 'video', mediaPaths: ['exports/plate.mp4'] });
    expect(startMediaPlan('free', [], kindOf)).toEqual({ first: null, media: null, more: [] });
  });
});

describe('reply under the source', () => {
  it('finds the X or Bluesky post a source line points at, and nothing else', () => {
    expect(replyTarget('https://twitter.com/Some_one/status/185?s=20')).toEqual({
      site: 'x', id: '185', url: 'https://x.com/Some_one/status/185',
    });
    expect(replyTarget('https://instagram.com/p/1 · https://x.com/a/status/9')).toMatchObject({ site: 'x', id: '9' });
    expect(replyTarget('https://bsky.app/profile/someone.bsky.social/post/3kabc')).toEqual({
      site: 'bluesky', id: '3kabc', url: 'https://bsky.app/profile/someone.bsky.social/post/3kabc',
    });
    for (const none of ['', 'https://x.com/someone', 'https://x.com/a/status/abc', 'http://x.com/a/status/9',
      'https://evil.example/x.com/a/status/9', 'https://bsky.app/profile/a', 'seen on x.com/a/status/9']) {
      expect(replyTarget(none)).toBeNull();
    }
  });

  it('opens X\'s own reply page with the words in it', () => {
    expect(replyIntentUrl('185', 'Bakhmut & co')).toBe('https://x.com/intent/post?in_reply_to=185&text=Bakhmut%20%26%20co');
  });

  const fields = { ...full, source: 'https://x.com/a/status/1' };
  const written = buildTweet1(DEFAULT_TWEET_BODY, fields);

  it('leaves the source line out of a reply', () => {
    const reply = replyPostText({ text: written, body: DEFAULT_TWEET_BODY, fields });
    expect(reply).not.toContain('Source:');
    expect(reply).toBe(buildTweet1(DEFAULT_TWEET_BODY, { ...fields, source: '' }));
  });

  it('replies by default only where the template says so', () => {
    expect(replyByDefault({ reply: true })).toBe(true);
    // the two words a template of the first 0.3.4 builds said are no default
    for (const data of [{}, null, { reply: 'keep-source' }, { reply: 'drop-source' }, { reply: false }]) {
      expect(replyByDefault(data)).toBe(false);
    }
  });

  it('keeps what else a source line said in a post it rebuilds', () => {
    const reply = replyPostText({ body: '#description · #source', fields });
    expect(reply).toBe('Rooftop match');
  });

  it('takes only the lines naming the source out of a post the analyst rewrote', () => {
    const text = 'My own words\n\nVia https://x.com/a/status/1\n\n@GeoConfirmed';
    expect(replyPostText({ text, edited: true, body: DEFAULT_TWEET_BODY, fields }))
      .toBe('My own words\n\n@GeoConfirmed');
    expect(replyPostText({ text, edited: true, body: DEFAULT_TWEET_BODY, fields: { ...fields, source: '' } })).toBe(text);
  });
});

describe('whether a post went out', () => {
  it('takes the address of an X or Bluesky post as the browser shows it, written one way', () => {
    expect(postedAddress('https://x.com/Desk/status/1850000000000000001')).toEqual({ site: 'x', url: 'https://x.com/Desk/status/1850000000000000001' });
    expect(postedAddress(' twitter.com/Desk/status/9?s=20 ')).toEqual({ site: 'x', url: 'https://x.com/Desk/status/9' });
    expect(postedAddress('http://mobile.x.com/Desk/status/9/photo/1')).toEqual({ site: 'x', url: 'https://x.com/Desk/status/9' });
    expect(postedAddress('https://bsky.app/profile/desk.bsky.social/post/3kabc')).toEqual({
      site: 'bluesky', url: 'https://bsky.app/profile/desk.bsky.social/post/3kabc',
    });
    for (const none of ['', null, 'https://x.com/Desk', 'https://x.com/Desk/status/abc', 'https://evil.example/x.com/a/status/1',
      'https://bsky.app/profile/desk', 'Posted it!', 'https://instagram.com/p/abc']) {
      expect(postedAddress(none), String(none)).toBeNull();
    }
  });

  it('reads a draft, a posted one with or without its link, and one changed since', () => {
    expect(postState(undefined)).toBe('draft');
    expect(postState({})).toBe('draft');
    // what an earlier build wrote on opening the site: never posted, so a draft
    expect(postState({ opened_at: '2026-11-10T10:00:00Z', site: 'x' })).toBe('draft');
    expect(postState({ opened_at: '2026-11-10T10:00:00Z', url: 'https://x.com/a/status/1' })).toBe('posted');
    expect(postState({ site: 'x', posted_at: '2026-11-10T10:00:00Z', mark: 'm' })).toBe('posted');
    expect(postState({ url: 'https://x.com/a/status/1', changed: true })).toBe('changed');
    expect(postState({ site: 'bluesky', posted_at: '2026-11-10T10:00:00Z', changed: true })).toBe('changed');
    // a link that is no post is no posted post
    expect(postState({ url: 'https://example.com', posted_at: '2026-11-10T10:00:00Z' })).toBe('draft');
  });

  it('names the three states', () => {
    expect(POST_STATES.map((one) => one.id)).toEqual(['draft', 'posted', 'changed']);
    expect(postStateLabel('posted')).toBe('Posted');
    expect(postStateLabel('changed')).toBe('Changed since posted');
    expect(postStateLabel('opened')).toBe('Draft');
    expect(postStateLabel('nonsense')).toBe('Draft');
  });

  it('says a post\'s day, the year only outside this one', () => {
    const now = new Date(2026, 10, 11, 12);
    expect(postedDay('2026-11-09T12:00:00Z', now)).toBe('9 Nov');
    expect(postedDay('2025-01-02T12:00:00Z', now)).toBe('2 Jan 2025');
    expect(postedDay('soon', now)).toBe('');
    expect(postedDay(undefined, now)).toBe('');
  });

  describe('the day a post went out, read off its link', () => {
    // ids made here for known moments, as each site makes them
    const snowflake = (ms, low = 4095n) => (((BigInt(ms) - 1288834974657n) << 22n) | low).toString();
    const tid = (ms, clock = 7n) => {
      const alphabet = '234567abcdefghijklmnopqrstuvwxyz';
      let value = ((BigInt(ms) * 1000n + 321n) << 10n) | clock;
      let key = '';
      for (let i = 0; i < 13; i += 1) {
        key = alphabet[Number(value & 31n)] + key;
        value >>= 5n;
      }
      return key;
    };
    const NINTH = Date.UTC(2026, 10, 9, 8, 30, 15, 250);
    const FIRST_X = Date.UTC(2013, 2, 1, 0, 0, 0);

    it('reads an X status id as a snowflake, to the millisecond', () => {
      expect(postLinkDate(`https://x.com/desk/status/${snowflake(NINTH)}`)).toBe('2026-11-09T08:30:15.250Z');
      expect(postLinkDate(`https://twitter.com/desk/status/${snowflake(FIRST_X, 0n)}?s=20`)).toBe('2013-03-01T00:00:00.000Z');
    });

    it('reads a Bluesky record key as a TID', () => {
      expect(tid(NINTH)).toMatch(/^[2-7a-z]{13}$/);
      expect(postLinkDate(`https://bsky.app/profile/desk.bsky.social/post/${tid(NINTH)}`)).toBe('2026-11-09T08:30:15.250Z');
    });

    it('answers nothing for a link that holds no day', () => {
      for (const none of [
        '', null, 'https://example.com/a/status/1', 'https://x.com/desk',
        // an id from before the snowflakes, and one from after tomorrow
        'https://x.com/desk/status/20', `https://x.com/desk/status/${snowflake(Date.UTC(2099, 0, 1))}`,
        // a record key that is no TID: too short, a capital, its top bit set
        'https://bsky.app/profile/desk.bsky.social/post/3kabc', `https://bsky.app/profile/desk.bsky.social/post/${tid(NINTH).toUpperCase()}`,
        'https://bsky.app/profile/desk.bsky.social/post/zzzzzzzzzzzzz',
      ]) expect(postLinkDate(none), String(none)).toBeNull();
    });

    it('is the post\'s date, else the moment it was marked', () => {
      expect(postedWhen({ url: `https://x.com/desk/status/${snowflake(NINTH)}`, at: '2026-11-10T00:00:00Z' })).toBe('2026-11-09T08:30:15.250Z');
      expect(postedWhen({ url: null, at: '2026-11-10T00:00:00Z' })).toBe('2026-11-10T00:00:00Z');
      expect(postedWhen({ url: 'https://bsky.app/profile/desk.bsky.social/post/3kabc', at: '2026-11-10T00:00:00Z' })).toBe('2026-11-10T00:00:00Z');
      expect(postedWhen(null)).toBeNull();
    });
  });

  it('fingerprints what a post says, the same words the same print', () => {
    expect(postFingerprint('{"a":1}')).toBe(postFingerprint('{"a":1}'));
    expect(postFingerprint('{"a":1}')).not.toBe(postFingerprint('{"a":2}'));
    expect(postFingerprint('')).toMatch(/^[0-9a-z]+$/);
  });

  it('says where it went out in the note Add to notes writes', () => {
    const note = postReportMarkdown({ title: 'T', posted: { url: 'https://x.com/a/status/1', at: '2026-11-10T10:05:00Z' } });
    expect(note).toContain('## Posted\n\n[On X, 2026-11-10](https://x.com/a/status/1)');
    // marked posted with no link: where and when, nothing to follow
    expect(postReportMarkdown({ title: 'T', posted: { url: null, site: 'bluesky', at: '2026-11-09T10:05:00Z' } }))
      .toContain('## Posted\n\nOn Bluesky, 2026-11-09');
    expect(postReportMarkdown({ title: 'T', posted: { url: 'https://example.com', site: 'x', at: '2026-11-09T10:05:00Z' } }))
      .not.toContain('## Posted');
    expect(postReportMarkdown({ title: 'T' })).not.toContain('## Posted');
  });
});
