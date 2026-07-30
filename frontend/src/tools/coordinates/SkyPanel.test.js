import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const panel = readFileSync(new URL('./SkyPanel.svelte', import.meta.url), 'utf8');
const chart = readFileSync(new URL('./DayChart.svelte', import.meta.url), 'utf8');
const rose = readFileSync(new URL('./SkyRose.svelte', import.meta.url), 'utf8');
const tool = readFileSync(new URL('../Coordinates.svelte', import.meta.url), 'utf8');

describe('Sun & moon panel', () => {
  it('reads the sky from the local backend and nothing else', () => {
    expect(panel).toContain(".get(`/api/geo/sky?${params}`)");
    // no third-party almanac, no ephemeris fetched at runtime
    expect(panel).not.toMatch(/https?:\/\//);
  });

  it('writes every instant in both civil local time and UTC', () => {
    expect(panel).toContain("stamp?.local?.slice(11, 16)");
    expect(panel).toContain("stamp?.utc?.slice(11, 16)");
    expect(panel).toContain('<span>Local</span><span>UTC</span>');
  });

  it('marks an event that falls after local midnight', () => {
    // a sunset or a dusk belongs to its own evening even past 00:00
    expect(panel).toContain("stamp.local.slice(0, 10) !== shownDay ? '+1'");
  });

  it('prints polar day, polar night and a missing moonrise as states', () => {
    expect(panel).toContain("always_up: 'Midnight sun'");
    expect(panel).toContain("always_down: 'Polar night'");
    expect(panel).toContain("always_up: 'Never that dark'");
    expect(panel).toContain("always_up: 'Up all day'");
    expect(panel).toContain('None on this date');
    // the state replaces the times; it is not an error path
    expect(panel).toContain("{#if sky.sun.state === 'rises'}");
  });

  it('treats the date and time as local wall-clock readings', () => {
    expect(panel).toContain('type="date"');
    expect(panel).toContain('type="time"');
    expect(panel).toContain('Local date at this point');
    // empty means "let the backend pick", so the point's own today is used
    expect(panel).toContain("let day = $state('')");
    expect(panel).toContain("if (day) params.set('date', day)");
  });

  it('drops a stale response when the date changes twice quickly', () => {
    expect(panel).toContain('const ticket = ++request');
    expect(panel).toContain('if (ticket !== request) return');
  });

  it('sends the map a point, a date and a time, never a computed value', () => {
    // the map opens its own Sun & moon mode and recomputes, so the two entry
    // points into that view cannot drift apart
    expect(panel).toContain('uiState.skyAt = {');
    expect(panel).toContain('date: sky.date');
    expect(panel).toContain("time: sky.moment.local.slice(11, 16)");
    expect(panel).not.toContain('azimuth: sky.sun.azimuth');
    expect(panel).toContain("uiState.tool = 'satellite'");
    expect(panel).toContain('uiState.gotoCoords = { lat: point.lat, lon: point.lon }');
  });

  it('shows the phase glyph whatever the moon is doing', () => {
    // the phase is a fact about the date, not about the moon being up right now
    expect(panel).toContain("import MoonGlyph from '../../components/MoonGlyph.svelte'");
    expect(panel).toContain('waxing={sky.moon.waxing}');
  });

  it('previews what it will answer before there is a coordinate', () => {
    // the panel must read as available, not absent, on an untouched tab
    expect(panel).toContain('const PREVIEW_ROWS = [');
    expect(panel).toContain("'Sunrise',");
    expect(panel).toContain("'Phase',");
    expect(panel).toContain('Computed here, offline, for whatever coordinate you paste.');
    expect(panel).toContain('disabled={!point}');
    // and it asks the backend for nothing until it has a point
    expect(panel).toContain('if (!point) return');
  });

  it('explains every row on hover, stating the convention used', () => {
    expect(panel).toContain('const NOTES = {');
    expect(panel).toContain("upper limb reaches the horizon, refraction included");
    expect(panel).toContain("its parallax included");
    expect(panel).toContain('Sun 6° to 12° below');
    expect(panel).toContain('title={NOTES.sunrise}');
    expect(panel).toContain('title={NOTES[name]}');
    expect(panel).toContain('title={NOTES.phase}');
    // the state rows explain the state, not the ordinary case
    expect(panel).toContain('title={NOTES.sunState}');
    expect(panel).toContain('title={NOTES.moonState}');
  });

  it('is mounted by the tool with or without a point', () => {
    expect(tool).toContain("import SkyPanel from './coordinates/SkyPanel.svelte'");
    expect(tool).toContain('<SkyPanel {point} />');
    expect(tool).toContain("{#key point ? `${point.lat},${point.lon}` : 'empty'}");
  });

  it('shares one width with the rest of the tool', () => {
    // the notations, the links, the table and the chart all span the sheet; only
    // the value column is capped, so the copy icon stays beside what it copies
    expect(tool).toContain('max-width: 1120px');
    expect(tool).toContain('grid-template-columns: 170px minmax(0, 480px) auto');
    // the paste field is the deliberate exception: a text input as wide as the
    // page is a worse target, not a better one
    expect(tool).toMatch(/\.go-form \{[^}]*max-width: 720px/s);
  });

  it('gives the table columns room for a twilight range on one line', () => {
    expect(panel).toContain('grid-template-columns: 190px 170px 150px 1fr');
    expect(panel).not.toContain('max-width: 660px');
  });
});

describe('day chart', () => {
  it('plots altitude against time on one scale, never two y axes', () => {
    expect(chart).toContain('const y = (alt) =>');
    expect(chart).toMatch(/const x = \(m\) =>/);
    // azimuth is read from the crosshair, not plotted against a second axis
    expect(chart).toContain('curve.sun_azimuth[hover.index]');
    expect(chart.match(/altitude above the horizon/g)).toHaveLength(1);
  });

  it('keeps the horizon and the twilight bands on screen at any latitude', () => {
    expect(chart).toContain('Math.min(-22');
    expect(chart).toContain('{ from: 0, to: -6');
    expect(chart).toContain('{ from: -12, to: -18');
  });

  it('identifies the two series by label as well as by colour', () => {
    expect(chart).toContain('<span class="key"><i style="background: var(--sky-sun)"></i>Sun</span>');
    expect(chart).toContain('class="series-label"');
    expect(chart).toContain('>Sun</text>');
    expect(chart).toContain('>Moon</text>');
  });

  it('labels its ticks from the payload clock, not by dividing minutes', () => {
    // 120 minutes after local midnight reads 03:00 on the spring-forward day
    expect(chart).toContain("curve?.clock?.[tick.index]");
    expect(chart).not.toContain('Math.floor(m / 60)');
  });

  it('carries a crosshair readout in whole degrees', () => {
    expect(chart).toContain('onpointermove={track}');
    expect(chart).toContain('onpointerleave={() => (hover = null)}');
    expect(chart).toContain('const round = (value) => Math.round(value)');
  });

  it('sizes its viewBox to the width it is given, so marks keep their weight', () => {
    expect(chart).toContain('const WIDTH = 1100');
    expect(chart).toContain('stroke-width="2"');
  });

  it('spans the local day it was given, not a fixed 24 hours', () => {
    expect(chart).toContain('minutes[minutes.length - 1]');
    expect(chart).not.toContain('/ 1440');
  });
});

describe('compass rosette', () => {
  it('puts the zenith at the centre and dashes a body below the horizon', () => {
    expect(rose).toContain('((90 - Math.max(0, altitude)) / 90) * R');
    expect(rose).toContain("stroke-dasharray={sun.altitude < 0 ? '3 3' : null}");
    expect(rose).toContain('{#if moon.altitude >= 0}');
  });

  it('draws the moon at its own phase, on the shared geometry', () => {
    expect(rose).toContain("import { litPath, glyphRotation } from '../../lib/moonphase.js'");
    expect(rose).toContain('litPath(MOON_RADIUS, moon.illuminated, moon.phase_angle)');
    // a view of the sky passes the real limb angle, not the table convention
    expect(rose).toContain('moon.limb_from_vertical');
  });
});
