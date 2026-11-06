import { describe, expect, it } from 'vitest';
import { SceneEdit } from './sceneEdit.svelte.js';

/**
 * A scene's time while it is being changed: what the fields read, what Apply would
 * keep, and whether it would change anything at all.
 */

const clip = () => ({ duration: 60, fps: 25 });
const draft = (start, end = null) => ({ kind: 'draft', key: 'sc_1', id: 'sc_1', start, end, label: '' });
const proof = (moments = [], at = []) => ({
  kind: 'proof', key: 'proof:P', proof: 'P', moments, at, stated: moments.length > 0, draft: null,
});
const now = (start) => ({ start, end: start + 0.04 });

describe('a scene\'s time, open', () => {
  it('opens on what the scene says: an instant, a passage, or the whole video', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(3.48));
    expect([edit.key, edit.kind, edit.moments[0].startText, edit.moments[0].endText]).toEqual(['sc_1', 'instant', '0:03.48', '']);
    expect(edit.result).toEqual({ start: 3.48, end: null });
    expect(edit.changed).toBe(false);

    edit.begin(draft(10, 14));
    expect([edit.kind, edit.moments[0].startText, edit.moments[0].endText]).toEqual(['passage', '0:10', '0:14']);
    expect(edit.result).toEqual({ start: 10, end: 14 });

    edit.begin(draft(null));
    expect([edit.kind, edit.whole, edit.start, edit.result]).toEqual(['whole', true, null, { start: null, end: null }]);
    // a proof traced off its frames is about the whole video: its frames only place it
    edit.begin(proof([], [12.4, 30]));
    expect([edit.kind, edit.result, edit.changed]).toEqual(['whole', { moments: [] }, false]);
  });

  it('rounds a typed time to its frame, and keeps one a key or a handle set exactly', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(1));
    edit.typeStart('0:02.01');
    expect(edit.start).toBeCloseTo(2, 9);
    expect(edit.moments[0].startText).toBe('0:02.01'); // what was typed stays typed
    edit.setStart(2.0133);
    expect(edit.start).toBe(2.0133);
    expect(edit.moments[0].startText).toBe('0:02.013');
    expect(edit.changed).toBe(true);
  });

  it('turns a moment into a passage and back, keeping the end it had', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(10, 20));
    edit.setKind('instant');
    expect(edit.result).toEqual({ start: 10, end: null });
    edit.setKind('passage', now(0));
    expect(edit.result).toEqual({ start: 10, end: 20 });

    edit.begin(draft(10));
    edit.setKind('passage', now(12)); // the frame on screen is past the start: it ends there
    expect(edit.result).toEqual({ start: 10, end: 12.04 });
    edit.begin(draft(10));
    edit.setKind('passage', now(4)); // not yet: a few seconds on
    expect(edit.result).toEqual({ start: 10, end: 15 });
  });

  it('makes a scene the whole video, and gives its moments back if that was a slip', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 5, end: 8 }, { start: 30, end: null }]));
    edit.setKind('whole');
    expect([edit.whole, edit.start, edit.result]).toEqual([true, null, { moments: [] }]);
    expect(edit.changed).toBe(true);
    edit.setKind('instant', now(40));
    expect(edit.result).toEqual({ moments: [{ start: 5, end: null }, { start: 30, end: null }] });

    // from the whole video with nothing put aside, a moment starts at the frame on screen
    edit.begin(draft(null));
    edit.setKind('instant', now(7));
    expect(edit.result).toEqual({ start: 7, end: null });
    edit.begin(draft(null));
    edit.setKind('passage', now(7));
    expect(edit.result).toEqual({ start: 7, end: 12 });
  });

  it('gives a proof several moments, in clip order, and takes one off', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 30, end: 45 }]));
    edit.add(10);
    expect([edit.active, edit.kind, edit.start]).toEqual([1, 'instant', 10]);
    edit.setEnd(12);
    expect(edit.result).toEqual({ moments: [{ start: 10, end: 12 }, { start: 30, end: 45 }] });
    edit.remove(0);
    expect([edit.active, edit.result]).toEqual([0, { moments: [{ start: 10, end: 12 }] }]);
    edit.remove(0); // the last one goes by choosing the whole video
    expect(edit.moments).toHaveLength(1);

    // a draft keeps one moment
    edit.begin(draft(3));
    edit.add(10);
    expect(edit.moments).toHaveLength(1);
  });

  it('keeps nothing while the fields do not read as a time, and says which moment', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(10, 20));
    edit.typeEnd('9');
    expect(edit.problem).toBe('The end must come after the start');
    expect(edit.result).toBeNull();
    edit.typeEnd('');
    expect(edit.problem).toBe('Type an end, like 1:12');
    edit.setEnd(70);
    expect(edit.problem).toBe('The video is 1:00 long');

    edit.begin(proof([{ start: 5, end: 10 }, { start: 30, end: null }]));
    edit.typeStart('soon', 1);
    expect(edit.problem).toBe('Moment 2: type a time, like 1:05 or 65');
    edit.typeStart('0:08', 1);
    edit.setEnd(12, 1);
    expect(edit.problem).toBe('Two passages overlap');
    edit.close();
    expect([edit.key, edit.result, edit.changed]).toEqual([null, null, false]);
  });

  it('moves the moment in hand, whichever it is', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 5, end: 10 }, { start: 30, end: null }]));
    edit.activate(1);
    expect([edit.start, edit.end]).toEqual([30, null]);
    edit.setEnd(33);
    expect(edit.result).toEqual({ moments: [{ start: 5, end: 10 }, { start: 30, end: 33 }] });
    edit.activate(7);
    expect(edit.active).toBe(1);
  });
});
