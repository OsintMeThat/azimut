// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PlateSteps from './PlateSteps.svelte';

let held = null;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

function show(props = {}) {
  const calls = { onpick: vi.fn(), onadd: vi.fn(), onremove: vi.fn(), onmove: vi.fn(), onchange: vi.fn() };
  held = mount(PlateSteps, { target: document.body, props: {
    steps: [{ id: 's1', name: 'Strike', duration: 3 }, { id: 's2', name: '', duration: 4.5 }],
    current: 's1', dayLabel: '15 Oct 2026', caseId: 'c1',
    elements: [{ id: 'v', kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [12, 20.5], box: [0, 0, 10, 10] },
      { id: 'n', kind: 'text', step: 's1', box: [0, 0, 10, 10] }],
    ...calls, ...props } });
  flushSync();
  return calls;
}
const tiles = () => [...document.body.querySelectorAll('[role="option"]')];

describe('the steps of a day', () => {
  it('lists the day, then each step with its length, the one shown marked', () => {
    show();
    expect(tiles().map((tile) => tile.querySelector('.tile-name').textContent)).toEqual(['15 Oct 2026', 'Strike', 'Step 2']);
    // every tile says how long it holds: the day the plate's seconds, a step with a clip at least the clip
    expect([...document.body.querySelectorAll('.time')].map((time) => time.textContent)).toEqual(['0:01', '0:08.5', '0:04.5']);
    expect(tiles()[1].getAttribute('aria-selected')).toBe('true');
    expect(tiles()[1].querySelector('video').getAttribute('src')).toBe('/files/c1/media/strike.mp4#t=12');
  });

  it('opens a step\'s menu, or the day\'s, where a right-click falls', () => {
    const calls = show();
    const right = (node) => { node.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 40 })); flushSync(); };
    right(tiles()[2]);
    const menu = document.body.querySelector('.float-menu[aria-label="Step"]');
    expect(menu).not.toBeNull();
    // the same menu as its ⋯, nothing picked by the right-click
    [...menu.querySelectorAll('.fm-item')].find((item) => item.textContent.includes('Play it earlier')).click();
    flushSync();
    expect(calls.onmove).toHaveBeenCalledWith('s2', 0);
    expect(calls.onpick).not.toHaveBeenCalled();
    right(tiles()[0]);
    expect(document.body.querySelector('.float-menu[aria-label="The day"]')).not.toBeNull();
  });

  it('shows a step or the day on a press, and adds a step', () => {
    const calls = show();
    tiles()[2].click(); tiles()[0].click();
    expect(calls.onpick.mock.calls).toEqual([['s2'], [null]]);
    document.body.querySelector('button[aria-label="Add a step"]').click();
    expect(calls.onadd).toHaveBeenCalledOnce();
  });

  it('names a step, moves it, and says what goes with it when it is removed', () => {
    const calls = show();
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    const field = document.body.querySelector('.fields input');
    field.value = ' Dawn strike '; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls.onchange).toHaveBeenCalledWith('s1', { name: 'Dawn strike' });
    // a step with a clip holds at least as long as it: shorter is taken up to the clip, longer is kept
    const seconds = document.body.querySelector('.fields input[type="number"]');
    expect(seconds.value).toBe('8.5');
    expect(document.body.querySelector('.fm-note').textContent).toContain('At least 0:08.5');
    seconds.value = '2'; seconds.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls.onchange).toHaveBeenLastCalledWith('s1', { duration: 8.5 });
    seconds.value = '12'; seconds.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls.onchange).toHaveBeenLastCalledWith('s1', { duration: 12 });
    const remove = [...document.body.querySelectorAll('.fm-item')].find((item) => item.textContent.includes('Remove'));
    expect(remove.textContent).toContain('Remove it and its 2 elements');
    [...document.body.querySelectorAll('.fm-item')].find((item) => item.textContent.includes('later')).click(); flushSync();
    expect(calls.onmove).toHaveBeenCalledWith('s1', 2);
  });

  it('cuts straight into a step when the video\'s transitions are on, and says nothing of it when they are off', () => {
    const calls = show({ transitions: true });
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    const cut = document.body.querySelector('.cut input');
    cut.click();
    expect(calls.onchange).toHaveBeenLastCalledWith('s1', { transition: 'none' });
    unmount(held); held = null; document.body.innerHTML = '';
    // a step that takes the plate's transition takes its own time too, the plate's said until then
    const timed = show({ transitions: true, transitionSeconds: 0.8 });
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    const field = [...document.body.querySelectorAll('.fields label')].find((label) => label.textContent.includes('Transition, seconds')).querySelector('input');
    expect(field.placeholder).toBe('0.8');
    field.value = '1.75'; field.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(timed.onchange).toHaveBeenLastCalledWith('s1', { transition_seconds: 1.8 });
    field.value = '9'; field.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(timed.onchange).toHaveBeenLastCalledWith('s1', { transition_seconds: 3 });
    field.value = ''; field.dispatchEvent(new Event('change', { bubbles: true })); flushSync();
    expect(timed.onchange).toHaveBeenLastCalledWith('s1', { transition_seconds: null });
    unmount(held); held = null; document.body.innerHTML = '';
    show({ transitions: false });
    document.body.querySelector('button[aria-label="Set Strike"]').click(); flushSync();
    expect(document.body.querySelector('.cut')).toBeNull();
  });

  it('holds the day its own seconds from its time, or as every day again', async () => {
    const ondayhold = vi.fn();
    show({ daySeconds: 4, dayOwn: true, plateSeconds: 1.5, ondayhold });
    const time = document.body.querySelector('button[aria-label="How long 15 Oct 2026 holds"]');
    expect(time.textContent).toBe('0:04');
    expect(time.classList.contains('own')).toBe(true);
    time.click(); flushSync();
    const field = document.body.querySelector('.fields input[type="number"]');
    field.value = '6'; field.dispatchEvent(new Event('change', { bubbles: true }));
    expect(ondayhold).toHaveBeenLastCalledWith('6');
    [...document.body.querySelectorAll('.fields button')].find((node) => node.textContent.includes('As every day')).click();
    expect(ondayhold).toHaveBeenLastCalledWith(null);
  });

  it('adds a day the play skips from its tile or its ⋯', () => {
    const onplayday = vi.fn();
    show({ steps: [], current: null, dayPlayed: false, onplayday });
    expect(document.body.querySelector('button[aria-label="How long 15 Oct 2026 holds"]')).toBeNull();
    const tile = document.body.querySelector('.tile.idle');
    expect(tile.textContent).toContain('Add to the play');
    tile.click();
    expect(onplayday).toHaveBeenLastCalledWith(true);
    onplayday.mockClear();
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    [...document.body.querySelectorAll('.fm-item')].find((node) => node.textContent.includes('Add this day')).click();
    expect(onplayday).toHaveBeenLastCalledWith(true);
  });

  it('hides a played day from the video from its ⋯, and shows it again', () => {
    const onskipday = vi.fn();
    show({ current: null, onskipday });
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    [...document.body.querySelectorAll('.fm-item')].find((node) => node.textContent.includes('Hide from the video')).click();
    expect(onskipday).toHaveBeenLastCalledWith(true);
    unmount(held); held = null; document.body.innerHTML = '';
    // hidden, the day and its steps stay to edit, dashed; its time is moot, so it says Hidden
    show({ current: null, daySkipped: true, onskipday });
    expect(document.body.querySelector('.steps').classList.contains('skipped')).toBe(true);
    expect(document.body.querySelector('button[aria-label="How long 15 Oct 2026 holds"]')).toBeNull();
    expect(document.body.querySelector('.time.said').textContent).toBe('Hidden');
    expect(tiles()).toHaveLength(3);
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    expect(document.body.querySelector('.fields')).toBeNull();
    [...document.body.querySelectorAll('.fm-item')].find((node) => node.textContent.includes('Show in the video')).click();
    expect(onskipday).toHaveBeenLastCalledWith(false);
  });

  it('offers no hiding on a day added to the play without steps: it is taken out instead', () => {
    show({ steps: [], current: null, dayPicked: true, onplayday: vi.fn(), onskipday: vi.fn() });
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    expect(document.body.textContent).toContain('Take it out');
    expect(document.body.textContent).not.toContain('Hide from the video');
  });

  it('lets a day added to the play go again, unless it holds steps', () => {
    const onplayday = vi.fn();
    show({ steps: [], current: null, dayPicked: true, onplayday });
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    [...document.body.querySelectorAll('.fm-item')].find((node) => node.textContent.includes('Take it out')).click();
    expect(onplayday).toHaveBeenLastCalledWith(false);
    unmount(held); held = null; document.body.innerHTML = '';
    show({ dayPicked: true, current: null, onplayday });
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    expect(document.body.textContent).not.toContain('Take it out');
  });

  it('gives the day a ⋯ of its own, as every step has', () => {
    show({ daySeconds: 2 });
    document.body.querySelector('button[aria-label="Set 15 Oct 2026"]').click(); flushSync();
    expect(document.body.querySelector('.fields input[type="number"]').value).toBe('2');
  });
});

