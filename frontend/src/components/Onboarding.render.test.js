// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import Onboarding from './Onboarding.svelte';
import { FIND_GUIDE, TOUR, closedThisStart } from '../lib/onboarding.js';

let live;
// happy-dom has no Web Animations: the pages slide in, and the card flies into the `?`
beforeEach(() => {
  Element.prototype.animate = () => ({ finished: Promise.resolve(), cancel() {}, onfinish: null });
});
afterEach(() => {
  delete Element.prototype.animate;
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
  sessionStorage.clear();
  vi.restoreAllMocks();
});

const NEWS = [
  { shot: 'plate', anchor: 'plate.page', label: 'The page', title: 'Map plates', text: 'Lay a map out.', version: '0.3.3' },
  { title: 'And also', items: [{ icon: 'image', text: 'Reference windows fade.' }], help: 'The guide shows every tool.', version: '0.3.3' },
];

function show(start, { anchor = null, hasCases = false } = {}) {
  const onkeep = vi.fn();
  const onclose = vi.fn();
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(Onboarding, { target, props: { start, version: '0.3.3', anchor, hasCases, onkeep, onclose } });
  flushSync();
  return { onkeep, onclose };
}

const button = (name) => [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const press = (name) => {
  button(name).click();
  flushSync();
};
const title = () => document.querySelector('[role="dialog"] h2').textContent.trim();
const key = (name) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: name }));
  flushSync();
};

/** The topbar's `?`, where a real layout would put it. */
function questionMark(left = 900) {
  const node = document.createElement('button');
  node.getBoundingClientRect = () => ({ left, right: left + 32, top: 10, bottom: 42, width: 32, height: 32 });
  document.body.append(node);
  return node;
}

describe('the welcome a newcomer opens with', () => {
  it('says what Azimut is for, over a film of the globe', () => {
    show({ kind: 'welcome' });
    expect(title()).toBe('Welcome to Azimut');
    expect(document.querySelector('.text').textContent).toMatch(/where and when was this picture taken/);
    const film = document.querySelector('.film video');
    expect(film.muted).toBe(true);
    expect(film.loop).toBe(true);
    expect(film.getAttribute('poster')).toBeTruthy();
    expect(document.querySelector('.film figcaption').textContent).toMatch(/USGS.*Mapterhorn/);
  });

  it('shows the film’s still to a reader who asked for less motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({ matches: query.includes('reduce') }));
    show({ kind: 'welcome' });
    expect(document.querySelector('.film video')).toBeNull();
    expect(document.querySelector('.film img')).not.toBeNull();
  });

  it('starts the tour in the same card and keeps its page', () => {
    const { onkeep, onclose } = show({ kind: 'welcome' });
    press('Show me around');
    expect(title()).toBe(TOUR[0].title);
    expect(onkeep).toHaveBeenCalledWith({ tour: '1' });
    expect(onclose).not.toHaveBeenCalled();
  });

  it('lets someone who knows Azimut past it for good', () => {
    const { onkeep, onclose } = show({ kind: 'welcome' });
    press('I know Azimut already');
    expect(onkeep).toHaveBeenCalledWith({ tour: 'done', whats_new_seen: '0.3.3' });
    expect(onclose).toHaveBeenCalledWith({});
  });

  it('comes back at the next start when closed without a choice', () => {
    const { onkeep, onclose } = show({ kind: 'welcome' });
    key('Escape');
    expect(onkeep).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
    expect(closedThisStart('0.3.3')).toBe(true);
  });
});

