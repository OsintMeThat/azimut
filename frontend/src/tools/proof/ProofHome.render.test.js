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
  ...Array.from({ length: 6 }, (_, i) => proof(`p${i}`, `Proof ${i}`, 30 + i)),
];
const FILES = [{
  video: 'media/clip.mp4', title: 'clip.mp4', kind: 'video', scenes: [
    { kind: 'draft', id: 's1', start: 36, end: 48, label: 'Water tower?', state: 'progress', captures: ['c.png'], order: 2 },
    { kind: 'draft', id: 's2', start: 90, end: null, label: '', state: 'todo', captures: [], order: 3 },
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
    expect(home().querySelector('input[aria-label="Find a proof by name"]')).not.toBeNull();
  });

  it('continues from the last six proofs, a proof of a video tagged by its title in its scene\'s colour', () => {
    const { onopen, onall } = open();
    const cards = [...home().querySelectorAll('.ph-card')];
    expect(cards.map((c) => c.querySelector('.ph-title').textContent)).toEqual(['Market', 'Holiday', 'Proof 0', 'Proof 1', 'Proof 2', 'Proof 3']);
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

  it('finds a proof by its name and opens the first on Enter', () => {
    const { onopen } = open();
    const input = home().querySelector('input[aria-label="Find a proof by name"]');
    input.value = 'proof 4';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect([...home().querySelectorAll('.ph-hit-title')].map((t) => t.textContent)).toEqual(['Proof 4']);
    expect(home().querySelector('.ph-card')).toBeNull();
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onopen).toHaveBeenCalledWith(PROOFS[6]);
    input.value = 'nothing like it';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    flushSync();
    expect(home().textContent).toContain('No proof by that name.');
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
    expect(chips[0].querySelector('.ph-chip-state').textContent).toBe('Geolocating · 1 capture');
    expect(chips[0].classList.contains('live')).toBe(true);
    expect(chips[1].querySelector('.ph-chip-state').textContent).toBe('To geolocate');
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
