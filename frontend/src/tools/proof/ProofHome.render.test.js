// @vitest-environment happy-dom
/**
 * Geo Proof's home, mounted: New proof and the search on top, the last proofs saved, a
 * proof of a video tagged, and To prove only when the case has scenes still to prove.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import { sceneColorAt } from '../../lib/scenes.js';

const { default: ProofHome } = await import('./ProofHome.svelte');

const at = (hoursAgo) => new Date(Date.now() - hoursAgo * 3_600_000).toISOString();
const proof = (name, title, hoursAgo, extra = {}) => ({
  name, title, updated_at: at(hoursAgo), thumb: `proofs/.thumbs/${name}.webp`, png: `proofs/${name}.png`, video: null, ...extra,
});
const PROOFS = [
  proof('market', 'Market', 2, { video: 'media/clip.mp4', video_title: 'Harbour run', order: 1, slide: 2, slides: 4 }),
  proof('holiday', 'Holiday', 5),
  // never named: each reads as its label, where and when it is, else its point, else Untitled
  proof('p0', 'Proof 0', 30, { place: 'Al Jawf, Yemen', when: '2024-03-05 06:40', points: [{ lat: 16.1, lon: 44.8 }] }),
  proof('p1', 'Proof 1', 31, { points: [{ lat: 15.47123, lon: 45.32211 }], created_at: '2024-03-06T12:00:00Z' }),
  proof('p2', 'Proof 2', 32),
  proof('p3', 'Proof 3', 33, { place: 'Marib, Yemen' }),
  ...Array.from({ length: 2 }, (_, i) => proof(`p${i + 4}`, `Proof ${i + 4}`, 34 + i)),
];
const FILES = [{
  video: 'media/clip.mp4', title: 'clip.mp4', kind: 'video', scenes: [
    { kind: 'draft', id: 's1', start: 36, end: 48, label: 'Water tower?', state: 'progress', captures: ['c.png'], footage: 4, order: 2 },
    { kind: 'draft', id: 's2', start: 90, end: null, label: '', state: 'todo', captures: [], footage: 0, order: 3 },
  ],
}];

const live = [];
function open(props = {}) {
  const target = document.createElement('div');
  document.body.append(target);
  const handlers = { onnew: vi.fn(), onopen: vi.fn(), onall: vi.fn(), onscene: vi.fn() };
  const app = mount(ProofHome, { target, props: { caseId: 'case-1', proofs: PROOFS, files: [], ...handlers, ...props } });
  live.push(app);
  flushSync();
  return handlers;
}

afterEach(() => {
  while (live.length) unmount(live.pop());
  document.body.innerHTML = '';
});

const home = () => document.querySelector('[data-testid="proof-home"]');
const button = (text) => [...home().querySelectorAll('button')].find((b) => b.textContent.trim().startsWith(text));

describe('the home of a case with proofs', () => {
  it('offers New proof and the search on top', () => {
    const { onnew } = open();
    button('New proof').click();
    expect(onnew).toHaveBeenCalledOnce();
    expect(home().querySelector('input[aria-label="Find a proof by name or place"]')).not.toBeNull();
  });

  it('continues from the last six proofs, a proof of a video tagged by its title in its scene\'s colour', () => {
    const { onopen, onall } = open();
    const cards = [...home().querySelectorAll('.ph-card')];
    expect(cards.map((c) => c.querySelector('.ph-title').textContent)).toEqual([
      'Market', 'Holiday', 'Al Jawf, Yemen · 5 Mar 2024', '15.4712, 45.3221 · 6 Mar 2024', 'Untitled proof', 'Marib, Yemen',
    ]);
    const tag = cards[0].querySelector('.ph-tag');
    expect(tag.textContent).toBe('Harbour run · 2/4');
    expect(tag.getAttribute('style')).toContain(`--scene: ${sceneColorAt(1)}`);
    expect(cards[1].querySelector('.ph-tag')).toBeNull();
    expect(cards[0].querySelector('.ph-when').textContent).toBe('2 h ago');
    expect(cards[0].querySelector('img').getAttribute('src')).toContain('proofs/.thumbs/market.webp');
    cards[1].click();
    expect(onopen).toHaveBeenCalledWith(PROOFS[1]);
    button('All 8 proofs').click();
    expect(onall).toHaveBeenCalledOnce();
  });

  it('finds a proof by its name or its place and opens the first on Enter', () => {
    const { onopen } = open();
    const input = home().querySelector('input[aria-label="Find a proof by name or place"]');
    input.value = 'holiday';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...home().querySelectorAll('.ph-hit-title')].map((t) => t.textContent)).toEqual(['Holiday']);
    // a proof with no name of its own, found by where it is
    input.value = 'jawf';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...home().querySelectorAll('.ph-hit-title')].map((t) => t.textContent)).toEqual(['Al Jawf, Yemen · 5 Mar 2024']);
    expect(home().querySelector('.ph-card')).toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onopen).toHaveBeenCalledWith(PROOFS[2]);
    input.value = 'nothing like it';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(home().textContent).toContain('No proof by that name or place.');
  });

  it('shows no To prove in a case with no scene', () => {
    open({ files: [] });
    expect(home().textContent).not.toContain('To prove');
    expect(home().querySelector('.ph-chip')).toBeNull();
  });

  it('holds the cards in place while the list is read the first time', () => {
    open({ proofs: null });
    expect(home().querySelectorAll('.ph-card.ghost')).toHaveLength(3);
    expect(home().querySelector('.ph-empty')).toBeNull();
  });
});

describe('To prove', () => {
  it('shows a card per video with its scenes as chips, a chip making the proof', () => {
    const { onscene } = open({ files: FILES, live: { video: 'media/clip.mp4', id: 's1' } });
    expect(home().textContent).toContain('To prove');
    expect(home().textContent).toContain('2 scenes to geolocate');
    expect(home().querySelector('.ph-video h5').textContent).toBe('clip.mp4');
    const chips = [...home().querySelectorAll('.ph-chip')];
    expect(chips.map((c) => c.querySelector('.ph-chip-name').textContent)).toEqual(['Water tower?', '1:30']);
    expect(chips[0].querySelector('.ph-chip-time').textContent).toBe('0:36–0:48');
    // two counts, the map's and the video's, a count at 0 greyed, the hover saying them in words
    const counts = (chip) => [...chip.querySelectorAll('[data-testid^="count-"]')].map((c) => [c.textContent.trim(), c.classList.contains('none')]);
    expect(counts(chips[0])).toEqual([['1', false], ['4', false]]);
    expect(chips[0].querySelector('[data-testid="scene-counts"]').title).toBe('Geolocating: 1 map capture, 4 pictures from the video');
    expect(chips[0].querySelector('[data-testid="scene-counts"]').dataset.stage).toBe('live');
    expect(chips[0].classList.contains('live')).toBe(true);
    expect(counts(chips[1])).toEqual([['0', true], ['0', true]]);
    expect(chips[1].querySelector('[data-testid="scene-counts"]').title).toBe('To geolocate: no map capture yet, nothing from the video yet');
    expect(chips[1].querySelector('[data-testid="scene-counts"]').dataset.stage).toBe('todo');
    chips[1].click();
    expect(onscene).toHaveBeenCalledWith(FILES[0], FILES[0].scenes[1]);
  });
});

describe('an empty case', () => {
  it('shows the big button and one sentence', () => {
    const { onnew } = open({ proofs: [], files: [] });
    const empty = home().querySelector('.ph-empty');
    expect(empty.querySelectorAll('p')).toHaveLength(1);
    expect(home().querySelector('input')).toBeNull();
    expect(home().textContent).not.toContain('Continue');
    empty.querySelector('button').click();
    expect(onnew).toHaveBeenCalledOnce();
  });

  it('still lists its scenes when it holds no proof yet', () => {
    open({ proofs: [], files: FILES });
    expect(home().querySelector('.ph-empty')).toBeNull();
    expect(home().querySelectorAll('.ph-chip')).toHaveLength(2);
  });
});
