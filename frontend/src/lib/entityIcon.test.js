import { describe, expect, it, vi, beforeEach } from 'vitest';

const get = vi.fn();
vi.mock('./api.js', () => ({ api: { get: (...a) => get(...a) } }));

// The registry is the list now, so the fixture is the shape the API serves.
const VOCABULARY = [
  { type: 'place', label: 'Place', family: 'place', icon: 'pin', manual: false, group: '', attrs: [] },
  { type: 'capture', label: 'Capture', family: 'collected', icon: 'satellite', manual: false, group: '', attrs: [] },
  { type: 'media', label: 'Media', family: 'collected', icon: 'image', manual: false, group: '', attrs: [] },
  { type: 'claim', label: 'Claim', family: 'claim', icon: 'note', manual: true, group: '', attrs: [] },
  { type: 'vessel', label: 'Vessel', family: 'asset', icon: 'grip', manual: true, group: '', attrs: [] },
];

let mod;

beforeEach(async () => {
  vi.resetModules();
  get.mockReset();
  get.mockResolvedValue(VOCABULARY);
  mod = await import('./entityIcon.js');
  const types = await import('./entityTypes.svelte.js');
  await types.loadEntityTypes();
});

describe('entityIcon', () => {
  it('takes the icon from the registry rather than a map kept here', async () => {
    expect(mod.entityIcon({ type: 'place', attrs: {} })).toBe('pin');
    expect(mod.entityIcon({ type: 'capture', attrs: {} })).toBe('satellite');
    // the types the old hand-kept map had never heard of
    expect(mod.entityIcon({ type: 'claim', attrs: {} })).toBe('note');
    expect(mod.entityIcon({ type: 'vessel', attrs: {} })).toBe('grip');
  });

  it('falls back to the note glyph for a free type and for a missing entity', () => {
    expect(mod.entityIcon({ type: 'whatever-new', attrs: {} })).toBe('note');
    expect(mod.entityIcon(null)).toBe('note');
  });

  it('tells one kind of media from another, the call the registry cannot make', () => {
    // `media` is a type; what the bytes are is a property of the file
    expect(mod.entityIcon({ type: 'media', attrs: { kind: 'video' } })).toBe('video');
    expect(mod.entityIcon({ type: 'media', attrs: { kind: 'image' } })).toBe('image');
    expect(mod.entityIcon({ type: 'media', attrs: { kind: 'audio' } })).toBe('audio');
    expect(mod.entityIcon({ type: 'media', attrs: { kind: 'file' } })).toBe('file');
  });

  it('never draws a document as a photograph', () => {
    // a PDF, a scan bundle or a spreadsheet under an image glyph is the list
    // telling the analyst something untrue about what the case holds
    expect(mod.entityIcon({ type: 'media', attrs: { path: 'media/plan.pdf' } })).toBe('file');
    expect(mod.entityIcon({ type: 'media', attrs: { path: 'media/notes.xlsx' } })).toBe('file');
    expect(mod.entityIcon({ type: 'media', attrs: { path: 'media/scan.jpg' } })).toBe('image');
    expect(mod.entityIcon({ type: 'media', attrs: { path: 'media/call.m4a' } })).toBe('audio');
    // and a media entity with no path at all is still not an image
    expect(mod.entityIcon({ type: 'media', attrs: {} })).toBe('file');
  });

  it('reads the note glyph until the registry lands, rather than an empty icon', async () => {
    vi.resetModules();
    const cold = await import('./entityIcon.js');

    expect(cold.entityIcon({ type: 'place', attrs: {} })).toBe('note');
  });
});

describe('isVideoEntity', () => {
  it('falls back to the extension for media filed before `kind` existed', () => {
    expect(mod.isVideoEntity({ attrs: { path: 'raw/clip_04.MP4' } })).toBe(true);
    expect(mod.isVideoEntity({ attrs: { path: 'raw/frame.png' } })).toBe(false);
    expect(mod.isVideoEntity({ attrs: {} })).toBe(false);
  });

  it('trusts `kind` over the extension', () => {
    expect(mod.isVideoEntity({ attrs: { kind: 'image', path: 'weird.mp4' } })).toBe(false);
  });
});

describe('mediaKindOf', () => {
  it('answers what the importer stamped when it is there', () => {
    expect(mod.mediaKindOf({ attrs: { kind: 'file', path: 'media/looks-like.png' } })).toBe('file');
  });

  it('reads the extension for anything filed before `kind` existed', () => {
    expect(mod.mediaKindOf({ attrs: { path: 'media/Deed.PDF' } })).toBe('file');
    expect(mod.mediaKindOf({ attrs: { path: 'media/quay.tiff' } })).toBe('image');
    expect(mod.mediaKindOf({ attrs: { path: 'media/interview.opus' } })).toBe('audio');
  });

  it('refuses a kind the importer never writes', () => {
    expect(mod.mediaKindOf({ attrs: { kind: 'satellite', path: 'media/x.png' } })).toBe('image');
  });
});
