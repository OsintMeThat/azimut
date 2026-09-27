/**
 * Saved readings from a 0.3.1 case open the way they were saved.
 *
 * `tests/fixtures/case-workspace-0.3.1.json` is the reading of a case built the way
 * a 0.3.1 analyst leaves one (`tests/caseworkspace.py`), and its `views` are the
 * specs the server stores and serves back. The Timeline, Board and Graph each turn
 * a spec into what they draw; whatever those surfaces come to open on by default,
 * a saved reading keeps its own tracks, pins, hides, mode, clock and question.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { timelineViewState } from './timelineTracks.js';
import { normalizeFilter } from './entityFilter.js';
import { normalizeAnalysisPeriod } from './analysisPeriod.js';

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(
  readFileSync(join(here, '../../../tests/fixtures/case-workspace-0.3.1.json'), 'utf8')
);
const views = Object.entries(fixture.views);
const timelines = views.filter(([, view]) => view.surface === 'timeline');
const questions = views.filter(([, view]) => view.surface !== 'timeline');

describe('a 0.3.1 case workspace', () => {
  it('holds every surface in both modes, so a reading of nothing cannot pass', () => {
    const kinds = new Set(views.map(([, view]) => `${view.surface}:${view.mode}`));
    for (const surface of ['board', 'graph', 'timeline']) {
      expect(kinds.has(`${surface}:live`)).toBe(true);
      expect(kinds.has(`${surface}:snapshot`)).toBe(true);
    }
    expect(new Set(timelines.map(([, view]) => view.spec.timeline.view_mode)))
      .toEqual(new Set(['plot', 'list']));
  });

  it.each(timelines)('reopens the Timeline view "%s" with its own tracks', (name, view) => {
    const saved = view.spec.timeline;
    const state = timelineViewState(saved);
    expect(state.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      categories: track.categories,
      color: track.color,
      collapsed: track.collapsed,
      hidden: track.hidden,
      pinned: track.pinned,
      relation: track.query.relation,
      terms: track.query.terms,
    }))).toEqual(saved.tracks.map((track) => ({
      id: track.id,
      label: track.label,
      categories: track.categories,
      color: track.color,
      collapsed: track.collapsed,
      hidden: track.hidden,
      pinned: track.pinned,
      relation: track.query.relation,
      terms: track.query.terms,
    })));
    expect(state.viewMode).toBe(saved.view_mode);
    expect(state.zoneChoice).toBe(saved.zone_choice);
    expect(state.groupBy).toBe(saved.group_by);
    expect([state.from, state.to]).toEqual([saved.from, saved.to]);
  });

  it('keeps a Media track wherever a saved view had one', () => {
    const withMedia = timelines.filter(([, view]) =>
      view.spec.timeline.tracks.some((track) => track.categories.includes('media')));
    expect(withMedia.length).toBeGreaterThan(0);
    for (const [, view] of withMedia) {
      expect(timelineViewState(view.spec.timeline).categories).toContain('media');
    }
  });

  it.each(questions)('reopens the %s question as it was asked', (name, view) => {
    const filter = normalizeFilter(view.spec.query.filter);
    expect(normalizeFilter(filter)).toEqual(filter);
    for (const [key, value] of Object.entries(view.spec.query.filter)) {
      expect(filter[key]).toEqual(value);
    }
    expect(normalizeAnalysisPeriod(view.spec.timeline)).toEqual(
      normalizeAnalysisPeriod(normalizeAnalysisPeriod(view.spec.timeline))
    );
  });
});
