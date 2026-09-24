// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';

const { default: SourcePicker } = await import('./SourcePicker.svelte');

const MEDIA = [
  { path: 'media/roof.png', kind: 'image', title: 'Roof', source: { type: 'upload' } },
  { path: 'media/clip.mp4', kind: 'video', title: 'Convoy clip', source: { type: 'download' } },
  { path: 'media/cap.png', kind: 'image', title: 'Harbour capture', source: { type: 'satellite' } },
  { path: 'media/fr.png', kind: 'image', title: '00-00-12 Convoy clip', source: { op: 'frame' } },
];
const WORKS = [{ name: 'Convoy clip', title: 'Convoy clip', source: 'media/clip.mp4', frames: 3, kind: 'video' }];

let live = null;
let target = null;

function show(props = {}) {
  target = document.createElement('div');
  document.body.append(target);
  const all = { media: MEDIA, works: WORKS, caseId: 'case-a', onpick: vi.fn(), ...props };
  live = mount(SourcePicker, { target, props: all });
  flushSync();
  return all;
}

const titles = () => [...target.querySelectorAll('.card .title')].map((el) => el.textContent);
const button = (text) => [...target.querySelectorAll('button')].find((b) => b.textContent.trim() === text);

afterEach(() => {
  if (live) unmount(live);
  live = null;
  target?.remove();
});

describe('the file picker', () => {
  it('leads with the files already worked on, and says how far', () => {
    show();

    expect(target.querySelector('h4').textContent).toBe('Worked on');
    expect(titles()[0]).toBe('Convoy clip');
    expect(target.querySelector('.count').textContent).toBe('3 frames');
    // and each file shows once, not again under everything else
    expect(titles().filter((t) => t === 'Convoy clip')).toHaveLength(1);
  });

  it('opens a file on a click', () => {
    const props = show();
    target.querySelector('.card').click();
    expect(props.onpick).toHaveBeenCalledWith(MEDIA[1]);
  });

  it('sorts captures and frames out of plain media', () => {
    show();

    button('Captures').click();
    flushSync();
    expect(titles()).toEqual(['Harbour capture']);

    button('Frames').click();
    flushSync();
    expect(titles()).toEqual(['00-00-12 Convoy clip']);
  });

  it('drops the worked-on row while a filter narrows the list', () => {
    show();
    button('Images').click();
    flushSync();
    expect(target.querySelector('h4')).toBeNull();
  });

  it('says when a case holds nothing to open', () => {
    show({ media: [], works: [] });
    expect(target.textContent).toContain('Add an image or a video to the case first.');
  });
});
