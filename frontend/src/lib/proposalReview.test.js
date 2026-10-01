import { describe, expect, it } from 'vitest';

import { filedWords, proposalSentence, waitingCount } from './proposalReview.js';

describe('the proposal review words', () => {
  it('counts the edges waiting, not the accounts behind them', () => {
    expect(waitingCount({ accounts: 3, posted: 5, sites: 2 })).toBe(7);
    expect(waitingCount(null)).toBe(0);
  });

  it('reads each proposal as the sentence it stands for', () => {
    expect(
      proposalSentence({ type: 'posted', from: { label: '@BashaReport' }, to: { label: 'clip.mp4' } }),
    ).toBe('@BashaReport posted clip.mp4');
    expect(
      proposalSentence({
        type: 'same-site-as', from: { label: 'Hangar' }, to: { label: 'Runway' }, metres: 110,
      }),
    ).toBe('Hangar and Runway are one site, 110 m apart');
  });

  it('says what a pass filed, or that it found nothing', () => {
    expect(filedWords({ accounts: 1, posted: 2, sites: 1 })).toBe(
      'Proposed 1 account, 2 posted links, 1 same-site link.',
    );
    expect(filedWords({ accounts: 0, posted: 0, sites: 0 })).toBe('Nothing new to propose.');
  });
});

describe('what a saved geolocation shares', () => {
  it('names the other geolocations on its site and what its account posted', async () => {
    const { kinSentence } = await import('./proposalReview.js');
    expect(
      kinSentence({
        sites: ['p1', 'p2'], places: ['a', 'b', 'c'], radius: 300,
        accounts: [{ label: '@BashaReport', files: 3 }, { label: '@quiet', files: 0 }],
      }),
    ).toBe('On the same site as 2 other geolocations · @BashaReport posted 3 other files here');
  });

  it('falls back to the points within reach when no other proof is there', async () => {
    const { kinSentence } = await import('./proposalReview.js');
    expect(kinSentence({ sites: [], places: ['a'], radius: 300, accounts: [] })).toBe(
      '1 other point of the case within 300 m',
    );
  });

  it('draws no line when it shares nothing', async () => {
    const { kinSentence } = await import('./proposalReview.js');
    expect(kinSentence({ sites: [], places: [], accounts: [{ label: '@x', files: 0 }] })).toBeNull();
    expect(kinSentence(null)).toBeNull();
  });
});
