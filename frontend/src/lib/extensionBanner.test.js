// @vitest-environment happy-dom
/**
 * Tests for Azimut's banner on the composer tab (extension/banner.js).
 *
 * While the hand-off fills a post, the page shows a small card saying what it is
 * doing, then Ready, or where it stopped. What is held here is the contract with
 * the page under it: it takes no press but its own close and presses nothing, it
 * keeps to its own shadow root, it gets out of the way once the analyst types, and
 * it goes when the hand-off is over, except for a stop, which stays until closed.
 *
 * The source is evaluated as the worker injects it: what to say on the window,
 * then the script. The filler says its steps through the banner's own element.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, '../../../extension/banner.js'), 'utf8');

/** The worker's two injections: what to say, then the banner. */
function show(state) {
  window.__AZIMUT_BANNER__ = state;
  return new Function(`const shown = ${source}\n; return shown;`)();
}

const host = () => document.querySelector('azimut-banner');
const card = () => host()?.shadowRoot.querySelector('.card');
const said = () => host()?.shadowRoot.querySelector('.line').textContent;
const note = () => host()?.shadowRoot.querySelector('.note').textContent;
const dot = () => host()?.shadowRoot.querySelector('.dot');
const close = () => host().shadowRoot.querySelector('.close');
/** The sheet the banner adopted, as text. */
const css = () => [...host().shadowRoot.adoptedStyleSheets].flatMap((sheet) => [...sheet.cssRules]).map((rule) => rule.cssText).join('\n');

afterEach(() => {
  host()?.remove();
  document.body.innerHTML = '';
  delete window.__AZIMUT_BANNER__;
  vi.useRealTimers();
});

