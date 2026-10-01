// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import PassCalendar from './PassCalendar.svelte';

let app;
afterEach(() => { if (app) unmount(app); document.body.innerHTML = ''; app = null; });

it('shows only actual passes as selectable calendar days and loads each month', async () => {
  const pass = { date: '2026-09-15', cloud: 12, coverage: 1 };
  const onmonth = vi.fn();
  const onpick = vi.fn();
  const onclose = vi.fn();
  app = mount(PassCalendar, { target: document.body, props: {
    list: [pass], value: pass.date, label: 'A', onmonth, onpick, onclose,
  } });
  await Promise.resolve(); flushSync();
  expect(onmonth).toHaveBeenCalledWith('2026-09');
  const day = document.querySelector('button[aria-label="2026-09-15: 12% cloud"]');
  expect(day.disabled).toBe(false);
  expect(day.classList.contains('clear')).toBe(true);
  expect(document.querySelector('button[aria-label="2026-09-14: no pass"]').disabled).toBe(true);
  day.click(); flushSync();
  expect(onpick).toHaveBeenCalledWith(pass);
  document.querySelector('button[aria-label="Previous month"]').click(); flushSync();
  expect(onmonth).toHaveBeenCalledWith('2026-08');
  document.querySelector('button[aria-label="Close calendar"]').click(); flushSync();
  expect(onclose).toHaveBeenCalledOnce();
});

it('opens on the month of the day it is told to be near when none is chosen', async () => {
  const onmonth = vi.fn();
  app = mount(PassCalendar, { target: document.body, props: { list: [], value: '', near: '2026-03-20', label: 'A', onmonth } });
  await Promise.resolve(); flushSync();
  expect(onmonth).toHaveBeenCalledWith('2026-03');
  unmount(app);
  app = mount(PassCalendar, { target: document.body, props: { list: [], value: '2026-07-02', near: '2026-03-20', label: 'A', onmonth } });
  await Promise.resolve(); flushSync();
  expect(onmonth).toHaveBeenLastCalledWith('2026-07');
});

it('lets a radar day with two passes choose its time', async () => {
  const early = { date: '2026-09-15', time: '05:30:00Z', orbit: 'ascending' };
  const late = { date: '2026-09-15', time: '17:40:00Z', orbit: 'descending' };
  const onpick = vi.fn();
  app = mount(PassCalendar, { target: document.body, props: {
    list: [early, late], value: early.date, label: 'B', radar: true, onpick,
  } });
  await Promise.resolve(); flushSync();
  document.querySelector('button[aria-label^="2026-09-15:"]').click(); flushSync();
  expect(onpick).not.toHaveBeenCalled();
  document.querySelectorAll('.times button')[1].click(); flushSync();
  expect(onpick).toHaveBeenCalledWith(late);
});

it('disables a real pass when it would put A after B', async () => {
  const onpick = vi.fn();
  app = mount(PassCalendar, { target: document.body, props: {
    list: [{ date: '2026-09-15', cloud: 2 }], value: '2026-09-12', label: 'A',
    eligible: (pass) => pass.date < '2026-09-12', onpick,
  } });
  await Promise.resolve(); flushSync();
  const day = document.querySelector('button[aria-label="2026-09-15: outside date order"]');
  expect(day.disabled).toBe(true);
  day.click(); flushSync();
  expect(onpick).not.toHaveBeenCalled();
});
