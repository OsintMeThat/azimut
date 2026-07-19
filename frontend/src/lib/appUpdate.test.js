import { describe, it, expect } from 'vitest';
import { shouldShowUpdate } from './appUpdate.js';

describe('shouldShowUpdate', () => {
  it('shows when a newer release is available and nothing is muted', () => {
    expect(shouldShowUpdate({ update_available: true, latest: 'v0.2.0' }, '')).toBe(true);
  });

  it('stays quiet on the up-to-date check', () => {
    expect(shouldShowUpdate({ update_available: false, latest: 'v0.1.2' }, '')).toBe(false);
  });

  it('stays quiet for the exact tag the user muted', () => {
    expect(shouldShowUpdate({ update_available: true, latest: 'v0.2.0' }, 'v0.2.0')).toBe(false);
  });

  it('shows again once a newer tag than the muted one ships', () => {
    expect(shouldShowUpdate({ update_available: true, latest: 'v0.3.0' }, 'v0.2.0')).toBe(true);
  });

  it('handles a missing or failed check', () => {
    expect(shouldShowUpdate(null, '')).toBe(false);
    expect(shouldShowUpdate({ error: 'offline' }, '')).toBe(false);
    expect(shouldShowUpdate({ update_available: true, latest: null }, '')).toBe(false);
  });
});
