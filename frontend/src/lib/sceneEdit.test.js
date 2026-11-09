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

  });

  it('gives a scene still to prove several moments, kept as its first and the ones after it', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(45, 52));
    edit.add(0);
    edit.setEnd(7);
    expect(edit.many).toBe(true);
    // its first moment in clip order is its own time, the rest under `more`
    expect(edit.result).toEqual({ start: 0, end: 7, more: [{ start: 45, end: 52 }] });
    expect(edit.changed).toBe(true);
    // the fields keep the order they were added in: the one just added goes
    edit.remove(1);
    expect(edit.result).toEqual({ start: 45, end: 52 });

    edit.begin({ ...draft(0, 7), more: [{ start: 45, end: 52 }] });
    expect(edit.moments.map((m) => [m.start, m.end])).toEqual([[0, 7], [45, 52]]);
    expect(edit.changed).toBe(false);
    edit.setStart(5, 1);
    edit.setEnd(9, 1);
    expect(edit.problem).toBe('Two passages overlap');
    expect(edit.result).toBeNull();
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
    expect(edit.problem).toBe('Passage 2: type a time, like 1:05 or 65');
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

  it('takes the frame on screen as a start or an end, giving the whole video a moment there', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([], [12]));
    edit.here('start', now(20));
    expect(edit.result).toEqual({ moments: [{ start: 20, end: null }] });
    edit.here('end', now(24));
    expect(edit.result).toEqual({ moments: [{ start: 20, end: 24.04 }] });
  });

  it('nudges either end a frame or a second, and answers the frame that shows it', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 10, end: 12 }]));
    expect(edit.nudge('start', 1)).toBeCloseTo(10.04, 9);
    expect(edit.start).toBeCloseTo(10.04, 9);
    // the end is shown by the frame before it, the last one inside the passage
    expect(edit.nudge('end', -1, true)).toBeCloseTo(10.96, 9);
    expect(edit.end).toBeCloseTo(11, 9);
    // an end cannot cross its start
    edit.setEnd(10.08);
    expect(edit.nudge('end', -1, true)).toBeNull();
    expect(edit.end).toBeCloseTo(10.08, 9);
    edit.setKind('whole');
    expect(edit.nudge('start', 1)).toBeNull();
  });
});

describe('Another passage, open', () => {
  it('adds an instant to a scene of instants, taken in hand', () => {
    const edit = new SceneEdit(clip);
    edit.begin(draft(3));
    expect(edit.another(now(20))).toBe(true);
    expect([edit.active, edit.kind, edit.start, edit.end]).toEqual([1, 'instant', 20, null]);
    expect(edit.activeKey).toBe('sc_1#1');
    expect(edit.result).toEqual({ start: 3, end: null, more: [{ start: 20, end: null }] });
  });

  it('adds a stretch as long as the first to a scene of stretches, its ends in hand', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 10, end: 14 }]));
    expect(edit.another(now(30))).toBe(true);
    expect([edit.active, edit.kind, edit.start, edit.end]).toEqual([1, 'passage', 30, 34]);
    expect(edit.moments[1].endText).toBe('0:34');
    // Here moves the one just added
    edit.here('end', now(31));
    expect(edit.result).toEqual({ moments: [{ start: 10, end: 14 }, { start: 30, end: 31.04 }] });
  });

  it('keeps it inside the clip and out of the scene\'s other stretches', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 10, end: 14 }, { start: 32, end: 40 }]));
    edit.another(now(58));
    expect([edit.start, edit.end]).toEqual([58, 60]);
    edit.remove(2);
    edit.another(now(30));
    expect([edit.start, edit.end]).toEqual([30, 32]);
    edit.remove(2);
    edit.another(now(12));
    expect([edit.start, edit.end]).toEqual([14, 18]);
    expect(edit.problem).toBe('');
  });

  it('adds none when no frame is free, says so, and forgets it at the next change', () => {
    const edit = new SceneEdit(clip);
    edit.begin(proof([{ start: 50, end: 60 }]));
    expect(edit.another(now(55))).toBe(false);
    expect(edit.moments).toHaveLength(1);
    expect(edit.note).toBe('No room here for another passage');
    expect(edit.changed).toBe(false);
    edit.setStart(48);
    expect(edit.note).toBe('');
    edit.another(now(55));
    edit.begin(proof([{ start: 50, end: 60 }]));
    expect(edit.note).toBe('');
  });
});
