import { describe, expect, it } from 'vitest';
import { filingName, planProofHandoff, proofPosts } from './handoff.js';

describe('planProofHandoff', () => {
  it('files the thread on screen before a different proof takes the composer', () => {
    expect(planProofHandoff({
      incomingPng: 'proofs/second.png',
      currentPng: 'proofs/first.png',
      hasContent: true,
    })).toBe('file-then-apply');
  });

  it('stays in the same thread when the proof it already carries comes back', () => {
    expect(planProofHandoff({
      incomingPng: 'proofs/first.png',
      currentPng: 'proofs/first.png',
      hasContent: true,
    })).toBe('apply');
  });

  it('loads straight into an empty composer', () => {
    expect(planProofHandoff({
      incomingPng: 'proofs/first.png',
      currentPng: null,
      hasContent: false,
    })).toBe('apply');
  });

  it('treats a proof handed over without an image as a new thread', () => {
    expect(planProofHandoff({ incomingPng: null, currentPng: null, hasContent: true }))
      .toBe('file-then-apply');
  });

  it('starts a new thread when the one on screen carries the proof and went out', () => {
    for (const standing of ['posted', 'changed']) {
      expect(planProofHandoff({ incomingPng: 'proofs/first.png', currentPng: 'proofs/first.png', hasContent: true, standing }))
        .toBe('file-then-apply');
    }
  });
});

describe('proofPosts', () => {
  const row = (name, extra = {}) => ({ name, title: name, proof: 'proofs/depot.png', state: 'draft', updated_at: '2026-11-10T08:00:00Z', ...extra });

  it('finds the latest post of the proof still a draft', () => {
    const drafts = [
      row('Older', { updated_at: '2026-11-01T08:00:00Z' }),
      row('Other proof', { proof: 'proofs/bridge.png', updated_at: '2026-11-11T08:00:00Z' }),
      row('Newer', { updated_at: '2026-11-09T08:00:00Z' }),
      row('Out', { state: 'posted', updated_at: '2026-11-11T09:00:00Z' }),
    ];
    expect(proofPosts(drafts, 'proofs/depot.png')).toEqual({ open: drafts[2], posted: true });
  });

  it('opens none when every post of it went out, or it has none', () => {
    const drafts = [row('Out', { state: 'posted' }), row('Edited', { state: 'changed' })];
    expect(proofPosts(drafts, 'proofs/depot.png')).toEqual({ open: null, posted: true });
    expect(proofPosts(drafts, 'proofs/bridge.png')).toEqual({ open: null, posted: false });
    expect(proofPosts(null, 'proofs/depot.png')).toEqual({ open: null, posted: false });
    expect(proofPosts(drafts, null)).toEqual({ open: null, posted: false });
  });

  it('leaves the post on screen out, and reads a row that says no state as a draft', () => {
    const drafts = [row('On screen'), row('Saved before', { state: undefined, updated_at: '2026-11-01T08:00:00Z' })];
    expect(proofPosts(drafts, 'proofs/depot.png', { except: 'On screen' }).open.name).toBe('Saved before');
  });
});

describe('filingName', () => {
  const takenSlugs = new Set(['Post 1']);

  it('keeps the name a bound draft is saved under', () => {
    expect(filingName({
      title: 'Post 1', bound: true, takenSlugs, slug: 'Post 1', fresh: 'Post 2',
    })).toBe('Post 1');
  });

  it('moves an unbound draft off a name another draft holds', () => {
    expect(filingName({
      title: 'Post 1', bound: false, takenSlugs, slug: 'Post 1', fresh: 'Post 2',
    })).toBe('Post 2');
  });

  it('leaves a free name alone', () => {
    expect(filingName({
      title: 'Rooftop shot', bound: false, takenSlugs, slug: 'Rooftop shot', fresh: 'Post 2',
    })).toBe('Rooftop shot');
  });
});