describe('a day with many steps', () => {
  const many = (count) => Array.from({ length: count }, (_, index) => ({ id: `s${index + 1}`, name: `Beat ${index + 1}`, duration: 3 }));
  afterEach(() => vi.restoreAllMocks());

  it('keeps the day and + out of the scroll, and shows no strip of steps on a day without any', () => {
    show();
    const strip = document.body.querySelector('.steps');
    expect([...strip.children].map((node) => node.className.split(' ')[0])).toEqual(['slot', 'lane', 'add']);
    expect(document.body.querySelectorAll('.lane [role="option"]')).toHaveLength(2);
    unmount(held); held = null; document.body.innerHTML = '';
    show({ steps: [], current: null });
    expect(document.body.querySelector('.lane')).toBeNull();
  });

  it('turns the wheel into a sideways scroll when the steps run longer than the strip', () => {
    show({ steps: many(12) });
    const lane = document.body.querySelector('.lane');
    Object.defineProperty(lane, 'scrollWidth', { value: 1200, configurable: true });
    Object.defineProperty(lane, 'clientWidth', { value: 300, configurable: true });
    const down = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    lane.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
    expect(lane.scrollLeft).toBe(120);
    // a sideways wheel or a touchpad scrolls it as it is
    const sideways = new WheelEvent('wheel', { deltaX: 80, deltaY: 10, cancelable: true });
    lane.dispatchEvent(sideways);
    expect(sideways.defaultPrevented).toBe(false);
    // a strip that holds every step leaves the wheel alone
    Object.defineProperty(lane, 'scrollWidth', { value: 300, configurable: true });
    const still = new WheelEvent('wheel', { deltaY: 120, cancelable: true });
    lane.dispatchEvent(still);
    expect(still.defaultPrevented).toBe(false);
  });

  it('shrinks the tiles to their number and time past what the strip holds, and says which one is shown', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600);
    show({ steps: many(8), current: 's2', elements: [{ id: 'v', kind: 'video', step: 's1', src: 'media/strike.mp4', clip: [0, 2], box: [0, 0, 10, 10] }] });
    expect(document.body.querySelector('.steps').classList.contains('compact')).toBe(true);
    expect(document.body.querySelector('.tally').textContent).toBe('2 / 8');
    // a step's name moves to its tooltip; a clip's thumbnail carries the number
    expect(tiles()[2].title).toContain('Beat 2');
    expect(tiles()[1].querySelector('.badge').textContent).toBe('1');
    unmount(held); held = null; document.body.innerHTML = '';
    show({ steps: many(8), current: null });
    expect(document.body.querySelector('.tally').textContent).toBe('8 steps');
    unmount(held); held = null; document.body.innerHTML = '';
    show({ steps: many(2) });
    expect(document.body.querySelector('.steps').classList.contains('compact')).toBe(false);
    expect(document.body.querySelector('.tally')).toBeNull();
  });

  it('says how many steps are out of sight on each side, and scrolls to them', () => {
    show({ steps: many(8), current: null });
    const lane = document.body.querySelector('.lane');
    expect(document.body.querySelector('.edge')).toBeNull();
    [...lane.children].forEach((slot, index) => {
      Object.defineProperty(slot, 'offsetLeft', { value: index * 101, configurable: true });
      Object.defineProperty(slot, 'offsetWidth', { value: 96, configurable: true });
    });
    Object.defineProperty(lane, 'clientWidth', { value: 300, configurable: true });
    Object.defineProperty(lane, 'scrollWidth', { value: 803, configurable: true });
    lane.scrollBy = vi.fn();
    lane.scrollLeft = 202;
    lane.dispatchEvent(new Event('scroll'));
    flushSync();
    const before = document.body.querySelector('[aria-label="2 more steps before"]');
    const after = document.body.querySelector('[aria-label="3 more steps after"]');
    expect([before.textContent, after.textContent]).toEqual(['2', '3']);
    after.click();
    expect(lane.scrollBy).toHaveBeenLastCalledWith({ left: 240, behavior: 'smooth' });
    before.click();
    expect(lane.scrollBy).toHaveBeenLastCalledWith({ left: -240, behavior: 'smooth' });
    // at the start, the arrow before stays where it is, with nothing left to show
    lane.scrollLeft = 0;
    lane.dispatchEvent(new Event('scroll'));
    flushSync();
    expect(document.body.querySelector('[aria-label="No step before"]').disabled).toBe(true);
    expect(document.body.querySelector('[aria-label="5 more steps after"]')).not.toBeNull();
  });

  it('goes from the day to its steps and back with the arrow keys', () => {
    const calls = show();
    const arrow = (tile, key) => tile.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
    arrow(tiles()[1], 'ArrowRight');
    expect(calls.onpick).toHaveBeenLastCalledWith('s2');
    arrow(tiles()[1], 'ArrowLeft');
    expect(calls.onpick).toHaveBeenLastCalledWith(null);
    // a key in a field is the field's
    calls.onpick.mockClear();
    const field = document.createElement('input');
    tiles()[1].append(field);
    arrow(field, 'ArrowRight');
    expect(calls.onpick).not.toHaveBeenCalled();
  });
});
