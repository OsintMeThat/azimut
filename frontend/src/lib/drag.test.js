// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  MEDIA_DRAG,
  PAGE_DRAG,
  carriesMedia,
  carriesOutsideFiles,
  droppedMedia,
  leftZone,
  startMediaDrag,
  watchDrags,
} from './drag.js';

/** A stand-in for the browser's DataTransfer: a type list kept in step with the data. */
function transfer(data = {}) {
  const store = { ...data };
  return {
    get types() {
      return Object.keys(store);
    },
    setData: (type, value) => (store[type] = value),
    getData: (type) => store[type] ?? '',
    dropEffect: 'move',
    effectAllowed: 'all',
  };
}

function dragEvent(type, dataTransfer, extra = {}) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
  for (const [key, value] of Object.entries(extra)) Object.defineProperty(event, key, { value });
  return event;
}

describe('telling a desktop file from a drag out of the page', () => {
  it('takes files nothing in the page started', () => {
    expect(carriesOutsideFiles(dragEvent('dragover', transfer({ Files: '' })))).toBe(true);
  });

  it('refuses a picture dragged out of the page, which Chromium also lists as Files', () => {
    const event = dragEvent('dragover', transfer({ Files: '', 'text/uri-list': 'x', [PAGE_DRAG]: '1' }));
    expect(carriesOutsideFiles(event)).toBe(false);
  });

  it('refuses a drag with no file at all', () => {
    expect(carriesOutsideFiles(dragEvent('dragover', transfer({ 'text/plain': 'e1' })))).toBe(false);
    expect(carriesOutsideFiles(new Event('dragover'))).toBe(false);
  });
});

describe('watchDrags', () => {
  let stop = () => {};
  afterEach(() => stop());

  it('marks every drag that starts in the page', () => {
    stop = watchDrags(window);
    const data = transfer();
    document.body.dispatchEvent(dragEvent('dragstart', data));
    expect(data.types).toContain(PAGE_DRAG);
  });

  it('keeps a desktop file let go outside any zone from replacing the app', () => {
    stop = watchDrags(window);
    const over = dragEvent('dragover', transfer({ Files: '' }));
    document.body.dispatchEvent(over);
    expect(over.defaultPrevented).toBe(true);
    expect(over.dataTransfer.dropEffect).toBe('none');
    const drop = dragEvent('drop', transfer({ Files: '' }));
    document.body.dispatchEvent(drop);
    expect(drop.defaultPrevented).toBe(true);
  });

  it('leaves a zone that took the file alone', () => {
    stop = watchDrags(window);
    const zone = document.createElement('div');
    document.body.append(zone);
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    });
    const over = dragEvent('dragover', transfer({ Files: '' }));
    zone.dispatchEvent(over);
    expect(over.dataTransfer.dropEffect).toBe('copy');
    zone.remove();
  });

  it('leaves text and in-page drags to the browser', () => {
    stop = watchDrags(window);
    const text = dragEvent('dragover', transfer({ 'text/plain': 'hello' }));
    document.body.dispatchEvent(text);
    expect(text.defaultPrevented).toBe(false);
  });

  it('stops listening once cleaned up', () => {
    watchDrags(window)();
    const data = transfer();
    document.body.dispatchEvent(dragEvent('dragstart', data));
    expect(data.types).not.toContain(PAGE_DRAG);
  });
});

describe('leftZone', () => {
  const zone = document.createElement('div');
  const child = document.createElement('span');
  zone.append(child);

  it('ignores a move onto a child, the overlay included', () => {
    expect(leftZone({ currentTarget: zone, relatedTarget: child })).toBe(false);
  });

  it('counts a move outside, and a drag that went nowhere', () => {
    expect(leftZone({ currentTarget: zone, relatedTarget: document.body })).toBe(true);
    expect(leftZone({ currentTarget: zone, relatedTarget: null })).toBe(true);
  });
});

describe('a media on its way to a folder', () => {
  it('carries the file in its own type and reads back as entities to file', () => {
    const data = transfer();
    startMediaDrag(dragEvent('dragstart', data), {
      path: 'media/quai.jpg',
      filename: 'quai.jpg',
      folder: 'Energodar',
    });
    expect(data.types).toEqual([MEDIA_DRAG]);
    expect(data.effectAllowed).toBe('move');
    const drop = dragEvent('drop', data);
    expect(carriesMedia(drop)).toBe(true);
    expect(droppedMedia(drop)).toEqual([
      { type: 'media', label: 'quai.jpg', attrs: { path: 'media/quai.jpg', folder: 'Energodar' } },
    ]);
  });

  it('prefers the title and reads an unfiled file as the root', () => {
    const data = transfer();
    startMediaDrag(dragEvent('dragstart', data), { path: 'media/a.png', filename: 'a.png', title: 'Quay' });
    expect(droppedMedia(dragEvent('drop', data))[0]).toMatchObject({ label: 'Quay', attrs: { folder: '' } });
  });

  it('reads nothing out of a payload it did not write', () => {
    expect(droppedMedia(dragEvent('drop', transfer({ [MEDIA_DRAG]: '{oops' })))).toEqual([]);
    expect(droppedMedia(dragEvent('drop', transfer({ [MEDIA_DRAG]: '{"path":"x"}' })))).toEqual([]);
    expect(droppedMedia(dragEvent('drop', transfer({ [MEDIA_DRAG]: '[{"path":""},{}]' })))).toEqual([]);
    expect(droppedMedia(dragEvent('drop', transfer()))).toEqual([]);
    expect(carriesMedia(dragEvent('dragover', transfer({ Files: '' })))).toBe(false);
  });
});

describe('every zone that imports dropped files', () => {
  it('takes only files from outside the page', () => {
    // A zone reading the files of any drag reimports the pictures dragged around the page.
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    const zones = readdirSync(root, { recursive: true })
      .filter((name) => name.endsWith('.svelte'))
      .filter((name) => /dataTransfer\??\.files/.test(readFileSync(join(root, name), 'utf8')));
    expect(zones.length).toBeGreaterThan(5);
    const unguarded = zones.filter((name) => !readFileSync(join(root, name), 'utf8').includes('carriesOutsideFiles('));
    expect(unguarded).toEqual([]);
  });
});
