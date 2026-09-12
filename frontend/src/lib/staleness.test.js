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

describe('updateBadges: the extension verdict', () => {
  // Once the bridge probes answer, the digest is what decides. The version
  // cannot: a release that leaves the extension alone keeps its version, and
  // within a development cycle the bundled version is already the app's own.
  const verdict = (over = {}) => ({
    status: 'owned',
    installed: { version: '0.3.0', extensionId: 'ext-a', loaded: { payload: 'old' } },
    detectedVersion: '0.3.0',
    updateAvailable: false,
    ...over,
  });

  it('lights the dot on a digest that moved, with both versions identical', () => {
    const badges = updateBadges({
      extensionInstalled: '0.3.0',
      extensionBundled: '0.3.0',
      extension: verdict({ updateAvailable: true }),
    });
    expect(badges.extension).toBe(true);
    expect(badges.extensionOutdated).toBe(true);
    expect(badges.tabs.extension).toBe(true);
    expect(badges.any).toBe(true);
  });

  it('clears the dot when the running copy carries what the app ships', () => {
    const badges = updateBadges({
      extensionInstalled: '0.3.0',
      extensionBundled: '0.3.0',
      extension: verdict(),
    });
    expect(badges.extension).toBe(false);
  });

  it('reads the verdict, not the marker, once it has one', () => {
    // The <html> marker is written by whichever bridge ran last and cannot tell
    // one copy from another, so a stale version there must not override a
    // verdict that says the loaded copy is current.
    const badges = updateBadges({
      extensionInstalled: '0.2.1',
      extensionBundled: '0.3.0',
      extension: verdict(),
    });
    expect(badges.extension).toBe(false);
  });

  it('marks nothing installed from the verdict too', () => {
    const badges = updateBadges({
      extensionBundled: '0.3.0',
      extension: { status: 'absent', installed: null, detectedVersion: null, updateAvailable: false },
    });
    expect(badges.extensionMissing).toBe(true);
    expect(badges.extensionOutdated).toBe(false);
  });

  it('falls back to versions for a copy the app does not own', () => {
    // No stamp to compare, and no button that could act on the digest anyway:
    // the app can only rewrite its own folder.
    const behind = updateBadges({
      extensionBundled: '0.3.0',
      extension: { status: 'foreign', installed: null, detectedVersion: '0.2.1', updateAvailable: false },
    });
    expect(behind.extensionOutdated).toBe(true);
    const current = updateBadges({
      extensionBundled: '0.3.0',
      extension: { status: 'foreign', installed: null, detectedVersion: '0.3.0', updateAvailable: false },
    });
    expect(current.extensionOutdated).toBe(false);
    expect(current.extensionMissing).toBe(false);
  });

  it('says a signed copy is behind without waiting for the browser to notice', () => {
    // Firefox owns the update and polls once a day. The app cannot act, but it
    // ships the extension and so knows the version offline — which is the whole
    // reason to answer here rather than fetch the update manifest ourselves.
    const behind = updateBadges({
      extensionBundled: '0.4.0',
      extension: { status: 'signed', installed: null, detectedVersion: '0.3.0', updateAvailable: false },
    });
    expect(behind.extensionOutdated).toBe(true);
    expect(behind.extensionMissing).toBe(false);
    const current = updateBadges({
      extensionBundled: '0.3.0',
      extension: { status: 'signed', installed: null, detectedVersion: '0.3.0', updateAvailable: false },
    });
    expect(current.extensionOutdated).toBe(false);
  });

  it('keeps the version comparison while the probes have not answered', () => {
    const badges = updateBadges({ extensionInstalled: '0.2.1', extensionBundled: '0.3.0' });
    expect(badges.extension).toBe(true);
  });
});
