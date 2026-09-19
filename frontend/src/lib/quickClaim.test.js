import { describe, expect, it } from 'vitest';
import { claimActionTitle, composeClaimStatement, quickClaimBody, quickClaimSeat } from './quickClaim.js';

// What the relation registry answers for a Claim's three connectors, per type,
// as `engine/links.py` declares them.
const ACCEPTS = {
  'equipment-type': ['about'],
  vehicle: ['about'],
  person: ['about'],
  account: ['about'],
  place: ['about', 'at'],
  media: ['about', 'cites'],
  proof: ['cites'],
  claim: ['cites'],
  post: [],
};
const seatOf = (type, family) => quickClaimSeat(family, (verb) => ACCEPTS[type].includes(verb));

describe('quickClaimSeat', () => {
  it('puts a model on what the claim is about, and asks how many and in what state', () => {
    expect(seatOf('equipment-type', 'class')).toEqual({ slot: 'about', count: true, condition: true });
  });

  it('asks a named object for its state, never for a count', () => {
    expect(seatOf('vehicle', 'asset')).toEqual({ slot: 'about', count: false, condition: true });
  });

  it('asks a person or an account for neither', () => {
    expect(seatOf('person', 'actor')).toEqual({ slot: 'about', count: false, condition: false });
    expect(seatOf('account', 'identifier')).toEqual({ slot: 'about', count: false, condition: false });
  });

  it('seats a place where the thing was seen, not as what it is about', () => {
    expect(seatOf('place', 'place').slot).toBe('at');
  });

  it('seats material as the evidence, not as the subject', () => {
    expect(seatOf('media', 'collected').slot).toBe('cites');
    expect(seatOf('proof', 'document').slot).toBe('cites');
    expect(seatOf('claim', 'claim').slot).toBe('cites');
  });

  it('gives no seat where the vocabulary has none', () => {
    expect(seatOf('post', 'document')).toBeNull();
  });
});

describe('composeClaimStatement', () => {
  it('reads the filed observation as one sentence', () => {
    expect(
      composeClaimStatement({ count: 2, condition: 'Destroyed', subjects: ['T-72B3'], places: ['Crossroads'] })
    ).toBe('2 × T-72B3 destroyed at Crossroads');
  });

  it('says seen when no state was given, and leaves out what was not counted', () => {
    expect(composeClaimStatement({ subjects: ['T-72B3'] })).toBe('T-72B3 seen');
    expect(composeClaimStatement({ count: 3, subjects: ['T-72B3'] })).toBe('3 × T-72B3 seen');
    expect(composeClaimStatement({ count: 0, subjects: ['T-72B3'] })).toBe('T-72B3 seen');
    expect(composeClaimStatement({ condition: 'damaged', subjects: ['Bridge 4'] })).toBe('Bridge 4 damaged');
  });

  it('starts from the place when that is all there is', () => {
    expect(composeClaimStatement({ places: ['Crossroads'] })).toBe('Seen at Crossroads');
  });

  it('names several of each', () => {
    expect(composeClaimStatement({ subjects: ['A', 'B'], places: ['X', ' '] })).toBe('A, B seen at X');
  });

  it('offers nothing with nothing to say', () => {
    expect(composeClaimStatement({})).toBe('');
    expect(composeClaimStatement({ count: 2, condition: 'destroyed' })).toBe('');
  });
});

describe('quickClaimBody', () => {
  const seat = { slot: 'about', count: true, condition: true };

  it('files the observation in the shape the claim route takes', () => {
    expect(
      quickClaimBody({
        statement: ' 2 × T-72B3 destroyed at Crossroads ',
        when: '2026-08~',
        confidence: 'probable',
        count: '2',
        condition: 'destroyed',
        about: ['model', 'model'],
        at: ['crossroads'],
        cites: ['video'],
        seat,
      })
    ).toEqual({
      statement: '2 × T-72B3 destroyed at Crossroads',
      when: '2026-08~',
      time_role: 'observed',
      confidence: 'probable',
      count: 2,
      condition: 'destroyed',
      about: ['model'],
      at: ['crossroads'],
      cites: ['video'],
    });
  });

  it('states no role without a date, and no count that is not a whole number', () => {
    const body = quickClaimBody({ statement: 'x', count: '1.5', about: [], at: [], cites: [], seat });
    expect(body.when).toBeNull();
    expect(body.time_role).toBeNull();
    expect(body.count).toBeNull();
    expect(body.condition).toBeNull();
    expect(body.confidence).toBeNull();
  });

  it('sends no count or condition the form did not ask for', () => {
    const body = quickClaimBody({
      statement: 'Ivan seen',
      count: 4,
      condition: 'destroyed',
      about: ['ivan'],
      at: [],
      cites: [],
      seat: { slot: 'about', count: false, condition: false },
    });
    expect(body.count).toBeNull();
    expect(body.condition).toBeNull();
  });
});

describe('claimActionTitle', () => {
  it('says what the press files from each seat', () => {
    expect(claimActionTitle('about')).toBe('File a claim about this');
    expect(claimActionTitle('at')).toBe('File a claim placed here');
    expect(claimActionTitle('cites')).toBe('File a claim that rests on this');
    expect(claimActionTitle(null)).toBe('');
  });
});
