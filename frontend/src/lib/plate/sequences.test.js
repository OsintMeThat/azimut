import { describe, expect, it } from 'vitest';
import { SEQUENCES, SEQUENCE_ADDS, withSequence } from './sequences.js';
import { duplicatedStep, stepsOf } from './page.js';

const map = { id: 'map', kind: 'map', box: [0, 0, 100, 80], view: { lat: 44, lon: 33, zoom: 9, bearing: 0 } };
const spec = () => ({ page: { paper: 'a4', orientation: 'landscape' }, theme: { paper: '#ffffff', ink: '#111111', accent: '#c8102e' },
  time: { at: null }, steps: {}, framing: {}, elements: [{ ...map }] });

describe('the ready sequences', () => {
  it('add their steps, each framing the main map from where it looks, the transitions on', () => {
    const made = withSequence(spec(), null, 'seq-reveal', { map, view: map.view });
    const steps = made.steps.now;
    expect(steps.map((step) => step.name)).toEqual(['The region', 'The place', 'Closer', 'The whole picture']);
    expect(steps.map((step) => made.framing[step.id].map.zoom)).toEqual([6, 9, 11, 8]);
    expect(made.transitions).toMatchObject({ on: true, move: true, fade: true });
    expect(made.step).toBe(steps.at(-1).id);
  });

  it('cover the page with the paper and its words on a card\'s step', () => {
    const made = withSequence(spec(), null, 'seq-title', { map, view: map.view });
    const [step] = made.steps.now;
    const card = made.elements.filter((element) => element.step === step.id);
    expect(card[0]).toMatchObject({ kind: 'shape', box: [0, 0, 297, 210], fill: '#ffffff', border: false });
    expect(card[1]).toMatchObject({ kind: 'shape', name: 'Rule', fill: '#c8102e' });
    const words = card.filter((element) => element.kind === 'text');
    expect(words.map((element) => element.role)).toEqual(['kicker', 'title', 'dek']);
    // sized to the page, and stood in its middle
    expect(words[1].size).toBeCloseTo(39.9, 1);
    const top = card[1].box[1];
    const bottom = words[2].box[1] + words[2].box[3];
    expect(Math.abs((top + bottom) / 2 - 105)).toBeLessThan(1);
    // the map stays under the card
    expect(made.elements[0].kind).toBe('map');
    expect(made.framing).toEqual({});
  });

  it('are offered in the Add panel', () => {
    expect(SEQUENCE_ADDS.map(([kind]) => kind)).toEqual(Object.keys(SEQUENCES));
    expect(withSequence(spec(), null, 'nothing')).toBe(null);
  });
});

describe('a duplicated step', () => {
  it('is played right after it, with copies of what stands on it and its framing', () => {
    const base = withSequence(spec(), null, 'seq-title', { map, view: map.view });
    const plate = { ...spec(), steps: base.steps, framing: { [base.step]: { map: { ...map.view, zoom: 12 } } },
      elements: base.elements.map((element) => (element.step ? { ...element, group: 'g1' } : element)) };
    const made = duplicatedStep(plate, null, base.step);
    const steps = stepsOf({ ...plate, steps: made.steps }, null);
    expect(steps.map((step) => step.id)).toEqual([base.step, made.step]);
    expect(steps[1]).toMatchObject({ name: 'Title, again', duration: 3 });
    const copies = made.elements.filter((element) => element.step === made.step);
    const originals = made.elements.filter((element) => element.step === base.step);
    expect(copies).toHaveLength(originals.length);
    expect(copies.every((element) => !originals.some((original) => original.id === element.id))).toBe(true);
    expect(new Set(copies.map((element) => element.group)).size).toBe(1);
    expect(copies[0].group).not.toBe('g1');
    expect(made.framing[made.step]).toEqual({ map: { ...map.view, zoom: 12 } });
    expect(duplicatedStep(plate, null, 'missing')).toBe(null);
  });
});
