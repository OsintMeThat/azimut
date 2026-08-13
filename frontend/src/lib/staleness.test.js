import { describe, it, expect } from 'vitest';
import { updateBadges, carryLatest } from './staleness.js';

const scraper = (dist, extra = {}) => ({ dist, version: '1.0', ...extra });

describe('updateBadges', () => {
  it('lights nothing when everything is current and installed', () => {
    const badges = updateBadges({
      app: { update_available: false },
      scrapers: [scraper('yt-dlp', { latest: '1.0', outdated: false })],
      extensionInstalled: '0.2.5',
      extensionBundled: '0.2.5',
    });
    expect(badges.any).toBe(false);
    expect(badges.tabs).toEqual({ system: false, extension: false });
  });

  it('lights nothing before the checks have run', () => {
    expect(updateBadges(null).any).toBe(false);
    expect(updateBadges({}).any).toBe(false);
  });

  it('files the app and the downloaders under System', () => {
    const app = updateBadges({ app: { update_available: true, latest: 'v9.9.9' } });
    expect(app.tabs.system).toBe(true);
    expect(app.tabs.extension).toBe(false);

    const stale = updateBadges({
      scrapers: [scraper('yt-dlp', { outdated: true }), scraper('gallery-dl', { outdated: false })],
    });
    expect(stale.scrapers).toEqual(['yt-dlp']);
    expect(stale.tabs.system).toBe(true);
  });

  it('files the extension under its own tab', () => {
    const badges = updateBadges({ extensionInstalled: '0.2.1', extensionBundled: '0.2.5' });
    expect(badges.extension).toBe(true);
    expect(badges.tabs).toEqual({ system: false, extension: true });
    expect(badges.any).toBe(true);
  });

  it('marks an extension that was never installed', () => {
    const badges = updateBadges({ extensionInstalled: null, extensionBundled: '0.2.5' });
    expect(badges.extension).toBe(true);
    expect(badges.extensionMissing).toBe(true);
    // The button says "Download extension", not "Download update".
    expect(badges.extensionOutdated).toBe(false);
  });

  it('says nothing about an extension this build does not ship', () => {
    const badges = updateBadges({ extensionInstalled: null, extensionBundled: '' });
    expect(badges.extension).toBe(false);
    expect(badges.any).toBe(false);
  });

  it('stays quiet when the bundled extension is older than the installed one', () => {
    // The version tracks the release that last changed the extension, so a
    // build can legitimately ship one older than what the browser already runs.
    const badges = updateBadges({ extensionInstalled: '0.2.7', extensionBundled: '0.2.5' });
    expect(badges.extension).toBe(false);
  });

  it('honours the release the user muted', () => {
    const check = { update_available: true, latest: 'v9.9.9' };
    expect(updateBadges({ app: check }, 'v9.9.9').app).toBe(false);
    expect(updateBadges({ app: check }, 'v9.9.8').app).toBe(true);
  });
});

describe('carryLatest', () => {
  const checked = [
    { dist: 'yt-dlp', version: '2026.1.1', latest: '2026.7.1', outdated: true },
    { dist: 'gallery-dl', version: '1.29', latest: '1.30', outdated: true },
  ];

  it('clears the verdict for what was just updated and keeps the rest', () => {
    const local = [
      { dist: 'yt-dlp', version: '2026.7.1' }, // just updated
      { dist: 'gallery-dl', version: '1.29' }, // untouched
    ];
    const carried = carryLatest(local, checked);
    expect(carried[0].outdated).toBe(false);
    expect(carried[1].outdated).toBe(true);
    expect(carried[1].latest).toBe('1.30');
  });

  it('brings the verdict back when a revert drops below PyPI', () => {
    const reverted = carryLatest([{ dist: 'yt-dlp', version: '2025.1.1' }], checked);
    expect(reverted[0].outdated).toBe(true);
  });

  it('leaves entries alone when nothing was ever checked', () => {
    const local = [{ dist: 'yt-dlp', version: '2026.1.1' }];
    expect(carryLatest(local, null)).toEqual(local);
    expect(carryLatest(local, [])).toEqual(local);
  });

  it('says nothing about a downloader that is not installed', () => {
    const [entry] = carryLatest([{ dist: 'yt-dlp', version: null }], checked);
    expect(entry.outdated).toBe(false);
  });
});
