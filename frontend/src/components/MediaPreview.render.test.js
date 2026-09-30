// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MediaPreview from './MediaPreview.svelte';

/** A file shown where it is read, one press from full screen. */

let live = null;
let target = null;

function show(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MediaPreview, { target, props: { caseId: 'case-a', ...props } });
  flushSync();
}

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
  document.querySelectorAll('.stage').forEach((node) => node.remove());
});

const media = (kind, path) => ({ id: 'm1', type: 'media', label: 'VID_0312', attrs: { kind, path } });

describe('the preview', () => {
  it('draws a picture from the path the entity carries', () => {
    show({ entity: media('image', 'media/frame.jpg') });
    expect(target.querySelector('img').getAttribute('src')).toContain('media/frame.jpg');
  });

  it('gives a video its controls, with the list’s picture as the first frame', () => {
    show({ entity: media('video', 'media/clip.mp4'), thumb: '.thumbs/clip.jpg' });
    const video = target.querySelector('video');
    expect(video.getAttribute('src')).toContain('media/clip.mp4');
    expect(video.hasAttribute('controls')).toBe(true);
    expect(video.getAttribute('poster')).toContain('.thumbs/clip.jpg');
  });

  it('shows the picture the row had while the file is not known yet', () => {
    show({ entity: null, thumb: '.thumbs/clip.jpg', label: 'VID_0312' });
    expect(target.querySelector('img').getAttribute('src')).toContain('.thumbs/clip.jpg');
    expect(target.querySelector('.enlarge')).toBeNull();
  });

  it('says what a file with no picture is, rather than drawing nothing', () => {
    show({ entity: media('file', 'media/plan.pdf') });
    expect(target.querySelector('.plain').textContent).toContain('VID_0312');
  });

  it('opens full screen on a press, and Escape closes it', () => {
    show({ entity: media('image', 'media/frame.jpg') });
    target.querySelector('.enlarge').click();
    flushSync();
    expect(document.querySelector('.stage img')).not.toBeNull();
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
    flushSync();
    expect(document.querySelector('.stage')).toBeNull();
  });
});
