// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import JourneyStage, { SIDE_ROOM, besidePicture, bubbleSpot, sideSpot } from './JourneyStage.svelte';
import { JOURNEYS, JOURNEY_CAVEAT, journeyNodes, markShot, stepAs, stepMarks, stepShot } from '../lib/guide.js';

const geolocate = JOURNEYS.find((journey) => journey.id === 'geolocate');
const nodes = journeyNodes(geolocate);
/** A step as the guide hands it to the stage. */
function played(id, kind = null) {
  const step = stepAs(geolocate.steps.find((one) => one.id === id), kind);
  return { ...step, shot: stepShot(step), marks: stepMarks(step).map((mark) => ({ ...mark, shot: markShot(step, mark) })) };
}

let live;
let calls;
function play(props) {
  calls = { onact: vi.fn(), onpressed: vi.fn(), onback: vi.fn(), onchoose: vi.fn(), onshow: vi.fn(), onexample: vi.fn() };
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(JourneyStage, { target, props: { nodes, ...calls, ...props } });
  flushSync();
}
const text = (selector) => document.querySelector(selector)?.textContent.trim();
const settle = async () => {
  await vi.advanceTimersByTimeAsync(400);
  flushSync();
};

// happy-dom's own animations reject when cut short: the screens fade in and out
beforeEach(() => {
  vi.useFakeTimers();
  Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
});
afterEach(() => {
  delete Element.prototype.animate;
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('a step played over its screen', () => {
  it('lights the control to press once the screen is in, and says what to press', async () => {
    play({ step: played('satellite') });
    expect(document.querySelector('.hole')).toBeNull();
    await settle();
    expect(document.querySelector('.hole')).not.toBeNull();
    expect(text('.bubble .name')).toBe('Search');
    expect(text('.bubble .press')).toBe(played('satellite').marks[0].text);
    expect(document.querySelectorAll('.dots i')).toHaveLength(3);
    // a field to fill says it is done, as a press says it was made
    expect(text('.bubble .go')).toBe('Done');
  });

  it('moves on to the next action, then on to where the last press lands', async () => {
    play({ step: played('satellite'), act: 1 });
    await settle();
    expect(text('.bubble .go')).toBe('Next');
    // the step's tip was said with its first action
    expect(document.querySelector('.bubble .tip')).toBeNull();
    document.querySelector('.bubble .go').click();
    expect(calls.onact).toHaveBeenCalledWith(2);
    live && unmount(live);
    document.body.innerHTML = '';
    play({ step: played('spot'), act: 2 });
    await settle();
    document.querySelector('.bubble .go').click();
    expect(calls.onpressed).toHaveBeenCalledTimes(1);
  });

  it('says what the step is for over its first action only', async () => {
    play({ step: played('satellite') });
    await settle();
    expect(text('.bubble .about')).toBe(played('satellite').text);
    live && unmount(live);
    document.body.innerHTML = '';
    play({ step: played('satellite'), act: 1 });
    await settle();
    expect(document.querySelector('.bubble .about')).toBeNull();
  });

  it('moves on with Next past a part of the screen that is only shown', async () => {
    const step = played('satellite');
    play({ step: { ...step, marks: step.marks.map((mark) => ({ ...mark, look: true })) }, act: 2 });
    await settle();
    expect(text('.bubble .go')).toBe('Next');
    document.querySelector('.bubble .go').click();
    expect(calls.onpressed).toHaveBeenCalledTimes(1);
  });

  it('asks for the next action rather than leaving the step, its tip in sight from the first', async () => {
    play({ step: played('geolocate') });
    await settle();
    expect(text('.bubble .tip')).toContain('case panel');
    document.querySelector('.bubble .go').click();
    expect(calls.onact).toHaveBeenCalledWith(1);
  });

  it('closes a field to fill with Done', async () => {
    const step = played('satellite');
    play({ step: { ...step, marks: step.marks.map((mark) => ({ ...mark, typed: true })) } });
    await settle();
    expect(text('.bubble .go')).toBe('Done');
  });

  it('says a press’s own tip at that press', async () => {
    const step = played('satellite');
    const marks = step.marks.map((mark, at) => (at === 1 ? { ...mark, tip: 'Esc stops.' } : mark));
    play({ step: { ...step, marks }, act: 1 });
    await settle();
    expect(text('.bubble .tip')).toContain('Esc stops.');
  });

  it('takes a press to its own screen when it opens one', async () => {
    play({ step: played('mark'), act: 1 });
    await settle();
    expect(document.querySelector('.shot').getAttribute('src')).toContain('media-rail-menu');
  });

  it('shows the control being read in the app', async () => {
    play({ step: played('proof'), act: 0 });
    await settle();
    document.querySelector('.bubble .show').click();
    expect(calls.onshow).toHaveBeenCalledWith(expect.objectContaining({ anchor: 'geo.make' }));
  });

  it('says where the last press landed, for a moment', async () => {
    play({ step: played('where'), landing: { text: 'Satellite, with your photo beside the map.' } });
    expect(text('.landing.on')).toContain('Satellite, with your photo beside the map.');
    await vi.advanceTimersByTimeAsync(4300);
    flushSync();
    expect(document.querySelector('.landing.on')).toBeNull();
  });
});

describe('a question', () => {
  it('asks over its screen, blurred, an answer per card', async () => {
    play({ step: played('where'), here: { here: 'where', next: ['reverse', 'mark'], done: [] } });
    await settle();
    expect(document.querySelector('.screen.blurred')).not.toBeNull();
    expect(text('.fork h3')).toBe('Do you know where it is?');
    const cards = [...document.querySelectorAll('.fork .choice')];
    expect(cards.map((card) => card.querySelector('strong').textContent)).toEqual(['Not yet', 'I have an idea of the area']);
    expect(cards[0].querySelector('em')?.textContent).toBe('Optional');
    expect(cards.every((card) => card.classList.contains('next'))).toBe(true);
    expect(document.querySelector('.bubble')).toBeNull();
    cards[0].click();
    expect(calls.onchoose).toHaveBeenCalledWith('reverse');
  });
});

describe('the result', () => {
  const result = { id: 'result', result: true, shot: 'proof-result', text: 'The proof as it leaves the case.', marks: [] };

  it('says what the journey made', () => {
    play({ step: result });
    expect(text('.result .said')).toBe('The proof as it leaves the case.');
    // the example note is the welcome's, not the result's
    expect(document.querySelector('.result .caveat')).toBeNull();
  });

  it('says how close the practice answer came', () => {
    play({ step: result, answer: { right: true, said: 'Your point is 120 m from where the photo was taken.' } });
    expect(text('.verdict strong')).toBe('Found');
    expect(document.querySelector('.verdict.right')).not.toBeNull();
  });

  it('offers the search a journey walked', () => {
    play({ step: { ...result, shot: 'find-look', example: true } });
    document.querySelector('.result .go').click();
    expect(calls.onexample).toHaveBeenCalled();
  });
});

describe('a journey’s welcome', () => {
  const welcome = (starts) => ({
    id: 'welcome',
    welcome: true,
    shot: 'proof-result',
    title: 'Geolocate a photo or a video',
    lead: 'From a picture with no caption to a published proof.',
    tools: [{ id: 'media', label: 'Sources', icon: 'download' }, { id: 'proof', label: 'Geo Proof', icon: 'proof' }],
    starts,
    marks: [],
  });

  it('says what it walks, that it is one example, and starts on its one way in', async () => {
    const onbegin = vi.fn();
    play({ step: welcome([{ id: 'go', label: 'Library', icon: 'flag' }]), onbegin });
    await settle();
    expect(text('.welcome h3')).toBe('Geolocate a photo or a video');
    expect([...document.querySelectorAll('.welcome .tool-chip')].map((one) => one.textContent.trim())).toEqual(['Sources', 'Geo Proof']);
    expect(text('.welcome .example')).toBe(JOURNEY_CAVEAT);
    // no control lit and no bubble: nothing to press but the start
    expect(document.querySelector('.bubble')).toBeNull();
    document.querySelector('.welcome .starts .go').click();
    expect(onbegin).toHaveBeenCalledWith('go');
  });

  it('offers a start per kind of file', async () => {
    const onbegin = vi.fn();
    play({ step: welcome([{ id: 'photo', label: 'A photo', icon: 'image' }, { id: 'video', label: 'A video', icon: 'video' }]), onbegin });
    await settle();
    const starts = [...document.querySelectorAll('.welcome .starts .go')];
    expect(starts.map((one) => one.textContent.trim())).toEqual(['Start with a photo', 'Start with a video']);
    starts[1].click();
    expect(onbegin).toHaveBeenCalledWith('video');
  });
});

describe('where the bubble stands', () => {
  it('under a control with room under it, over one near the bottom', () => {
    expect(bubbleSpot({ x: 100, y: 100, w: 80, h: 30 }, 1000, 600, 150).side).toBe('below');
    expect(bubbleSpot({ x: 100, y: 500, w: 80, h: 30 }, 1000, 600, 150).side).toBe('above');
  });

  it('beside a tall rail, and inside what fills the screen', () => {
    expect(bubbleSpot({ x: 0, y: 40, w: 60, h: 500 }, 1000, 600, 150)).toMatchObject({ side: 'beside', left: 74 });
    expect(bubbleSpot({ x: 0, y: 0, w: 900, h: 500 }, 1000, 600, 150).side).toBe('inside');
  });

  it('beside a panel too wide to stand under, never over it', () => {
    // the plate's inspector down the right of the screen
    const spot = bubbleSpot({ x: 700, y: 0, w: 300, h: 600 }, 1000, 600, 180);
    expect(spot.side).toBe('beside');
    expect(spot.left + 340).toBeLessThanOrEqual(700);
  });

  it('never leaves the screen', () => {
    const spot = bubbleSpot({ x: 960, y: 100, w: 30, h: 20 }, 1000, 600, 150);
    expect(spot.left + 340).toBeLessThanOrEqual(1000 - 12);
  });

  // a toolbar button at the top, the film drawing on the map under it, the left still
  const DRAWING = ['000000000000', '000099990000', '000099999900', '000099999900', '000099999900', '000099999900', '000009990000', '000000000000'];
  const BUTTON = { x: 412, y: 63, w: 30, h: 30 };

  it('over a film, off where it moves rather than under its control', () => {
    expect(bubbleSpot(BUTTON, 1000, 600, 180).side).toBe('below');
    // the left third never moves: the bubble takes its corner the drawing reaches least
    expect(bubbleSpot(BUTTON, 1000, 600, 180, DRAWING)).toMatchObject({ side: 'inside', left: 12, top: 600 - 180 - 12 });
  });

  it('by its control still, over a film that leaves that spot alone', () => {
    const quiet = ['000000000000', '000000000000', '000000000000', '000000000000', '000000000099', '000000000099', '000000000099', '000000000099'];
    expect(bubbleSpot(BUTTON, 1000, 600, 180, quiet)).toMatchObject({ side: 'below' });
  });

  it('never over the control, whatever the film', () => {
    const everywhere = Array.from({ length: 8 }, () => '999999999999');
    const spot = bubbleSpot(BUTTON, 1000, 600, 180, everywhere);
    const overlapX = Math.min(spot.left + 340, BUTTON.x + BUTTON.w) - Math.max(spot.left, BUTTON.x);
    const overlapY = Math.min(spot.top + 180, BUTTON.y + BUTTON.h) - Math.max(spot.top, BUTTON.y);
    expect(overlapX <= 0 || overlapY <= 0).toBe(true);
  });
});

describe('the bubble beside the picture', () => {
  it('stands in a column of its own on a wide stage, over the picture on a narrow one', () => {
    // a wide window: the picture is held by the stage's height, the room beside it is free
    expect(besidePicture(1400, 610)).toBe(true);
    // a laptop's: the picture gives up under a quarter of its width
    expect(besidePicture(1074, 610)).toBe(true);
    // a narrow window would lose too much picture: the bubble goes back over it
    expect(besidePicture(800, 610)).toBe(false);
    expect(besidePicture(0, 0)).toBe(false);
    expect(SIDE_ROOM).toBeGreaterThan(300);
  });

  it('level with the control, kept whole on the stage, its tip on the control', () => {
    // a frame 500 high in a stage 600 high: 50 px of stage above and below it
    const spot = sideSpot({ x: 400, y: 200, w: 40, h: 30 }, 500, 600, 180);
    expect(spot.side).toBe('side');
    expect(spot.left).toBeLessThan(0);
    expect(spot.top + 180 / 2).toBeCloseTo(215);
    expect(spot.top + spot.arrow + 6).toBeCloseTo(215);
    // a control at the very top: the bubble stops at the stage's edge, its tip still on it
    const high = sideSpot({ x: 400, y: 0, w: 40, h: 20 }, 500, 600, 180);
    expect(high.top).toBe(-50 + 8);
    expect(high.top + high.arrow + 6).toBeCloseTo(10);
  });
});

describe('a film in the step', () => {
  it('plays in the picture’s place, the bubble off where it moves', async () => {
    const step = {
      id: 'draw',
      tool: 'satellite',
      label: 'Draw',
      text: 'Draw.',
      marks: [{ anchor: 'layer.markers', shot: 'layer-points', title: 'Markers', text: 'Press it.' }],
    };
    // happy-dom lays nothing out: the bubble is given the height it has on screen
    const height = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(220);
    try {
      play({ step });
      await settle();
      expect(document.querySelector('video.shot')).not.toBeNull();
      // under the button is where the markers are dropped
      expect(document.querySelector('.bubble').classList.contains('below')).toBe(false);
    } finally {
      height.mockRestore();
    }
  });

  it('stands still for a reader who asked for less motion', async () => {
    const media = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      play({ step: { id: 'draw', tool: 'satellite', label: 'Draw', marks: [{ anchor: 'layer.markers', shot: 'layer-points', title: 'Markers', text: 'Press it.' }] } });
      await settle();
      expect(document.querySelector('video')).toBeNull();
      expect(document.querySelector('img.shot')).not.toBeNull();
    } finally {
      media.mockRestore();
    }
  });
});
