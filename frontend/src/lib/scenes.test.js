import { describe, expect, it } from 'vitest';
import {
  ABANDONED, PROGRESS, TODO, isAbandoned, liveScenes, markablePicture, sceneColorAt, sceneKind, sceneWhen, toProve, unplaced,
  WHOLE_VIDEO, defaultEnd, editClock, isStretch, isWholeVideo, momentKey, momentsClash, newScene, parseClock,
  sameMoments, sameTime, sceneList, shortClock, sceneMarks, scenePassage, sceneStart, sceneTime, sceneTitle,
  sceneToEnd, shortMoments, snapToFrame, sortMoments, spanLabel, stretchFromShot, timeProblem, timeWords,
  compactTime, draftTime, momentBefore, samePlaceChoices, sceneMoments, setDraftTime, nextPassage, timedBeside, wholeTaker,
  mixedWhole, wholeBarred, wholeDrafts,
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

describe('a scene\'s kind, in words', () => {
  it('says what kind of time a scene states', () => {
    expect(sceneKind(draft('a', null))).toBe(WHOLE_VIDEO);
    expect(sceneKind(draft('a', 3))).toBe('Instant');
    expect(sceneKind(draft('a', 3, 9))).toBe('Passage');
    expect(sceneKind(proof('P', { moments: [m(30, 45), m(100)] }))).toBe('2 passages');
    expect(sceneKind(proof('P', { at: [3] }))).toBe(WHOLE_VIDEO);
  });

  it('writes the kind before the time, and the whole video alone', () => {
    expect(sceneWhen(draft('a', null))).toBe('Whole video');
    expect(sceneWhen(draft('a', 229))).toBe('Instant · 3:49');
    expect(sceneWhen(draft('a', 30, 45))).toBe('Passage · 0:30–0:45');
    expect(sceneWhen(proof('P', { moments: [m(30, 45), m(100), m(190, 200)] }))).toBe('3 passages · 0:30–0:45 +2');
  });
});

describe('what can be marked to geolocate', () => {
  const picture = (source) => ({ kind: 'image', source });

  it('takes a picture of the analyst\'s', () => {
    expect(markablePicture(picture({ type: 'upload' }))).toBe(true);
    expect(markablePicture(picture({ type: 'download' }))).toBe(true);
    expect(markablePicture(picture(undefined))).toBe(true);
    // adjusted and saved from Inspect, it is still that picture and no frame of a video
    expect(markablePicture(picture({ type: 'inspect', op: 'frame', time: null }))).toBe(true);
  });

  it('leaves out a frame of a video, which belongs to its video\'s scenes, and a capture', () => {
    expect(markablePicture(picture({ type: 'inspect', op: 'frame', from: 'media/clip.mp4', time: 12.4 }))).toBe(false);
    for (const type of ['satellite', 'screenshot', 'horizon', 'compare']) expect(markablePicture(picture({ type }))).toBe(false);
    expect(markablePicture({ kind: 'video', source: { type: 'upload' } })).toBe(false);
    expect(markablePicture(null)).toBe(false);
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

  it('colours a scene by its place, as anywhere outside Inspect reads it from its order', () => {
    const list = sceneList([proof('Early', { at: [0.5] })], [draft('a', 2), draft('b', 3), draft('c', 4), draft('d', 5), draft('e', 6), draft('f', 7)]);
    expect(list.map((s) => s.color)).toEqual(list.map((_s, i) => sceneColorAt(i)));
    // the palette comes round again after six
    expect(sceneColorAt(6)).toBe(sceneColorAt(0));
    expect(sceneColorAt(undefined)).toBe(sceneColorAt(0));
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

  it('reads what the server alone keeps on a draft off its row: the captures gathered, and why it was left', () => {
    const row = (id, extra) => ({ kind: 'draft', id, start: 1, end: null, label: 'stale', ...extra });
    const list = sceneList(
      [
        row('sc_1', { captures: ['media/cap-1.png', 'media/cap-2.png'], abandoned: null }),
        row('sc_2', { captures: [], abandoned: { reason: 'no landmark', at: '2026-11-06T10:00:00+00:00' } }),
      ],
      [draft('sc_1', 10, 12, 'bridge?'), draft('sc_2', 20), draft('sc_3', 30)],
    );
    expect(list.map((s) => [s.id, s.label, s.state, s.captures.length])).toEqual([
      ['sc_1', 'bridge?', PROGRESS, 2],
      ['sc_2', '', ABANDONED, 0],
      // not saved yet, so not on the server: to geolocate
      ['sc_3', '', TODO, 0],
    ]);
    expect(list[1].abandoned.reason).toBe('no landmark');
    expect(list.map(isAbandoned)).toEqual([false, true, false]);
    expect(liveScenes(list).map((s) => s.id)).toEqual(['sc_1', 'sc_3']);
    expect(toProve(list)).toBe(2);
    expect(toProve([...list.filter((s) => s.id === 'sc_2'), { kind: 'proof', proof: 'P' }])).toBe(0);
    // the abandoned keep their place in the colours, so giving one up recolours nothing
    expect(new Set(list.map((s) => s.color)).size).toBe(3);
  });

  it('counts a proof that states no place yet as still to prove, and one given up on as abandoned', () => {
    const placed = { kind: 'proof', proof: 'A', state: 'proved', abandoned: null };
    const open = { kind: 'proof', proof: 'B', state: PROGRESS, abandoned: null };
    const left = { kind: 'proof', proof: 'C', state: ABANDONED, abandoned: { reason: 'no landmark' } };
    // an older answer stated no state: proved, as it always read
    const older = { kind: 'proof', proof: 'D' };
    expect([placed, open, left, older].map(unplaced)).toEqual([false, true, false, false]);
    expect([placed, open, left, older].map(isAbandoned)).toEqual([false, false, true, false]);
    expect(liveScenes([placed, open, left, older]).map((s) => s.proof)).toEqual(['A', 'B', 'D']);
    expect(toProve([placed, open, left, older])).toBe(1);
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
    // each mark names its scene, which a press on it opens
    expect(marks.map((k) => k.scene)).toEqual([
      'proof:Traced', 'proof:Traced', 'proof:Twice', 'proof:Twice', 'proof:Twice', 'sc_1', 'sc_2',
    ]);
  });

  it('draws an abandoned scene too, flagged so the bar greys it, and names it so on hover', () => {
    const list = sceneList(
      [{ kind: 'draft', id: 'sc_1', start: 10, end: 12, label: 'bridge?', captures: [], abandoned: { reason: '', at: 't' } }],
      [draft('sc_1', 10, 12, 'bridge?'), draft('sc_2', 15)],
    );
    expect(sceneMarks(list).map((k) => [k.key, k.abandoned ?? false, k.label])).toEqual([
      ['sc_1', true, 'bridge? · abandoned'],
      ['sc_2', false, 'To geolocate'],
    ]);
  });

  it('names a proof by its title and a draft by its label', () => {
    expect(sceneTitle(proof('Bridge', { title: 'Road bridge' }))).toBe('Road bridge');
    expect(sceneTitle({ kind: 'draft', label: 'bridge?' })).toBe('bridge?');
    expect(sceneTitle({ kind: 'draft', label: '' })).toBe('To geolocate');
  });
});

describe('one scene, several moments', () => {
  const joined = (id, start, end, more, label = '') => ({ id, start, end, label, more });

  it('reads a scene still to prove as its own time, then the moments after it', () => {
    expect(sceneMoments({ kind: 'draft', ...joined('a', 0, 7, [m(65, 72)]) })).toEqual([m(0, 7), m(65, 72)]);
    expect(sceneMoments({ kind: 'draft', ...draft('a', 3) })).toEqual([m(3)]);
    // the whole video holds no moment, whatever it carries
    expect(sceneMoments({ kind: 'draft', ...joined('a', null, null, [m(65)]) })).toEqual([]);
  });

  it('keeps moments as a scene writes them, its first in clip order as its own time', () => {
    expect(draftTime([m(65, 72), m(0, 7)])).toEqual({ start: 0, end: 7, more: [m(65, 72)] });
    // one moment writes no `more`, so a scene of one is written as it always was
    expect(draftTime([m(3)])).toEqual({ start: 3, end: null });
    expect(draftTime([])).toEqual({ start: null, end: null });
    const scene = joined('a', 0, 7, [m(65, 72)]);
    setDraftTime(scene, [m(2, 7)]);
    expect(scene).toEqual({ id: 'a', start: 2, end: 7, label: '' });
  });

  it('lists, marks and words every moment, in the colour of the first', () => {
    const list = sceneList([], [joined('a', 0, 7, [m(65, 72)], 'Bridge'), draft('b', 30)]);
    const a = list.find((s) => s.key === 'a');
    expect(a.more).toEqual([m(65, 72)]);
    expect([list[0].key, a.color]).toEqual(['a', sceneColorAt(0)]);
    const marks = sceneMarks(list);
    expect(marks.map((k) => [k.key, k.scene, k.start, k.end, k.color])).toEqual([
      ['a', 'a', 0, 7, a.color],
      ['a#1', 'a', 65, 72, a.color],
      ['b', 'b', 30, null, list[1].color],
    ]);
    expect(sceneTime(a)).toBe('0:00–0:07 · 1:05–1:12');
    expect(sceneWhen(a)).toBe('2 passages · 0:00–0:07 · 1:05–1:12');
    expect(compactTime(a)).toBe('0:00–0:07 +1');
    expect(compactTime(list[1])).toBe('0:30');
    expect(timeWords(sceneMoments(a))).toBe('0:00–0:07 · 1:05–1:12');
  });

  it('offers the clip’s other scenes still to prove as the same place, never a proof, the whole video or one abandoned', () => {
    const list = sceneList(
      [proof('P', { moments: [m(40, 45)], stated: true }),
        { kind: 'draft', id: 'gone', start: 50, end: null, label: '', captures: [], abandoned: { reason: '', at: 't' } }],
      [draft('a', 5), draft('b', 20, 25), draft('all', null), draft('gone', 50)],
    );
    const key = (k) => list.find((s) => s.key === k);
    expect(samePlaceChoices(list, key('a')).map((s) => s.key)).toEqual(['b']);
    expect(samePlaceChoices(list, key('b')).map((s) => s.key)).toEqual(['a']);
    expect(samePlaceChoices(list, key('all'))).toEqual([]);
    expect(samePlaceChoices(list, key('proof:P'))).toEqual([]);
    expect(samePlaceChoices(list, key('gone'))).toEqual([]);
  });

  it('ends the moment started latest before the frame', () => {
    const list = sceneList([], [joined('a', 5, null, [m(60)]), draft('b', 20)]);
    const a = list.find((s) => s.key === 'a');
    expect(momentBefore(a, 30)).toBe(0);
    expect(momentBefore(a, 70)).toBe(1);
    expect(momentBefore(a, 2)).toBe(-1);
    expect(sceneToEnd(list, 30).id).toBe('b');
    expect(sceneToEnd(list, 70).id).toBe('a');
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

  it('never ends an abandoned scene', () => {
    const list = sceneList(
      [{ kind: 'draft', id: 'b', start: 20, end: null, label: '', captures: [], abandoned: { reason: '', at: 't' } }],
      [draft('a', 5), draft('b', 20)],
    );
    expect(sceneToEnd(list, 30).id).toBe('a');
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

describe('one place or several, never both', () => {
  const list = (drafts, proofs = []) => sceneList(proofs, drafts);
  const gone = (scene) => ({ ...scene, kind: 'draft', abandoned: { reason: '' } });

  it('bars the whole video beside a scene holding passages, a proof\'s included, never for the scene itself', () => {
    expect(timedBeside(list([]))).toBe(false);
    expect(timedBeside(list([draft('w', null)]))).toBe(false);
    const timed = list([draft('a', 3, 9)]);
    expect(timedBeside(timed)).toBe(true);
    // the scene asking is left out: alone, it may become the whole video
    expect(timedBeside(timed, timed[0])).toBe(false);
    const both = list([draft('a', 3, 9), draft('b', 20)]);
    expect(timedBeside(both, both[0])).toBe(true);
    // a proof's passages count, a proof about the whole video does not
    expect(timedBeside(list([], [proof('P', { moments: [m(5)] })]))).toBe(true);
    expect(timedBeside(list([], [proof('P', { at: [5] })]))).toBe(false);
  });

  it('leaves out a scene given up on', () => {
    const rows = sceneList([], [draft('a', 3, 9)]).map(gone);
    expect(timedBeside(rows)).toBe(false);
  });

  it('gives a new time to the one scene still to prove about the whole video', () => {
    const one = list([draft('w', null, null, 'Market')]);
    expect(wholeTaker(one)?.id).toBe('w');
    // a proof about the whole video is an answer and lets it take the time
    expect(wholeTaker(list([draft('w', null)], [proof('P', { at: [5] })]))?.id).toBe('w');
  });

  it('leaves it as it is among other scenes, or beside a proof holding passages', () => {
    expect(wholeTaker(list([]))).toBeNull();
    expect(wholeTaker(list([draft('a', 3)]))).toBeNull();
    // an older case holding both: no merging
    expect(wholeTaker(list([draft('w', null), draft('a', 3)]))).toBeNull();
    expect(wholeTaker(list([draft('w', null)], [proof('P', { moments: [m(5)] })]))).toBeNull();
    // given up on, it takes nothing
    expect(wholeTaker(list([draft('w', null)]).map(gone))).toBeNull();
    // the other one given up on, it is the only live one again
    const rows = list([draft('w', null), draft('a', 3)]).map((s) => (s.id === 'a' ? gone(s) : s));
    expect(wholeTaker(rows)?.id).toBe('w');
  });

  it('offers the whole video only to the video\'s one live scene still to prove, with no passages beside it', () => {
    const alone = list([draft('a', 3)]);
    expect(wholeBarred(alone, alone[0])).toBe('');
    expect(wholeBarred(list([]))).toBe('');
    // a second one about the whole video would ask the same question twice
    const twins = list([draft('w', null), draft('a', 3, 9)]);
    expect(wholeBarred(twins, twins.find((s) => s.id === 'a'))).toBe('whole');
    expect(wholeBarred(list([draft('w', null)]))).toBe('whole');
    // beside passages, a proof's included, the video is several places
    const timed = list([draft('a', 3), draft('b', 20)]);
    expect(wholeBarred(timed, timed[0])).toBe('timed');
    const proved = list([draft('a', 3)], [proof('P', { moments: [m(5)] })]);
    expect(wholeBarred(proved, proved.find((s) => s.kind === 'draft'))).toBe('timed');
    // a proof about the whole video is an answer and bars nothing; the abandoned do not count
    const answered = list([draft('a', 3)], [proof('P', { at: [5] })]);
    expect(wholeBarred(answered, answered.find((s) => s.kind === 'draft'))).toBe('');
    const given = list([draft('a', 3), draft('w', null)]).map((s) => (s.id === 'w' ? gone(s) : s));
    expect(wholeBarred(given, given.find((s) => s.id === 'a'))).toBe('');
  });

  it('finds an older case\'s scenes about the whole video, and one standing beside passages', () => {
    const rows = list([draft('w1', null), draft('a', 3), draft('w2', null)]);
    expect(wholeDrafts(rows).map((s) => s.id)).toEqual(['w1', 'w2']);
    expect(wholeDrafts(rows.map((s) => (s.id === 'w2' ? gone(s) : s))).map((s) => s.id)).toEqual(['w1']);
    expect(mixedWhole(rows, rows.find((s) => s.id === 'w1'))).toBe(true);
    expect(mixedWhole(rows, rows.find((s) => s.id === 'a'))).toBe(false);
    // two about the whole video alone are twins, not mixed
    const twins = list([draft('w1', null), draft('w2', null)]);
    expect(mixedWhole(twins, twins[0])).toBe(false);
    // a proof's passages make it mixed too, a proof about the whole video does not
    const proved = list([draft('w', null)], [proof('P', { moments: [m(5)] })]);
    expect(mixedWhole(proved, proved.find((s) => s.kind === 'draft'))).toBe(true);
    const answered = list([draft('w', null)], [proof('P', { at: [5] })]);
    expect(mixedWhole(answered, answered.find((s) => s.kind === 'draft'))).toBe(false);
  });
});

describe('Another passage', () => {
  const at = (start) => ({ start, end: start + 0.04 });
  const clip = { frame: 0.04, duration: 60 };

  it('adds an instant at the frame on screen when the scene holds instants', () => {
    expect(nextPassage([m(3)], at(20), clip)).toEqual({ start: 20, end: null });
    expect(nextPassage([], at(20), clip)).toEqual({ start: 20, end: null });
    // the same instant twice is said, not added
    expect(nextPassage([m(3), m(20)], at(20), clip)).toEqual({ refused: 'The scene holds this instant already' });
  });

  it('adds a stretch as long as the first one, from the frame on screen', () => {
    expect(nextPassage([m(10, 14)], at(30), clip)).toEqual({ start: 30, end: 34 });
    // the first in clip order sets the kind and the length
    expect(nextPassage([m(40), m(10, 16)], at(30), clip)).toEqual({ start: 30, end: 36 });
    expect(nextPassage([m(40, 42), m(10)], at(30), clip)).toEqual({ start: 30, end: null });
  });

  it('keeps it inside the clip', () => {
    expect(nextPassage([m(10, 14)], at(58), clip)).toEqual({ start: 58, end: 60 });
    // an unknown length bounds nothing
    expect(nextPassage([m(10, 14)], at(58), { frame: 0.04, duration: 0 })).toEqual({ start: 58, end: 62 });
  });

  it('shortens it to the room before the next stretch, and starts it after the one the frame is in', () => {
    expect(nextPassage([m(10, 14), m(32, 40)], at(30), clip)).toEqual({ start: 30, end: 32 });
    expect(nextPassage([m(10, 14)], at(12), clip)).toEqual({ start: 14, end: 18 });
    // stretches that touch are left behind together
    expect(nextPassage([m(10, 14), m(14, 16)], at(12), clip)).toEqual({ start: 16, end: 20 });
    // an instant inside is no obstacle
    expect(nextPassage([m(10, 14), m(31)], at(30), clip)).toEqual({ start: 30, end: 34 });
  });

  it('refuses gently when no frame is free', () => {
    const refused = { refused: 'No room here for another passage' };
    expect(nextPassage([m(10, 14), m(14, 20)], at(12), clip)).toEqual({ start: 20, end: 24 });
    expect(nextPassage([m(50, 60)], at(55), clip)).toEqual(refused);
    expect(nextPassage([m(10, 14), m(30.02, 40)], at(30), clip)).toEqual(refused);
  });
});
