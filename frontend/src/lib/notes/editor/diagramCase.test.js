import { describe, expect, it, vi } from 'vitest';
import {
  ACROSS, boxIdOf, caseEvents, eventDay, graphReading, graphViews, networkModel, shapeOfType, throughPairs, timelineModel, viewQuery,
} from './diagramCase.js';
import { readDiagram, writeDiagram } from './diagramText.js';

/**
 * A diagram from the case: a network from what the Graph draws, a timeline from the
 * Timeline's dated events. Only what the case says, each link in its own words.
 */

const node = (id, type, label, extra = {}) => ({ id, type, label, family: type === 'account' ? 'identifier' : type, degree: 1, ...extra });
const link = (from, to, type, extra = {}) => ({ id: `${from}-${to}`, from, to, type, ...extra });

/** Two accounts, the videos they posted, a proof made of them, the place it shows. */
const READING = {
  nodes: [
    node('e_acc1', 'account', '@first'), node('e_acc2', 'account', '@second'), node('e_vid1', 'media', 'Video 1'), node('e_vid2', 'media', 'Video 2'),
    node('e_proof', 'proof', 'Proof 3'), node('e_place', 'place', 'Gate', { caption: 'Camp gate' }), node('e_claim', 'claim', 'Taken on the 5th'),
  ],
  links: [
    link('e_acc1', 'e_vid1', 'posted'), link('e_acc2', 'e_vid2', 'posted'),
    link('e_proof', 'e_vid1', 'derived-from'), link('e_proof', 'e_vid2', 'derived-from'),
    link('e_proof', 'e_place', 'depicts'), link('e_claim', 'e_proof', 'cites', { folded: { sources: 3 } }),
    link('e_claim', 'e_proof', 'about'),
  ],
  total: 7,
  truncated: false,
};
const LABELS = { account: 'Account', media: 'Media', proof: 'Proof', place: 'Place', claim: 'Claim' };
const words = { label: (type) => LABELS[type], verb: (type) => type.replace('-', ' ') };

describe('a network from the Graph', () => {
  it('makes a box of each entity picked, shaped and coloured by its type, its id one Mermaid reads', () => {
    const model = networkModel(READING, ['e_acc1', 'e_place', 'e_proof'], { ...words, through: false });
    expect(model.kind).toBe('network');
    expect(model.boxes).toEqual([
      { id: 'e_acc1', text: '@first', shape: 'person', category: 'Account', parent: '' },
      { id: 'e_proof', text: 'Proof 3', shape: 'box', category: 'Proof', parent: '' },
      { id: 'e_place', text: 'Camp gate', shape: 'round', category: 'Place', parent: '' },
    ]);
    expect(model.links).toEqual([{ from: 'e_proof', to: 'e_place', text: 'depicts', dashed: false, arrow: true }]);
    expect(shapeOfType('organisation')).toBe('person');
    expect(boxIdOf('9-a.b')).toBe('e_9_a_b');
  });

  it('writes a pair’s two links in one, and what a folded link stands for', () => {
    const model = networkModel(READING, ['e_claim', 'e_proof'], { ...words, through: false });
    expect(model.links).toEqual([{ from: 'e_claim', to: 'e_proof', text: 'cites (3 sources), about', dashed: false, arrow: true }]);
  });

  it('joins what is linked only through what was left out, dashed, saying what it passes through', () => {
    const model = networkModel(READING, ['e_acc1', 'e_acc2', 'e_place'], words);
    expect(model.links).toEqual([
      { from: 'e_acc1', to: 'e_place', text: 'via 1 media → 1 proof', dashed: true, arrow: false },
      { from: 'e_acc2', to: 'e_place', text: 'via 1 media → 1 proof', dashed: true, arrow: false },
    ]);
    // two accounts are three entities apart: past the two a link passes through
    expect(throughPairs(READING, ['e_acc1', 'e_acc2'])).toEqual([]);
    const proofs = networkModel(READING, ['e_acc1', 'e_acc2', 'e_proof'], words);
    expect(proofs.links.map((one) => one.text)).toEqual(['via 1 media', 'via 1 media']);
    expect(networkModel(READING, ['e_acc1', 'e_place'], { ...words, through: false }).links).toEqual([]);
  });

  it('counts each kind of entity a link passes through', () => {
    const reading = {
      nodes: [node('e_a', 'account', 'A'), node('e_b', 'place', 'B'), node('e_m1', 'media', 'M1'), node('e_m2', 'media', 'M2'), node('e_c', 'capture', 'C')],
      links: [link('e_a', 'e_m1', 'posted'), link('e_m1', 'e_b', 'depicts'), link('e_a', 'e_m2', 'posted'), link('e_m2', 'e_b', 'depicts'), link('e_c', 'e_b', 'depicts'), link('e_a', 'e_c', 'posted')],
    };
    const label = (type) => ({ media: 'Media', capture: 'Capture' })[type];
    expect(networkModel(reading, ['e_a', 'e_b'], { label }).links[0].text).toBe('via 2 media and 1 capture');
  });

  it('writes a network Mermaid reads back, coloured by type', () => {
    const model = networkModel(READING, ['e_acc1', 'e_acc2', 'e_proof', 'e_place'], words);
    const back = readDiagram(writeDiagram(model));
    expect(back.boxes.map((one) => one.category)).toEqual(['Account', 'Account', 'Proof', 'Place']);
    expect(Object.keys(back.colours)).toEqual(['Account', 'Proof', 'Place']);
  });

  it('reads the whole case as the Graph opens on it, or what a saved view draws, its hidden families left out', async () => {
    const ask = vi.fn(async () => ({ nodes: READING.nodes, links: READING.links, total: 9, truncated: true }));
    const whole = await graphReading({ caseId: 'c 1', ask });
    expect(ask).toHaveBeenLastCalledWith('/api/cases/c%201/graph?lens=all&limit=200');
    expect(whole).toMatchObject({ total: 9, truncated: true });
    const view = { id: 'v1', mode: 'live', spec: { query: { terms: { type: 'account,proof', q: '' } }, graph: { lens: 'subjects', order: 'recent', kept: ['e_place'], families: ['claim'] } } };
    const viewed = await graphReading({ caseId: 'c1', view, ask });
    expect(ask).toHaveBeenLastCalledWith('/api/cases/c1/graph?lens=subjects&limit=200&order=recent&type=account%2Cproof&keep=e_place');
    expect(viewed.nodes.map((one) => one.id)).not.toContain('e_claim');
    expect(viewed.links.some((one) => one.from === 'e_claim')).toBe(false);
    expect(viewQuery({ id: 'v2', mode: 'snapshot', spec: { graph: { lens: 'ground' } } })).toEqual({ lens: 'ground', limit: '200', view: 'v2' });
  });

  it('lists the case’s saved Graph views only', async () => {
    const ask = vi.fn(async () => ({ views: [{ id: 'b', name: 'Board one', surface: 'board' }, { id: 'g2', name: 'Zeta', surface: 'graph' }, { id: 'g1', name: 'Alpha', surface: 'graph' }] }));
    expect((await graphViews({ caseId: 'c1', ask })).map((one) => one.id)).toEqual(['g1', 'g2']);
  });
});

