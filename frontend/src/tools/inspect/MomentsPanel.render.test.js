// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import MomentsPanel from './MomentsPanel.svelte';

/**
 * The shots block of the Moments tab: what a scan finds is said as shots, each one
 * a stretch of the clip that can become a scene, with the sharpest frames folded.
 */

let live = null;
let target = null;

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(MomentsPanel, { target, props });
  flushSync();
  return target;
}

const SCAN = {
  shots: [{ start: 0, best: 1 }, { start: 8, best: 9 }, { start: 21.5, best: 25 }],
  frames: [{ time: 9, score: 3, rank: 0 }, { time: 1, score: 2, rank: 1 }],
};

describe('the shots block', () => {
  it('says what finding shots does before it is run', () => {
    const root = open({ onscan: vi.fn() });
    expect(root.textContent).toContain('Find shots');
    expect(root.textContent).toContain('Cuts the video where the camera changes shot');
  });

  it('labels each shot by the stretch it covers, the last one to the end of the clip', () => {
    const root = open({ scan: SCAN, duration: 40 });
    const labels = [...root.querySelectorAll('.shot-label')].map((n) => n.textContent);
    expect(labels).toEqual(['1 · 0:00–0:08', '2 · 0:08–0:21', '3 · 0:21–0:40']);
    expect(root.textContent).toContain('3 shots, each shown at its sharpest frame');
  });

  it('keeps a shot as a scene', () => {
    const onkeepshot = vi.fn();
    const root = open({ scan: SCAN, duration: 40, onkeepshot });
    root.querySelectorAll('[aria-label="Keep this shot as a scene"]')[1].click();
    expect(onkeepshot).toHaveBeenCalledWith(1);
  });

  it('folds the sharpest frames of the whole video under the shots', () => {
    const root = open({ scan: SCAN, duration: 40 });
    const fold = root.querySelector('details.sharpest');
    expect(fold.open).toBe(false);
    expect(fold.querySelector('summary').textContent).toContain('Sharpest frames of the whole video (2)');
  });
});
