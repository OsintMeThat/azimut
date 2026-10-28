import { describe, expect, it } from 'vitest';
import { spaceTarget, viewerItem, viewerKind } from './fileViewer.js';

const media = (kind, path, extra = {}) => ({ id: 'm1', type: 'media', label: 'clip', attrs: { kind, path }, ...extra });

describe('what the viewer can show', () => {
  it('shows a picture, a video and a sound', () => {
    expect(viewerKind(media('image', 'media/a.jpg'))).toBe('image');
    expect(viewerKind(media('video', 'media/a.mp4'))).toBe('video');
    expect(viewerKind(media('audio', 'media/a.mp3'))).toBe('audio');
  });

  it('reads the kind from the extension for a file filed before the kind was stamped', () => {
    expect(viewerKind({ id: 'm2', type: 'media', attrs: { path: 'media/old.mov' } })).toBe('video');
  });

  it('shows a capture as the picture it is', () => {
    expect(viewerKind({ id: 'c1', type: 'capture', attrs: { path: 'captures/view.png' } })).toBe('image');
  });

  it('has nothing to show for a document, a note or a file with no path', () => {
    expect(viewerKind(media('file', 'media/plan.pdf'))).toBeNull();
    expect(viewerKind({ id: 'n1', type: 'note', attrs: {} })).toBeNull();
    expect(viewerKind({ id: 'p1', type: 'proof', attrs: { path: 'proofs/p.png' } })).toBeNull();
    expect(viewerKind(media('image', ''))).toBeNull();
    expect(viewerKind(null)).toBeNull();
  });

  it('keys a row by the entity, with its picture as the first frame', () => {
    expect(viewerItem(media('video', 'media/a.mp4'), '.thumbs/a.jpg')).toEqual({
      key: 'm1',
      path: 'media/a.mp4',
      kind: 'video',
      name: 'clip',
      poster: '.thumbs/a.jpg',
    });
    expect(viewerItem(media('file', 'media/plan.pdf'))).toBeNull();
  });
});

describe('the file Space opens', () => {
  it('opens the one pressed last while it is still picked', () => {
    expect(spaceTarget(['a', 'b', 'c'], 'b')).toBe('b');
  });

  it('falls back on the last one picked', () => {
    expect(spaceTarget(['a', 'c'], 'b')).toBe('c');
    expect(spaceTarget(['a'], null)).toBe('a');
  });

  it('opens nothing out of an empty selection', () => {
    expect(spaceTarget([], 'a')).toBeNull();
  });
});
