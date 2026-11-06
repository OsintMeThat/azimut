import { describe, expect, it } from 'vitest';
import {
  WHOLE_VIDEO, defaultEnd, editClock, isStretch, isWholeVideo, momentKey, momentsClash, newScene, parseClock,
  sameMoments, sameTime, sceneList, shortClock, sceneMarks, scenePassage, sceneStart, sceneTime, sceneTitle,
  sceneToEnd, shortMoments, snapToFrame, sortMoments, spanLabel, stretchFromShot, timeProblem, timeWords,
} from './scenes.js';

const proof = (name, extra = {}) => ({
  kind: 'proof', proof: name, title: name, moments: [], at: [], stated: false, draft: null, ...extra,
});
const draft = (id, start, end = null, label = '') => ({ id, start, end, label });
const m = (start, end = null) => ({ start, end });

describe('a scene\'s time', () => {
  it('writes a stretch as minutes and seconds, the way a player counts them', () => {
    expect(spanLabel(130, 158.4)).toBe('2:10–2:38');
    expect(spanLabel(0, 59.96)).toBe('0:00–0:59');
    expect(shortClock(3725.2)).toBe('1:02:05');
  });

  it('tells a stretch from an instant', () => {
    expect(isStretch(draft('a', 1, 3))).toBe(true);
    expect(isStretch(draft('a', 1))).toBe(false);
    expect(isStretch(draft('a', 3, 1))).toBe(false);
  });

  it('is the whole video when it states none', () => {
    expect(isWholeVideo(draft('a', null))).toBe(true);
    expect(isWholeVideo(proof('P', { at: [3] }))).toBe(true);
    expect(isWholeVideo(proof('P', { moments: [m(3)] }))).toBe(false);
    expect(sceneTime(draft('a', null))).toBe(WHOLE_VIDEO);
    // a proof built on frames says so too: its frames place it, they are not its time
    expect(sceneTime(proof('P', { at: [203.7] }))).toBe('Whole video');
  });

  it('starts at its first moment, else at the first frame a proof rests on', () => {
    expect(sceneStart(proof('P', { at: [12.4, 30] }))).toBe(12.4);
    expect(sceneStart(proof('P', { moments: [m(5, 8), m(40)], at: [2] }))).toBe(5);
    expect(sceneStart(proof('P'))).toBeNull();
    expect(sceneStart(draft('a', null))).toBeNull();
  });

  it('shows moments the way a row does, wherever they are shown', () => {
    expect(shortMoments([m(130, 158)])).toBe('2:10–2:38');
    expect(shortMoments([m(30, 45), m(100), m(190, 200)])).toBe('0:30–0:45 +2');
    expect(shortMoments([])).toBe(WHOLE_VIDEO);
  });

  it('shows each moment, and counts them past two', () => {
    expect(sceneTime(draft('a', 3.2))).toBe('0:03');
    expect(sceneTime(draft('a', 130, 158))).toBe('2:10–2:38');
    expect(sceneTime(proof('P', { moments: [m(30, 45), m(190, 200)] }))).toBe('0:30–0:45 · 3:10–3:20');
    expect(sceneTime(proof('P', { moments: [m(30, 45), m(100), m(190, 200)] }))).toBe('0:30–0:45 +2');
  });

  it('loops the first passage it holds', () => {
    expect(scenePassage(proof('P', { moments: [m(3), m(30, 45), m(60, 70)] }))).toEqual(m(30, 45));
    expect(scenePassage(draft('a', 3))).toBeNull();
    expect(scenePassage(draft('a', 3, 9))).toEqual(m(3, 9));
  });

  it('makes a new scene as an instant with an id of its own', () => {
    const a = newScene({ start: 1 }, 'bridge?');
    const b = newScene({ start: 1, end: 4 });
    expect(a).toMatchObject({ start: 1, end: null, label: 'bridge?' });
    expect(b).toMatchObject({ start: 1, end: 4, label: '' });
    expect(a.id).not.toBe(b.id);
  });

  it('runs a shot to the next one, and the last to the end of the clip', () => {
    const shots = [{ start: 0 }, { start: 12.5 }, { start: 30 }];
    expect(stretchFromShot(shots, 0, 60)).toEqual({ start: 0, end: 12.5 });
    expect(stretchFromShot(shots, 2, 60)).toEqual({ start: 30, end: 60 });
    expect(stretchFromShot(shots, 3, 60)).toBeNull();
    expect(stretchFromShot(shots, 2, 0)).toBeNull();
  });
});

