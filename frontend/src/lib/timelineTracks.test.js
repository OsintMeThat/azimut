import { describe, expect, it } from 'vitest';
import {
  TRACK_COLORS,
  copyTimelineTrack,
  defaultTimelineTracks,
  groupedTimelineTracks,
  moveTimelineTrack,
  normalizeTimelineTracks,
  timelineTrack,
  timelineViewState,
  trackPresets,
  trackTint,
} from './timelineTracks.js';

describe('Timeline tracks', () => {
  it('starts with editable event and media tracks', () => {
    expect(defaultTimelineTracks().map((track) => [track.label, track.categories])).toEqual([
      ['Events', ['statement']], ['Media', ['media']],
    ]);
  });

  it('builds presets from registry labels rather than a second type vocabulary', () => {
    const presets = trackPresets([{ type: 'person', label: 'Human' }, { type: 'place', label: 'Location' }]);
    expect(presets.map((preset) => preset.label)).toEqual([
      'Events', 'Human', 'Location', 'Media', 'Sources', 'Case activity',
    ]);
    expect(presets[1].query.terms).toEqual({ type: 'person' });
  });

  it('normalizes imported state and keeps track ids unique', () => {
    const tracks = normalizeTimelineTracks([
      { id: 'same', label: 'One', categories: ['statement', 'bad'] },
      { id: 'same', label: 'Two', categories: [] },
    ]);
    expect(tracks.map((track) => track.id)).toEqual(['same', 'same-2']);
    expect(tracks[0].categories).toEqual(['statement']);
    expect(tracks[1].categories).toEqual(['statement']);
  });

  it('reorders and duplicates presentation without sharing arrays', () => {
    const tracks = defaultTimelineTracks();
    expect(moveTimelineTrack(tracks, 0, 1).map((track) => track.label)).toEqual(['Media', 'Events']);
    const copy = copyTimelineTrack({ ...tracks[0], hidden: ['a'] }, tracks);
    expect(copy.label).toBe('Events copy');
    expect(copy.id).not.toBe(tracks[0].id);
  });

  it('groups one event into each matching subject without copying the event', () => {
    const tracks = defaultTimelineTracks().slice(0, 1);
    const item = { id: 'event', subject_entities: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] };
    const grouped = groupedTimelineTracks(tracks, { events: [item] }, 'subject');
    expect(grouped.map((track) => track.label)).toEqual(['A', 'B']);
    expect(grouped.every((track) => track.items[0] === item)).toBe(true);
  });

  it('keeps entries without a grouping value visible', () => {
    const tracks = defaultTimelineTracks();
    const event = { id: 'event', owner_type: 'claim' };
    const media = { id: 'media', owner_type: 'capture' };
    expect(groupedTimelineTracks(tracks, { events: [event], media: [media] }, 'subject')
      .map((track) => track.label)).toEqual(['No subject', 'No subject']);
    expect(groupedTimelineTracks(tracks, { events: [event], media: [media] }, 'type')
      .map((track) => track.label)).toEqual(['claim', 'capture']);
    expect(groupedTimelineTracks(tracks, { events: [event], media: [media] }, 'type',
      (type) => type.toUpperCase()).map((track) => track.label)).toEqual(['CLAIM', 'CAPTURE']);
  });

  it('leaves a track on its category colours until one is chosen', () => {
    expect(defaultTimelineTracks().map((track) => track.color)).toEqual(['', '']);
    expect(timelineTrack({ label: 'Vessels', color: 'blue' }).color).toBe('blue');
    expect(timelineTrack({ label: 'Vessels', color: 'chartreuse' }).color).toBe('');
    expect(trackTint('blue')).toBe('var(--anno-2)');
    expect(trackTint('')).toBeUndefined();
    expect(trackTint('chartreuse')).toBeUndefined();
    // a duplicate is the same reading again, colour included
    expect(copyTimelineTrack(timelineTrack({ label: 'Vessels', color: 'amber' }), []).color)
      .toBe('amber');
    expect(TRACK_COLORS).toHaveLength(6);
  });

  it('restores old specs with explicit defaults', () => {
    expect(timelineViewState({ from: '2026-01-01', group_by: 'unknown' })).toMatchObject({
      from: '2026-01-01', to: '', groupBy: 'none', viewMode: 'plot',
      timezone: 'UTC', zoneChoice: 'utc',
    });
    expect(timelineViewState({
      timezone: 'Europe/Paris', zone_choice: 'place:harbour',
    })).toMatchObject({ timezone: 'Europe/Paris', zoneChoice: 'place:harbour' });
    // a zone named outright is the fourth reading, and a view made in it must not come
    // back on UTC — validated by shape, since whether this machine can load the name is
    // asked when the axis is drawn
    expect(timelineViewState({
      timezone: 'Europe/Kyiv', zone_choice: 'zone:Europe/Kyiv',
    })).toMatchObject({ zoneChoice: 'zone:Europe/Kyiv' });
    expect(timelineViewState({ zone_choice: 'zone:../../etc/passwd' }).zoneChoice).toBe('utc');
    expect(timelineViewState({ zone_choice: 'zone:' }).zoneChoice).toBe('utc');
  });

  it('derives visible categories from tracks', () => {
    const restored = timelineViewState({
      visible_categories: ['case_activity'],
      tracks: [
        { id: 'claims', label: 'Claims', categories: ['statement'] },
        { id: 'files', label: 'Files', categories: ['media'] },
      ],
    });
    expect(restored.categories).toEqual(['statement', 'media']);
  });
});
