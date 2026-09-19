// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DateField from './DateField.svelte';

let target;
let app;

function open(props) {
  target = document.createElement('div');
  document.body.append(target);
  const sent = [];
  const state = $state({ value: '', ...props });
  app = mount(DateField, {
    target,
    props: {
      get value() {
        return state.value;
      },
      get day() {
        return state.day ?? false;
      },
      get calendar() {
        return state.calendar ?? false;
      },
      onchange: (next) => {
        sent.push(next);
        state.value = next;
      },
    },
  });
  flushSync();
  return { sent, state };
}

const field = () => target.querySelector('input');
const said = () => target.querySelector('.said')?.textContent.trim() ?? '';

function type(text) {
  field().value = text;
  field().dispatchEvent(new Event('input', { bubbles: true }));
  flushSync();
}

afterEach(() => {
  if (app) unmount(app);
  target?.remove();
  app = null;
});

describe('the date field', () => {
  it('opens on a stored date written day-first', () => {
    open({ value: '2025-10-24~' });
    expect(field().value).toBe('~24/10/2025');
    expect(field().getAttribute('placeholder')).toBe('dd/mm/yyyy');
  });

  it('hands on what it read, and says it under the field', () => {
    const { sent } = open();
    type('24 oct 2025');
    expect(sent.at(-1)).toBe('2025-10-24');
    expect(said()).toBe('24 Oct 2025');
    type('~Oct 2025?');
    expect(sent.at(-1)).toBe('2025-10%');
    expect(said()).toBe('Oct 2025 · Approximate · Uncertain');
  });

  it('shows the kept form once the field is left', () => {
    open();
    type('24.10.2025');
    field().dispatchEvent(new Event('blur'));
    flushSync();
    expect(field().value).toBe('24/10/2025');
  });

  it('passes unreadable text on as typed, so the save refuses it, and says why now', () => {
    const { sent } = open();
    type('31/02/2025');
    expect(sent.at(-1)).toBe('31/02/2025');
    expect(said()).toBe('That date does not exist.');
    expect(field().getAttribute('aria-invalid')).toBe('true');
  });

  it('follows a value cleared from outside', () => {
    const { state } = open({ value: '2025-10-24' });
    state.value = '';
    flushSync();
    expect(field().value).toBe('');
    expect(said()).toBe('');
  });

  it('keeps one plain day when it computes from it, and hands on nothing else', () => {
    const { sent } = open({ day: true });
    type('Oct 2025');
    expect(sent).toEqual([]);
    expect(said()).toBe('Give one full day, like 24/10/2025.');
    type('24/10/2025');
    expect(sent).toEqual(['2025-10-24']);
  });
});

describe('the builder beside it', () => {
  const button = () => target.querySelector('.field-act');
  const builder = () => target.querySelector('.builder');
  const day = (iso) => [...target.querySelectorAll('.day')].find((b) => b.title === iso);
  const cell = (title) => [...target.querySelectorAll('.cell')].find((b) => b.title === title);
  const chip = (text) =>
    [...target.querySelectorAll('.chip')].find((b) => b.textContent.trim() === text);

  function press(element) {
    element.click();
    flushSync();
  }

  it('stays away from a field that was not offered one', () => {
    open({ value: '2025-10-24' });
    expect(button()).toBe(null);
    expect(builder()).toBe(null);
  });

  it('opens on the date the field holds, and writes the day it is pressed on', () => {
    const { sent } = open({ value: '2025-10-24', calendar: true });
    press(button());

    expect(builder()).not.toBe(null);
    expect(target.querySelector('.month').textContent).toBe('Oct 2025');
    expect(day('2025-10-24').classList.contains('on')).toBe(true);

    press(day('2025-10-09'));
    expect(sent).toEqual(['2025-10-09']);
    expect(field().value).toBe('09/10/2025');
    // it stays open: a date is built in two or three presses, not one
    expect(builder()).not.toBe(null);
  });

  it('goes only as deep as the answer does', () => {
    const { sent } = open({ value: '2025-10-24', calendar: true });
    press(button());

    press(chip('Month'));
    expect(sent.at(-1)).toBe('2025-10'); // the day is dropped, the month kept
    press(cell('2025-03'));
    expect(sent.at(-1)).toBe('2025-03');
    expect(field().value).toBe('Mar 2025');

    press(chip('Year'));
    expect(sent.at(-1)).toBe('2025');
    press(cell('2023'));
    expect(sent.at(-1)).toBe('2023');
  });

  it('carries the two marks of doubt', () => {
    const { sent } = open({ value: '2025-10-24', calendar: true });
    press(button());

    press(chip('~'));
    expect(sent.at(-1)).toBe('2025-10-24~');
    press(chip('?'));
    expect(sent.at(-1)).toBe('2025-10-24%'); // both, which the profile writes %
    press(chip('~'));
    expect(sent.at(-1)).toBe('2025-10-24?');
  });

  it('builds a period from two presses, whichever order they come in', () => {
    const { sent } = open({ value: '2025-10-24', calendar: true });
    press(button());

    press(chip('Period'));
    press(day('2025-10-09')); // picked second but earlier: the ends swap
    expect(sent.at(-1)).toBe('2025-10-09/2025-10-24');
    expect(field().value).toBe('09/10/2025 to 24/10/2025');
  });

  it('opens on what a looser answer named, marks and all', () => {
    open({ value: '2025-03~', calendar: true });
    press(button());

    // a month answer opens the month page, not a calendar of days
    expect(target.querySelector('.title').textContent).toBe('2025');
    expect(cell('2025-03').classList.contains('on')).toBe(true);
    expect(chip('Month').getAttribute('aria-pressed')).toBe('true');
    expect(chip('~').getAttribute('aria-pressed')).toBe('true');
  });

  it('leaves a date it cannot draw alone until a day is actually picked', () => {
    // a timestamp is typed, not built; the builder opens blank on one, and a
    // press on the precision chips used to write that blank over it
    const { sent } = open({ value: '2025-10-24T14:30:00Z', calendar: true });
    press(button());

    press(chip('Month'));
    press(chip('~'));
    expect(sent).toEqual([]);
    expect(field().value).toBe('24/10/2025 14:30 UTC');

    // …and the first month actually pressed is what replaces it, marks and all
    press(target.querySelector('.cell'));
    expect(sent.at(-1)).toMatch(/^\d{4}-\d{2}~$/);
  });

  it('empties the field only when Clear is the press', () => {
    const { sent } = open({ value: '2025-10-24', calendar: true });
    press(button());
    press(chip('Clear'));
    expect(sent.at(-1)).toBe('');
    expect(field().value).toBe('');
  });

  it('is drawn in the panel rather than over it, like every other month here', () => {
    open({ calendar: true });
    press(button());

    expect(getComputedStyle(builder()).position).not.toBe('absolute');
    expect(getComputedStyle(builder()).position).not.toBe('fixed');
  });
});