describe('sceneList', () => {
  it('puts proofs and drafts in the order of the clip, coloured by place', () => {
    const list = sceneList(
      [proof('Late', { at: [40] }), proof('Early', { moments: [m(2, 6), m(50)], stated: true })],
      [draft('sc_1', 20, 25, 'bridge?'), draft('sc_2', 10)],
    );
    expect(list.map((s) => s.key)).toEqual(['proof:Early', 'sc_2', 'sc_1', 'proof:Late']);
    expect(new Set(list.map((s) => s.color)).size).toBe(4);
  });

  it('puts a draft about the whole video first', () => {
    const list = sceneList([proof('Early', { at: [0.5] })], [draft('sc_1', 2), draft('sc_all', null, null, 'which town?')]);
    expect(list.map((s) => s.key)).toEqual(['sc_all', 'proof:Early', 'sc_1']);
  });

  it('leaves out a draft a proof has taken up, and shows it again once the proof is gone', () => {
    const listed = [proof('Bridge', { moments: [m(21, 24)], stated: true, draft: 'sc_1' })];
    const drafts = [draft('sc_1', 20, 25), draft('sc_2', 50)];
    expect(sceneList(listed, drafts).map((s) => s.key)).toEqual(['proof:Bridge', 'sc_2']);
    expect(sceneList([], drafts).map((s) => [s.key, s.start, s.end])).toEqual([['sc_1', 20, 25], ['sc_2', 50, null]]);
    // taken up by a proof about another video now, which the server names
    expect(sceneList([], drafts, ['sc_2']).map((s) => s.key)).toEqual(['sc_1']);
  });

  it('takes the drafts from the open work, not the server', () => {
    expect(sceneList([{ kind: 'draft', id: 'gone', start: 1, end: 2 }], [])).toEqual([]);
  });

  it('keeps a proof with no time at all last', () => {
    expect(sceneList([proof('Unplaced'), proof('Placed', { at: [3] })], []).map((s) => s.key))
      .toEqual(['proof:Placed', 'proof:Unplaced']);
  });
});

describe('what the bar draws', () => {
  it('draws every moment of a proof in its colour, pins a traced one at its frames, and nothing for the whole video', () => {
    const list = sceneList(
      [proof('Traced', { at: [3, 9] }), proof('Twice', { moments: [m(5, 8), m(30, 34), m(40)], stated: true })],
      [draft('sc_1', 10, 12), draft('sc_2', 15), draft('sc_all', null)],
    );
    const marks = sceneMarks(list);
    expect(marks.map((k) => [k.key, k.start, k.end])).toEqual([
      ['proof:Traced@0', 3, null],
      ['proof:Traced@1', 9, null],
      ['proof:Twice#0', 5, 8],
      ['proof:Twice#1', 30, 34],
      ['proof:Twice#2', 40, null],
      ['sc_1', 10, 12],
      ['sc_2', 15, null],
    ]);
    const twice = list.find((s) => s.key === 'proof:Twice');
    expect(new Set(marks.filter((k) => k.key.startsWith('proof:Twice')).map((k) => k.color))).toEqual(new Set([twice.color]));
    expect(momentKey(twice, 1)).toBe('proof:Twice#1');
    expect(momentKey(list.find((s) => s.key === 'sc_1'), 0)).toBe('sc_1');
  });

  it('names a proof by its title and a draft by its label', () => {
    expect(sceneTitle(proof('Bridge', { title: 'Road bridge' }))).toBe('Road bridge');
    expect(sceneTitle({ kind: 'draft', label: 'bridge?' })).toBe('bridge?');
    expect(sceneTitle({ kind: 'draft', label: '' })).toBe('To geolocate');
  });
});

describe('sceneToEnd', () => {
  it('ends the latest scene still to prove that started before the frame', () => {
    const list = sceneList(
      [proof('P', { moments: [m(40, 45)], stated: true })],
      [draft('a', 5), draft('b', 20), draft('c', 60), draft('all', null)],
    );
    expect(sceneToEnd(list, 30).id).toBe('b');
    expect(sceneToEnd(list, 50).id).toBe('b'); // a proved scene is its proof's, never ended here
    expect(sceneToEnd(list, 2)).toBeNull(); // nor one about the whole video
  });
});

describe('moments side by side', () => {
  it('sorts them in clip order', () => {
    expect(sortMoments([m(30, 34), m(5), m(5, 8)])).toEqual([m(5), m(5, 8), m(30, 34)]);
  });

  it('refuses two passages that overlap, or one instant twice, and lets them touch', () => {
    expect(momentsClash([m(5, 10), m(8, 12)])).toBe('Two passages overlap');
    expect(momentsClash([m(5), m(5)])).toBe('One instant is there twice');
    expect(momentsClash([m(5, 10), m(10, 12), m(7), m(10)])).toBe('');
  });

  it('tells two lists of the same times', () => {
    expect(sameMoments([m(1, 2), m(5)], [m(1, 2 + 1e-9), { start: 5 }])).toBe(true);
    expect(sameMoments([m(1, 2)], [m(1)])).toBe(false);
    expect(sameMoments([], undefined)).toBe(true);
  });
});