describe('the tour', () => {
  it('walks its pages one control lit each, keeping where it stands', () => {
    const { onkeep } = show({ kind: 'tour', step: 0 });
    expect(document.querySelector('.ring')).not.toBeNull();
    expect(document.querySelector('.name').textContent).toBe(TOUR[0].label);
    press('Next');
    expect(title()).toBe(TOUR[1].title);
    expect(onkeep).toHaveBeenLastCalledWith({ tour: '2' });
    key('ArrowRight');
    expect(title()).toBe(TOUR[2].title);
    key('ArrowLeft');
    expect(title()).toBe(TOUR[1].title);
    // a dot goes straight to its page
    document.querySelectorAll('.dots button')[3].click();
    flushSync();
    expect(title()).toBe(TOUR[3].title);
    expect(onkeep).toHaveBeenLastCalledWith({ tour: '4' });
  });

  it('resumes on the page it was left on', () => {
    show({ kind: 'tour', step: 2 });
    expect(title()).toBe(TOUR[2].title);
    expect(document.querySelector('.dots button[aria-current="step"]').getAttribute('aria-label')).toMatch(/page 3 of 4/);
  });

  it('is not left by accident: the veil does nothing and Escape asks first', () => {
    const { onkeep, onclose } = show({ kind: 'tour', step: 1 });
    document.querySelector('.veil').click();
    flushSync();
    expect(onclose).not.toHaveBeenCalled();
    key('Escape');
    expect(document.querySelector('.ask').textContent).toMatch(/Leave the tour/);
    press('Continue');
    expect(title()).toBe(TOUR[1].title);
    key('Escape');
    press('Leave');
    expect(onkeep).toHaveBeenLastCalledWith({ tour: 'done', whats_new_seen: '0.3.3' });
    expect(onclose).toHaveBeenCalledWith({});
  });

  it('skips for good', () => {
    const { onkeep, onclose } = show({ kind: 'tour', step: 0 });
    press('Skip the tour');
    expect(onkeep).toHaveBeenCalledWith({ tour: 'done', whats_new_seen: '0.3.3' });
    expect(onclose).toHaveBeenCalledWith({});
  });

  it('ends on making the first case, with the `?` lit for help', async () => {
    const { onkeep, onclose } = show({ kind: 'tour', step: 3 }, { anchor: questionMark() });
    expect(document.querySelector('.help').textContent).toMatch(/Need help on a screen\? Press/);
    const lit = document.querySelector('.lit');
    expect(lit.style.left).toBe('897px');
    press('Create my first case');
    expect(onkeep).toHaveBeenCalledWith({ tour: 'done', whats_new_seen: '0.3.3' });
    // into the `?` first, so the eye ends where help is
    await vi.waitFor(() => expect(onclose).toHaveBeenCalledWith({ create: true }));
  });

  it('ends on Done for someone who already has cases', () => {
    const { onclose } = show({ kind: 'tour', step: 3 }, { hasCases: true });
    press('Done');
    expect(onclose).toHaveBeenCalledWith({ create: false });
  });

  it('opens the guide from the lit `?`', () => {
    const { onkeep, onclose } = show({ kind: 'tour', step: 3 }, { anchor: questionMark() });
    document.querySelector('.lit').click();
    expect(onkeep).toHaveBeenCalledWith({ tour: 'done', whats_new_seen: '0.3.3' });
    expect(onclose).toHaveBeenCalledWith({ guide: true });
  });

  it('points at the `?` on its last page only', () => {
    show({ kind: 'tour', step: 2 }, { anchor: questionMark() });
    expect(document.querySelector('.lit')).toBeNull();
    press('Next');
    expect(document.querySelector('.lit')).not.toBeNull();
  });
});

describe('What’s new', () => {
  it('pages through what the version brings, with no way out to a tool', () => {
    const { onkeep, onclose } = show({ kind: 'news', pages: NEWS });
    expect(title()).toBe('Map plates');
    expect(document.querySelector('.where').textContent).toMatch(/New in 0\.3\.3/);
    expect(button('Try it')).toBeUndefined();
    press('Next');
    expect(document.querySelectorAll('.items li')).toHaveLength(1);
    press('Done');
    expect(onkeep).toHaveBeenCalledWith({ whats_new_seen: '0.3.3' });
    expect(onclose).toHaveBeenCalledWith({ create: false });
  });

  it('plays the welcome’s film on a page that asks for it, and names what is in beta', () => {
    show({ kind: 'news', pages: [{ film: true, title: '3D is here', text: 'Press 3D.', version: '0.3.3' }, { ...NEWS[0], badge: 'Find is in beta' }] });
    expect(document.querySelector('.stage.filming .film video')).not.toBeNull();
    press('Next');
    expect(document.querySelector('.stage.filming')).toBeNull();
    expect(document.querySelector('.where .badge').textContent).toBe('Find is in beta');
  });

  it('points its page about the guide at the `?`', () => {
    show({ kind: 'news', pages: NEWS }, { anchor: questionMark() });
    expect(document.querySelector('.lit')).toBeNull();
    press('Next');
    expect(document.querySelector('.lit')).not.toBeNull();
  });

  it('waits for the next start when closed early, and goes for good on Skip', () => {
    let shown = show({ kind: 'news', pages: NEWS });
    document.querySelector('.veil').click();
    expect(shown.onkeep).not.toHaveBeenCalled();
    expect(closedThisStart('0.3.3')).toBe(true);
    unmount(live);
    shown = show({ kind: 'news', pages: NEWS });
    press('Skip');
    expect(shown.onkeep).toHaveBeenCalledWith({ whats_new_seen: '0.3.3' });
  });
});

describe('Find’s beta notice', () => {
  it('says Find is in beta, and goes for good on Got it', () => {
    const { onkeep, onclose } = show({ kind: 'beta' });
    expect(title()).toBe('Find is in beta');
    expect(document.querySelector('.where .badge').textContent).toBe('Beta');
    expect(document.querySelectorAll('.items li').length).toBeGreaterThan(0);
    expect(button('Skip')).toBeUndefined();
    press('Got it');
    expect(onkeep).toHaveBeenCalledWith({ find_beta_seen: true });
    expect(onclose).toHaveBeenCalledWith({});
  });

  it('opens the guide on Find, read for good', () => {
    const { onkeep, onclose } = show({ kind: 'beta' });
    press('Read the guide');
    expect(onkeep).toHaveBeenCalledWith({ find_beta_seen: true });
    expect(onclose).toHaveBeenCalledWith({ guide: FIND_GUIDE });
  });

  it('waits for the next start when closed with Escape, apart from What’s new', () => {
    const { onkeep, onclose } = show({ kind: 'beta' });
    key('Escape');
    expect(onkeep).not.toHaveBeenCalled();
    expect(onclose).toHaveBeenCalled();
    expect(sessionStorage.getItem('azimut:findBetaClosed')).toBe('0.3.3');
    expect(closedThisStart('0.3.3')).toBe(false);
  });
});
