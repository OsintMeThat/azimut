// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import LayerPicturePicker from './LayerPicturePicker.svelte';

let held;
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });

const media = (id, label, kind = 'image') => ({ id, type: 'media', label, attrs: { kind }, thumb: `media/.thumbs/${id}.jpg` });
/** The case's catalog: what each request answers, by its words. */
function catalog(pages) {
  return vi.fn(async (url) => {
    const words = new URL(url, 'http://x').searchParams.get('q') ?? '';
    return { items: pages[words] ?? [] };
  });
}
async function show(props) {
  held = mount(LayerPicturePicker, { target: document.body, props: { caseId: 'c1', feature: 'k1', ...props } });
  flushSync();
  await settle();
  flushSync();
}
const names = () => [...document.querySelectorAll('.rows .row-name')].map((node) => node.textContent);

describe('the Picture field', () => {
  it('lists first the pictures holding the feature’s number on its own, saying the rule', async () => {
    const get = catalog({ 7: [media('a', 'Vehicle 07'), media('b', 'Vehicle 17'), media('c', 'radio 7', 'audio'), media('d', '#7 M-ATV')] });
    const onpick = vi.fn();
    await show({ name: '#7', get, onpick });
    expect(get.mock.calls[0][0]).toContain('q=7');
    // the one saying #7 first
    expect(names()).toEqual(['#7 M-ATV', 'Vehicle 07']);
    expect(document.querySelector('.said').textContent).toBe('With 7 in the name');
    expect(document.querySelector('.rows img').getAttribute('src')).toBe('/files/c1/media/.thumbs/d.jpg');
    document.querySelectorAll('.rows button')[1].click();
    expect(onpick).toHaveBeenCalledWith('a');
  });

  it('falls back to the newest pictures, and finds any by name with Enter taking the first', async () => {
    const get = catalog({ '': [media('n', 'Newest crop')], tygor: [media('t', 'Tygor 44')] });
    const onpick = vi.fn();
    await show({ name: 'Checkpoint', get, onpick });
    expect(names()).toEqual(['Newest crop']);
    expect(document.querySelector('.said').textContent).toBe('Newest in the case');
    const field = document.querySelector('input[aria-label="Find a picture"]');
    field.value = 'tygor';
    field.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    await new Promise((resolve) => setTimeout(resolve, 220));
    flushSync();
    expect(names()).toEqual(['Tygor 44']);
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onpick).toHaveBeenCalledWith('t');
  });

  it('shows the picture set small, opened on a press, changed or removed', async () => {
    const get = catalog({ 7: [media('a', 'Vehicle 07')] });
    const onpick = vi.fn();
    const onopen = vi.fn();
    await show({ name: '#7', value: 'p1', shown: { path: 'proofs/p1.png', label: 'Gate proof', type: 'proof' }, get, onpick, onopen });
    // set: no list asked for
    expect(get).not.toHaveBeenCalled();
    expect(document.querySelector('.current-name').textContent).toBe('Gate proof');
    expect(document.querySelector('.current-kind').textContent).toBe('Proof · shown in its card');
    document.querySelector('.current-picture').click();
    expect(onopen).toHaveBeenCalledWith('p1');
    [...document.querySelectorAll('.text-act')].find((node) => node.textContent === 'Change').click();
    flushSync();
    await settle();
    flushSync();
    expect(names()).toEqual(['Vehicle 07']);
    [...document.querySelectorAll('.text-act')].find((node) => node.textContent === 'Remove').click();
    expect(onpick).toHaveBeenCalledWith('');
  });

  it('says when nothing is found by that name', async () => {
    await show({ name: '', get: catalog({}) });
    expect(document.querySelector('.none').textContent).toBe('No picture in the case yet');
  });
});