describe('a time typed into a scene', () => {
  it('reads seconds, minutes and hours, a comma as a point', () => {
    expect(parseClock('65')).toBe(65);
    expect(parseClock('1:05')).toBe(65);
    expect(parseClock('1:05.5')).toBe(65.5);
    expect(parseClock('1:05,5')).toBe(65.5);
    expect(parseClock(' 2:10 ')).toBe(130);
    expect(parseClock('1:02:03')).toBe(3723);
    expect(parseClock('01:02:03.25')).toBe(3723.25);
    expect(parseClock('90:00')).toBe(5400); // the first field counts as far as it likes
    expect(parseClock('.5')).toBe(0.5);
  });

  it('is no time when it reads as none', () => {
    for (const text of ['', '  ', 'soon', '-1', '1:60', '1:61:00', '1:2:3:4', '1::05', '1:05:', '1.5:00', '1e3', null]) {
      expect(parseClock(text), String(text)).toBeNull();
    }
  });

  it('is written back to the millisecond, with nothing after the point it does not need', () => {
    expect(editClock(3.48)).toBe('0:03.48');
    expect(editClock(65)).toBe('1:05');
    expect(editClock(3723.5)).toBe('1:02:03.5');
    expect(editClock(1 + 1 / 30)).toBe('0:01.033');
    expect(editClock(59.9996)).toBe('1:00');
    // what is written reads back as the same frame
    expect(snapToFrame(parseClock(editClock(31 / 30)), 30)).toBeCloseTo(31 / 30, 9);
  });

  it('lands on the nearest frame', () => {
    expect(snapToFrame(1.03, 25)).toBeCloseTo(1.04, 9);
    expect(snapToFrame(1.01, 25)).toBeCloseTo(1, 9);
    expect(snapToFrame(65, 30)).toBeCloseTo(65, 9);
    expect(snapToFrame(-1, 25)).toBe(0);
  });
});

describe('what is wrong with a scene\'s time', () => {
  it('asks for a time, then an end after the start, inside the clip', () => {
    expect(timeProblem({ start: null, end: null, passage: false })).toBe('Type a time, like 1:05 or 65');
    expect(timeProblem({ start: 5, end: null, passage: true })).toBe('Type an end, like 1:12');
    expect(timeProblem({ start: 5, end: 5, passage: true })).toBe('The end must come after the start');
    expect(timeProblem({ start: 50, end: null, passage: false, duration: 42 })).toBe('The video is 0:42 long');
    expect(timeProblem({ start: 5, end: 50, passage: true, duration: 42 })).toBe('The video is 0:42 long');
    // the end of the last frame is the end of the clip, give or take a frame
    expect(timeProblem({ start: 5, end: 42.03, passage: true, duration: 42, frame: 0.04 })).toBe('');
    // an end left in a field is not read while the scene is an instant
    expect(timeProblem({ start: 5, end: null, passage: false, duration: 42 })).toBe('');
  });

  it('ends a new passage at the frame on screen past its start, else a few seconds on', () => {
    expect(defaultEnd(10, 14.04, { frame: 0.04, duration: 60 })).toBe(14.04);
    expect(defaultEnd(10, 10.08, { frame: 0.04, duration: 60 })).toBe(10.08);
    // the clip still on the start: its frame ends one frame on, which is no passage
    expect(defaultEnd(10, 10.04, { frame: 0.04, duration: 60 })).toBe(15);
    expect(defaultEnd(10, 3, { frame: 0.04, duration: 60 })).toBe(15);
    expect(defaultEnd(58, 3, { frame: 0.04, duration: 60 })).toBe(60);
    expect(defaultEnd(60, 3, { frame: 0.04, duration: 60 })).toBeCloseTo(60.04, 9);
  });

  it('says a time the way a toast does', () => {
    expect(timeWords([m(3.4)])).toBe('at 0:03');
    expect(timeWords([m(130, 158)])).toBe('2:10–2:38');
    expect(timeWords([m(30, 45), m(190)])).toBe('0:30–0:45 · 3:10');
    expect(timeWords([])).toBe('the whole video');
    expect(sameTime(1, 1 + 1e-9)).toBe(true);
    expect(sameTime(null, null)).toBe(true);
    expect(sameTime(null, 0)).toBe(false);
  });
});