describe('the banner on the composer tab', () => {
  it('says the step under way, with its own name, from a shadow root of its own', () => {
    document.body.innerHTML = '<div role="dialog"><div contenteditable="true"></div></div>';
    expect(show({ kind: 'busy', text: 'Filling your post…' })).toBe(true);

    expect(said()).toBe('Azimut · Filling your post…');
    expect(card().classList.contains('busy')).toBe(true);
    expect(card().getAttribute('role')).toBe('status');
    // outside the site's own tree, and nothing of it in the page's text
    expect(host().parentElement).toBe(document.documentElement);
    expect(document.body.textContent).not.toContain('Azimut');
    // the page keeps nothing of the hand-off on its window
    expect('__AZIMUT_BANNER__' in window).toBe(false);
  });

  it('steps along as it is told, the filler saying its steps through the banner already up', () => {
    show({ kind: 'busy', text: 'Bringing the pictures from Azimut…' });
    expect(said()).toBe('Azimut · Bringing the pictures from Azimut…');
    host().azimutSay({ kind: 'busy', text: 'Adding pictures 2 of 4…' });
    expect(said()).toBe('Azimut · Adding pictures 2 of 4…');
    host().azimutSay({ kind: 'busy', text: 'Post 2 of 3…' });
    expect(said()).toBe('Azimut · Post 2 of 3…');
    // one banner, however many times it is put up
    show({ kind: 'busy', text: 'Describing the pictures…' });
    expect(document.querySelectorAll('azimut-banner')).toHaveLength(1);
    expect(said()).toBe('Azimut · Describing the pictures…');
  });

  it('takes no press but its own close, and presses nothing on the page', () => {
    show({ kind: 'busy', text: 'Filling your post…' });
    const rules = css();
    expect(rules).toMatch(/:host \{[^}]*pointer-events: none !important/);
    expect(rules).toMatch(/\.card \{[^}]*pointer-events: none/);
    // only the close and the dot take a press
    const pressable = rules.split('\n').filter((rule) => rule.includes('pointer-events: auto'));
    expect(pressable.map((rule) => rule.slice(0, rule.indexOf(' {')))).toEqual(['.close', '.dot']);

    // whatever it says, the page's own buttons are never pressed
    document.body.innerHTML = '<button data-testid="tweetButton">Post</button>';
    const sent = vi.fn();
    document.querySelector('button').addEventListener('click', sent);
    for (const state of [
      { kind: 'busy', text: 'Post 2 of 3…' },
      { kind: 'wait', text: 'Post 1 of 2 is ready. Press Reply, then Azimut opens the next under it.' },
      { kind: 'ready', text: 'Ready. Check it, then press Post.' },
      { kind: 'stopped', text: 'Stopped: Could not add the next post to the thread.' },
      { end: true },
    ]) show(state);
    expect(sent).not.toHaveBeenCalled();
    expect(source).not.toMatch(/\.click\(|dispatchEvent/);
  });

  it('says Ready, then fades and is gone after about six seconds', () => {
    vi.useFakeTimers();
    show({ kind: 'busy', text: 'Filling your post…' });
    show({ kind: 'ready', text: 'Ready. Check it, then press Post.' });
    expect(said()).toBe('Azimut · Ready. Check it, then press Post.');
    expect(card().classList.contains('ready')).toBe(true);

    vi.advanceTimersByTime(5900);
    expect(host()).not.toBeNull();
    vi.advanceTimersByTime(200);
    expect(card().classList.contains('fading')).toBe(true);
    vi.advanceTimersByTime(500);
    expect(host()).toBeNull();
  });

  it('keeps Ready up while it carries a note of something missed', () => {
    vi.useFakeTimers();
    show({
      kind: 'ready',
      text: 'Ready. Check it, then press Post.',
      note: 'The picture descriptions of post 1 did not go in. Copy each one from Post into the composer.',
    });
    vi.advanceTimersByTime(60_000);
    expect(note()).toBe('The picture descriptions of post 1 did not go in. Copy each one from Post into the composer.');
    close().click();
    expect(host()).toBeNull();
  });

  it('keeps a stop up until it is closed, with the clipboard named when the rest is there', () => {
    vi.useFakeTimers();
    show({ kind: 'busy', text: 'Post 2 of 3…' });
    show({
      kind: 'stopped',
      text: 'Stopped: No reply was seen within 10 minutes, so Azimut stopped after post 1 of 3.',
      note: 'The rest is on your clipboard.',
    });
    show({ end: true }); // the hand-off is over: a stop stays all the same
    vi.advanceTimersByTime(10 * 60_000);
    expect(said()).toBe('Azimut · Stopped: No reply was seen within 10 minutes, so Azimut stopped after post 1 of 3.');
    expect(note()).toBe('The rest is on your clipboard.');
    expect(card().classList.contains('stopped')).toBe(true);

    close().click();
    expect(host()).toBeNull();
    // its listener went with it
    document.body.innerHTML = '<div contenteditable="true"></div>';
    expect(() => document.querySelector('[contenteditable]').dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))).not.toThrow();
  });

  it('goes when the hand-off is over, and is not put up again by its end', () => {
    show({ kind: 'wait', text: 'Post 1 of 2 is ready. Press Reply, then Azimut opens the next under it.' });
    expect(card().classList.contains('wait')).toBe(true);
    expect(show({ end: true })).toBe(true);
    expect(host()).toBeNull();
    expect(show({ end: true })).toBe(false);
    expect(host()).toBeNull();
  });

  it('shrinks to a dot once the analyst types in the composer, and opens again on the dot', () => {
    document.body.innerHTML = '<div role="dialog"><div contenteditable="true"></div><textarea></textarea></div>';
    show({ kind: 'wait', text: 'Post 1 of 2 is ready. Press Reply, then Azimut opens the next under it.' });
    const box = document.querySelector('[contenteditable]');
    const key = (target, init) => target.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ...init }));

    // the filler's Escape, a modifier, and a key outside a text box are no typing
    key(document.querySelector('textarea'), { key: 'Escape' });
    key(box, { key: 'Shift' });
    key(document.body, { key: 'a' });
    expect(card().classList.contains('shrunk')).toBe(false);
    expect(dot().classList.contains('shown')).toBe(false);

    key(box, { key: 'G' });
    expect(card().classList.contains('shrunk')).toBe(true);
    expect(dot().classList.contains('shown')).toBe(true);
    expect(dot().title).toBe('Azimut · Post 1 of 2 is ready. Press Reply, then Azimut opens the next under it.');
    // a step said meanwhile leaves it a dot; how the hand-off ends opens it
    host().azimutSay({ kind: 'busy', text: 'Post 2 of 2…' });
    expect(dot().classList.contains('shown')).toBe(true);

    dot().click();
    expect(card().classList.contains('shrunk')).toBe(false);
    expect(dot().classList.contains('shown')).toBe(false);
    key(box, { key: 'Backspace' });
    expect(card().classList.contains('shrunk')).toBe(true);
    show({ kind: 'stopped', text: 'Stopped: The next post did not open.' });
    expect(card().classList.contains('shrunk')).toBe(false);
  });

  it('closed on a step, it stays closed for the steps and comes back for how it ends', () => {
    show({ kind: 'busy', text: 'Adding pictures 1 of 2…' });
    close().click();
    expect(card().classList.contains('closed')).toBe(true);
    host().azimutSay({ kind: 'busy', text: 'Post 2 of 2…' });
    expect(card().classList.contains('closed')).toBe(true);
    show({ kind: 'ready', text: 'Ready. Check it, then press Post.' });
    expect(card().classList.contains('closed')).toBe(false);
    expect(said()).toBe('Azimut · Ready. Check it, then press Post.');
  });

  it('writes what it is told as text, never as markup', () => {
    show({ kind: 'stopped', text: 'Stopped: <img src=x onerror=alert(1)>', note: '<b>bold</b>' });
    expect(host().shadowRoot.querySelector('img')).toBeNull();
    expect(host().shadowRoot.querySelector('b')).toBeNull();
    expect(note()).toBe('<b>bold</b>');
    expect(source).not.toMatch(/innerHTML|insertAdjacentHTML/);
  });
});
