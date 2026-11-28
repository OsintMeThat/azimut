// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import NewsAlso from './NewsAlso.svelte';
import { loadModels } from '../lib/icons/loadModels.svelte.js';
import { KOFI_PITCH, KOFI_URL } from '../lib/support.js';

const PAGE = {
  title: 'And also',
  update: { icon: 'download', text: 'Azimut can download its next versions for you.', more: 'Installing stays one press.' },
  models: { name: 'Geo Proof', text: '3D vehicle models', fleet: [['model-tank', '#6b7a3a'], ['model-heli', '#8b9a76']] },
  tiles: [
    { icon: 'chart', name: 'Detect', text: 'Routine dashboard' },
    { icon: 'layers', name: 'Collage', text: 'Panorama' },
  ],
  kofi: true,
};

let live = null;
afterEach(() => {
  if (live) unmount(live);
  live = null;
  document.body.innerHTML = '';
});

function show(page) {
  const target = document.createElement('div');
  document.body.append(target);
  live = mount(NewsAlso, { target, props: { page } });
  flushSync();
}

describe('the And also page', () => {
  it('says what may need a word first, then a tile a change', () => {
    show(PAGE);
    expect(document.querySelector('.update').textContent).toContain('Installing stays one press.');
    expect([...document.querySelectorAll('.tiles li')].map((tile) => tile.textContent.trim())).toEqual(['DetectRoutine dashboard', 'CollagePanorama']);
  });

  it('draws the vehicle models with the icon library once it has landed', async () => {
    show(PAGE);
    await loadModels();
    await tick();
    flushSync();
    expect(document.querySelectorAll('.fleet svg')).toHaveLength(2);
    expect(document.querySelector('.models').textContent).toContain('Geo Proof');
  });

  it('ends on the tip, opened in a tab of its own so the reading goes on', () => {
    show(PAGE);
    const link = document.querySelector('.kofi a');
    expect(link.getAttribute('href')).toBe(KOFI_URL);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer');
    expect(document.querySelector('.kofi').textContent).toContain(KOFI_PITCH.title);
    expect(document.querySelector('.kofi').textContent).toContain(KOFI_PITCH.line);
  });

  it('shows no tip on a page that asks for none', () => {
    show({ ...PAGE, kofi: false });
    expect(document.querySelector('.kofi')).toBeNull();
  });
});
