import { describe, expect, it } from 'vitest';
import { filingName, planProofHandoff } from './handoff.js';

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