describe('a timeline from the Timeline', () => {
  it('says each day as the case states it', () => {
    expect(eventDay('2026-10-18')).toBe('18 Oct 2026');
    expect(eventDay('2026-10-18~')).toBe('about 18 Oct 2026');
    expect(eventDay('2026-11-10~/2026-11-14')).toBe('about 10 Nov 2026 – 14 Nov 2026');
    expect(eventDay('2026-11')).toBe('Nov 2026');
    expect(eventDay('2026')).toBe('2026');
    expect(eventDay('2026-10-18T14:30')).toBe('18 Oct 2026, 14:30');
    expect(eventDay('2026-10-18?')).toBe('18 Oct 2026?');
    expect(eventDay('2026-10-18/..')).toBe('18 Oct 2026 – …');
    expect(eventDay('early October')).toBe('early October');
    expect(eventDay('')).toBe('');
  });

  it('reads the dated events of a period, and says when the case holds more than it read', async () => {
    const ask = vi.fn(async () => ({
      items: [
        { id: 't1', raw: '2026-10-18~', earliest: '2026-10-17T21:00:00Z', label: 'Material of Proof 14 was taken', owner_type: 'claim' },
        { id: 't2', raw: null, earliest: null, label: 'Undated' },
        { id: 't3', raw: '2026-11-15', earliest: '2026-11-14T21:00:00Z', label: 'Proof 1', owner_type: 'proof' },
      ],
      total: 250,
      next_cursor: 'x',
      extent: { from: '2026-10-17T21:00:00Z', to: '2026-11-15T21:00:00Z' },
    }));
    const answer = await caseEvents({ caseId: 'c1', from: '2026-10-01', to: '2026-11-30', ask });
    expect(ask).toHaveBeenCalledWith('/api/cases/c1/timeline?category=statement&include_undated=false&limit=200&from=2026-10-01&to=2026-11-30');
    expect(answer.events).toEqual([
      { id: 't1', day: 'about 18 Oct 2026', text: 'Material of Proof 14 was taken', type: 'claim' },
      { id: 't3', day: '15 Nov 2026', text: 'Proof 1', type: 'proof' },
    ]);
    expect(answer).toMatchObject({ total: 250, more: true, extent: { from: '2026-10-17', to: '2026-11-15' } });
  });

  it('makes a timeline of the events picked, in the case’s order, top down past a few', () => {
    const events = Array.from({ length: ACROSS + 1 }, (_, at) => ({ id: `t${at}`, day: `${at + 1} Oct 2026`, text: `Event ${at}` }));
    const few = timelineModel(events, ['t2', 't0']);
    expect(few.events).toEqual([
      { id: 'n1', when: '1 Oct 2026', text: 'Event 0', category: '' },
      { id: 'n2', when: '3 Oct 2026', text: 'Event 2', category: '' },
    ]);
    expect(few.direction).toBe('LR');
    expect(timelineModel(events, events.map((one) => one.id)).direction).toBe('TD');
    expect(readDiagram(writeDiagram(few)).events.map((one) => one.when)).toEqual(['1 Oct 2026', '3 Oct 2026']);
  });
});
