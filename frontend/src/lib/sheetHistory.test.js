import { describe, expect, it } from 'vitest';
import { cellsEntry, createSheetHistory, snapshotEntry, weigh } from './sheetHistory.js';

const edit = (row) => ({ row, column: 1, before: '', after: 'x' });

describe('recording steps', () => {
  it('starts with nothing to undo', () => {
    const history = createSheetHistory();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });

  it('walks back and forward through cell edits', () => {
    const history = createSheetHistory();
    history.record(cellsEntry([edit(0)]));
    history.record(cellsEntry([edit(1)]));

    const back = history.undo();
    expect(back.direction).toBe('backward');
    expect(back.entry.edits[0].row).toBe(1);
    expect(history.canRedo).toBe(true);

    const forward = history.redo();
    expect(forward.direction).toBe('forward');
    expect(forward.entry.edits[0].row).toBe(1);
    expect(history.canRedo).toBe(false);
  });

  it('undoes all the way back to the table as it was opened', () => {
    const history = createSheetHistory();
    history.record(cellsEntry([edit(0)]));
    expect(history.undo()).not.toBeNull();
    expect(history.canUndo).toBe(false);
    expect(history.undo()).toBeNull();
  });

  it('drops the redone tail when a new edit forks the timeline', () => {
    const history = createSheetHistory();
    history.record(cellsEntry([edit(0)]));
    history.record(cellsEntry([edit(1)]));
    history.undo();
    history.record(cellsEntry([edit(2)]));

    expect(history.canRedo).toBe(false);
    expect(history.undo().entry.edits[0].row).toBe(2);
  });

  it('records nothing for an edit that changed nothing', () => {
    const history = createSheetHistory();
    expect(history.record(cellsEntry([]))).toBe(false);
    expect(history.record(snapshotEntry('{"a":1}', '{"a":1}'))).toBe(false);
    expect(history.canUndo).toBe(false);
  });
});

describe('a structural step', () => {
  it('reverses like any other, because it keeps both sides', () => {
    // The reason a snapshot carries `before` as well as `after`: undoing an added
    // column has to land on a table, and the entry is the only thing that holds it.
    const history = createSheetHistory();
    history.record(snapshotEntry('{"columns":["id"]}', '{"columns":["id","New"]}'));

    const back = history.undo();
    expect(back.entry.before).toBe('{"columns":["id"]}');
    expect(history.redo().entry.after).toBe('{"columns":["id","New"]}');
  });

  it('interleaves with cell edits in one stack', () => {
    const history = createSheetHistory();
    history.record(cellsEntry([edit(0)]));
    history.record(snapshotEntry('a', 'b'));
    history.record(cellsEntry([edit(1)]));

    expect(history.undo().entry.kind).toBe('cells');
    expect(history.undo().entry.kind).toBe('snapshot');
    expect(history.undo().entry.kind).toBe('cells');
    expect(history.canUndo).toBe(false);
  });
});

describe('the bound', () => {
  it('weighs a cell edit at a fraction of a whole table', () => {
    expect(weigh(cellsEntry([edit(0)]))).toBeLessThan(weigh(snapshotEntry('x'.repeat(400), '')));
  });

  it('lets hundreds of typed cells stay undoable where snapshots would not', () => {
    // The whole reason this module exists. A twenty-thousand-row sheet serialises to
    // megabytes, so a snapshot per keystroke buys a three-step undo; a patch per
    // keystroke buys the afternoon.
    const history = createSheetHistory({ budget: 20_000 });
    for (let index = 0; index < 300; index += 1) history.record(cellsEntry([edit(index)]));
    expect(history.size).toBe(300);

    const snapshots = createSheetHistory({ budget: 20_000 });
    for (let index = 0; index < 300; index += 1) {
      snapshots.record(snapshotEntry('x'.repeat(10_000), 'y'.repeat(10_000)));
    }
    expect(snapshots.size).toBe(1);
  });

  it('drops the oldest steps and keeps the newest reversible', () => {
    const history = createSheetHistory({ budget: 128 });
    for (let index = 0; index < 10; index += 1) history.record(cellsEntry([edit(index)]));
    expect(history.size).toBeLessThan(10);
    // Whatever survived still steps back exactly, which is the guarantee: what a
    // trim costs is depth, never a wrong state.
    expect(history.undo().entry.edits[0].row).toBe(9);
  });

  it('reclaims what a dropped redo tail was holding', () => {
    // Two 300-character steps fit in 640; a third would not. Forking away the second
    // has to give its weight back, or the small step replacing it evicts the first —
    // an undo stack that shrinks every time someone changes their mind.
    const history = createSheetHistory({ budget: 640 });
    history.record(snapshotEntry('x'.repeat(150), 'y'.repeat(150)));
    history.record(snapshotEntry('a'.repeat(150), 'b'.repeat(150)));
    expect(history.size).toBe(2);

    history.undo();
    history.record(cellsEntry([edit(0)]));
    expect(history.size).toBe(2);
  });

  it('forgets everything when the sheet is reloaded from disk', () => {
    const history = createSheetHistory();
    history.record(cellsEntry([edit(0)]));
    history.reset();
    expect(history.canUndo).toBe(false);
    expect(history.canRedo).toBe(false);
  });
});
