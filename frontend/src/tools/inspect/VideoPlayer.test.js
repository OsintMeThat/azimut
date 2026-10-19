import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import VideoPlayer from './VideoPlayer.svelte';

const props = (extra = {}) => ({
  src: '/files/case/media/clip.mp4',
  duration: 125,
  fps: 25,
  shared: { currentTime: 5.01, frameTime: null, seekTo: null },
  ...extra,
});

describe('Inspect video player', () => {
  it('keeps an unrotated control bar outside the transformed video canvas', () => {
    const { body } = render(VideoPlayer, { props: props({ transform: 'rotate(90deg)', quarterTurn: true }) });

    expect(body).toContain('class="video-canvas ');
    expect(body).toContain('transform: rotate(90deg);');
    expect(body).toContain('class="player-bar ');
    expect(body.indexOf('class="player-bar ')).toBeGreaterThan(body.indexOf('</video>'));
    expect(body).toContain('aria-label="Video position"');
    expect(body).not.toContain(' controls');
  });

  it('reads the frame on screen to the millisecond, with its number in the clip', () => {
    // paused at 5.01 s, inside frame 125 (5.00 → 5.04)
    const { body } = render(VideoPlayer, { props: props() });
    expect(body).toContain('0:05.000');
    expect(body).toContain('/ 2:05.000');
    expect(body).toContain('frame 126 of 3125');
  });

  it('names the frame the browser drew over the one worked out from the rate', () => {
    const { body } = render(VideoPlayer, { props: props({ shared: { currentTime: 5.01, frameTime: 4.9871, seekTo: null } }) });
    expect(body).toContain('0:04.987');
  });

  it('offers the capture, the frame steps, the speed and the loop under the picture', () => {
    const { body } = render(VideoPlayer, { props: props() });
    for (const label of ['Capture this frame', 'Back one frame', 'Forward one frame', 'Playback speed', 'Play']) {
      expect(body).toContain(`aria-label="${label}"`);
    }
    expect(body).toContain('>1×</button>');
    expect(body).toContain('aria-label="Loop"');
  });

  it('lays the frames, marks and shots along the bar', () => {
    const { body } = render(VideoPlayer, {
      props: props({
        frames: [{ id: 'f1', time: 25 }],
        marks: [{ id: 'm1', time: 50, label: 'sign' }],
        shots: [{ start: 0, end: 62.5, best: 10 }, { start: 62.5, end: 125, best: 70 }],
      }),
    });
    expect(body).toMatch(/class="frame [^"]*" style="left: 20%;/);
    expect(body).toMatch(/class="mark [^"]*" style="left: 40%;/);
    // the first shot starts with the clip, so only the second draws a cut
    expect(body.match(/class="shot /g)).toHaveLength(1);
    expect(body).toMatch(/class="shot [^"]*" style="left: 50%;/);
  });

  it('says when the picture is shown without its adjustments', () => {
    const { body } = render(VideoPlayer, { props: props({ filter: 'brightness(1.4)', original: true }) });
    expect(body).toContain('Without adjustments');
    expect(body).not.toContain('brightness(1.4)');
  });
});
