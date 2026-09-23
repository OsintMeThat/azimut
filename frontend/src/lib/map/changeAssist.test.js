import { describe, expect, it } from 'vitest';
import { CHANGE_DEFAULTS, changeCompatibility, changeNeedsFrames, changeSettings } from './changeAssist.js';

const side = (patch = {}) => ({
  present: true,
  provider: 'esri-wayback',
  overlays: [],
  sentinel: { layer: 'TRUE_COLOR', date: '', effectiveDate: '', maxcc: 100 },
  waybackRelease: 1,
  nightlights: { source: 'noaa20', day: '2026-09-01' },
  ...patch,
});

const sentinel = (date, patch = {}) =>
  side({
    provider: 'sentinel2',
    sentinel: { layer: 'TRUE_COLOR', effectiveDate: date, maxcc: 40, ...patch },
  });

describe('which pairs Difference reads', () => {
  it('reads two Wayback releases as matched when unrelated layers agree', () => {
    expect(changeCompatibility(side(), side({ waybackRelease: 2 }))).toMatchObject({
      ok: true,
      grade: 'matched',
      family: 'esri',
      // A picture carries no scene classification, so there is no honest cloud
      // filter over it and the switch is not offered.
      clouds: false,
      methods: ['colour', 'structure', 'brightness'],
    });
    expect(
      changeCompatibility(side({ overlays: ['roads'] }), side({ waybackRelease: 2 }))
    ).toMatchObject({ ok: false, reason: expect.stringContaining('layers') });
    expect(changeCompatibility(side(), side())).toMatchObject({ ok: false });
  });

  it('reads World Imagery against a Wayback release as indicative, with the reason', () => {
    const answer = changeCompatibility(side({ provider: 'esri-world-imagery' }), side());
    expect(answer).toMatchObject({ ok: true, grade: 'indicative' });
    expect(answer.notes.join(' ')).toContain('live mosaic');
  });

  it('reads dated Sentinel-2 passes, and offers indices even across layers', () => {
    expect(changeCompatibility(sentinel('2026-08-01'), sentinel('2026-09-01'))).toMatchObject({
      ok: true,
      grade: 'matched',
      family: 'sentinel2',
      clouds: true,
      methods: ['colour', 'structure', 'brightness', 'index'],
    });
    const acrossLayers = changeCompatibility(
      sentinel('2026-08-01'),
      sentinel('2026-09-01', { layer: 'SWIR', maxcc: 10 })
    );
    expect(acrossLayers).toMatchObject({ ok: true, grade: 'indicative', methods: ['index'] });
    expect(acrossLayers.notes).toHaveLength(2);
    expect(changeCompatibility(sentinel('2026-08-01'), sentinel('2026-08-01'))).toMatchObject({
      ok: false,
    });
  });

  it('refuses cross-provider pixels, widgets and mismatched VIIRS products', () => {
    expect(changeCompatibility(side(), side({ provider: 'osm' }))).toMatchObject({ ok: false });
    expect(changeCompatibility(side({ widget: true }), side({ waybackRelease: 2 }))).toMatchObject({
      ok: false,
      reason: expect.stringContaining('widget'),
    });
    expect(
      changeCompatibility(
        side({ provider: 'osm', overlays: ['nightlights'] }),
        side({ provider: 'osm', overlays: ['nightlights'], nightlights: { source: 'snpp', day: '2026-09-02' } })
      )
    ).toMatchObject({ ok: false, reason: expect.stringContaining('same VIIRS') });
  });

  it('reads two nights of one sensor with brightness first', () => {
    const night = (day) =>
      side({ provider: 'osm', overlays: ['nightlights'], nightlights: { source: 'noaa20', day } });
    expect(changeCompatibility(night('2026-01-01'), night('2026-02-01'))).toMatchObject({
      ok: true,
      methods: ['brightness', 'colour'],
    });
  });
});

describe('what a reading has to fetch', () => {
  const status = (clouds) => ({ ok: true, clouds, methods: [] });

  it('asks for bands for an index, and for the sky when the cloud filter is on', () => {
    expect(changeNeedsFrames(changeSettings({ method: 'index' }), status(true))).toBe('index');
    expect(changeNeedsFrames(changeSettings({ ignore_clouds: true }), status(true))).toBe('sky');
    expect(changeNeedsFrames(changeSettings({ ignore_shadows: true }), status(true))).toBe('sky');
  });

  it('asks for nothing where a picture is all there is, so the reading stays live', () => {
    expect(changeNeedsFrames(changeSettings({}), status(true))).toBe('');
    expect(changeNeedsFrames(changeSettings({ ignore_clouds: true }), status(false))).toBe('');
  });
});

describe('Difference settings', () => {
  it('fills a missing or older session with the defaults', () => {
    expect(changeSettings({})).toEqual({ ...CHANGE_DEFAULTS, classes: ['gain', 'loss', 'changed'] });
    expect(changeSettings({ normalize: true, noise: 3 })).toMatchObject({ normalize: 'auto' });
    // a session that chose histogram keeps it; only the default moved
    expect(changeSettings({ normalize: 'histogram' })).toMatchObject({ normalize: 'histogram' });
  });

  it('keeps every value inside its range', () => {
    expect(
      changeSettings({
        method: 'ratio',
        sensitivity: 400,
        smoothing: -2,
        alignment: 8.6,
        min_area: -5,
        classes: ['loss', 'nope', 'loss'],
        opacity: '35',
        base: 'c',
      })
    ).toMatchObject({
      method: 'colour',
      sensitivity: 100,
      smoothing: 0,
      alignment: 8,
      min_area: 0,
      classes: ['loss'],
      opacity: 35,
      base: 'both',
    });
  });

  it('lays the highlights over both images unless told otherwise', () => {
    expect(changeSettings().base).toBe('both');
    // "side" was the name Both had when it was a layout of its own
    expect(changeSettings({ base: 'side' }).base).toBe('both');
    expect(changeSettings({ base: 'a' }).base).toBe('a');
  });
});

describe('a radar pair', () => {
  const radar = (date, time) => side({ provider: 'sentinel1', radar: { date, time } });

  it('reads two passes of one track, as a picture and without tone matching', () => {
    const status = changeCompatibility(radar('2026-05-02', '05:42:10'), radar('2026-05-14', '05:42:40'));
    expect(status).toMatchObject({ ok: true, family: 'sentinel1', grade: 'indicative', clouds: false });
    expect(status.methods).toEqual(['colour', 'structure', 'brightness']);
  });

  it('refuses another track, the same pass, or an undated side', () => {
    expect(changeCompatibility(radar('2026-05-02', '05:42:10'), radar('2026-05-14', '17:33:02')).reason)
      .toMatch(/one track/);
    expect(changeCompatibility(radar('2026-05-14', '05:42:10'), radar('2026-05-14', '05:42:10')).reason)
      .toMatch(/two different/);
    expect(changeCompatibility(radar('', ''), radar('2026-05-14', '05:42:10')).ok).toBe(false);
  });
});
