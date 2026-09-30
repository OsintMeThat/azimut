// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';
import { isNoteKey, noteEntityFor, noteHere, offerNote, placeOf, withdrawNote } from './noteHere.svelte.js';

const relation = (place, { type = 'located-at', status = 'confirmed', direction = 'out' } = {}) => ({
  entity: { id: place, type: 'place', label: place, attrs: {}, provenance: { status: 'confirmed' } },
  link: { type, provenance: { status } },
  direction,
});

beforeEach(() => {
  for (const tool of Object.keys(noteHere.byTool)) withdrawNote(tool);
});

describe('what a tool offers the Add event bar', () => {
  it('keeps each tool’s selection to that tool', () => {
    offerNote('media', { id: 'm1', label: 'VID_0312', type: 'media', attrs: { path: 'a.mp4' } });
    offerNote('satellite', { id: 'p1', label: 'Crossroads', type: 'place' });
    expect(noteEntityFor('media')).toEqual({ id: 'm1', label: 'VID_0312', type: 'media', attrs: { path: 'a.mp4' } });
    expect(noteEntityFor('satellite').id).toBe('p1');
    expect(noteEntityFor('proof')).toBeNull();
  });

  it('takes it back when nothing is selected or the tool goes', () => {
    offerNote('media', { id: 'm1', type: 'media' });
    offerNote('media', null);
    expect(noteEntityFor('media')).toBeNull();
    offerNote('media', { id: 'm1', type: 'media' });
    withdrawNote('media');
    expect(noteEntityFor('media')).toBeNull();
  });
});

describe('the place a file is seated at', () => {
  it('is its one confirmed place', () => {
    expect(placeOf({ relations: [relation('p1')] })).toMatchObject({ id: 'p1', slot: 'at' });
    expect(placeOf({ relations: [relation('p1', { type: 'depicts' }), relation('p1')] })).toMatchObject({ id: 'p1' });
  });

  it('is nothing when there are two, or one a tool only suggested', () => {
    // seating a suggestion would confirm it without the analyst having decided it
    expect(placeOf({ relations: [relation('p1'), relation('p2')] })).toBeNull();
    expect(placeOf({ relations: [relation('p1', { status: 'suggested' })] })).toBeNull();
    expect(placeOf({ relations: [relation('p1', { direction: 'in' })] })).toBeNull();
    expect(placeOf(null)).toBeNull();
  });
});

describe('the shortcut', () => {
  const key = (init, target = document.body) => ({ altKey: true, code: 'KeyN', target, ...init });

  it('is Alt+N, whatever letter the layout types for it', () => {
    expect(isNoteKey(key({ key: '˜' }))).toBe(true);
    expect(isNoteKey(key({ ctrlKey: true }))).toBe(false);
    expect(isNoteKey(key({ metaKey: true }))).toBe(false);
    expect(isNoteKey(key({ altKey: false }))).toBe(false);
    expect(isNoteKey(key({ code: 'KeyM' }))).toBe(false);
  });

  it('never fires from inside a field', () => {
    const input = document.createElement('input');
    document.body.append(input);
    expect(isNoteKey(key({}, input))).toBe(false);
    input.remove();
  });
});
