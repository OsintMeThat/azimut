// @vitest-environment happy-dom
import { afterEach, expect, it } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import DetectDetection from './DetectDetection.svelte';

const detection = { id: 'f1', title: 'Harbour watch', history: [], areas: 0, method: 'change' };

let live, target;
afterEach(() => { if (live) unmount(live); target?.remove(); });

function open(detail) {
  target = document.createElement('div');
  document.body.append(target);
  live = mount(DetectDetection, { target, props: { detection, detail } });
  flushSync();
}

it('says so when an area the routine drew on was deleted for good', () => {
  open({ zones: [], missing_areas: ['a1b2c3d4e5f6'] });
  expect(target.textContent).toContain('An area it drew on was deleted. Edit the routine to add one.');
});

it('says nothing of the kind while every area is there', () => {
  open({ zones: [{ id: 'z1' }] });
  expect(target.textContent).not.toContain('deleted');
});
