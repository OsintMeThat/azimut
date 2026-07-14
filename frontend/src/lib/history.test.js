import { describe, it, expect } from 'vitest';
import { createHistory } from './history.js';

describe('createHistory — undo/redo timeline', () => {
  it('starts unable to undo or redo', () => {
    const h = createHistory();
    h.reset('a');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBeNull();
  });

  it('pushes distinct snapshots and walks back through them', () => {
    const h = createHistory();
    h.reset('a');
    expect(h.push('b')).toBe(true);
    expect(h.push('c')).toBe(true);
    expect(h.canUndo).toBe(true);
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBe('a');
    expect(h.undo()).toBeNull(); // anchor reached
  });

  it('skips a push equal to the current entry (debounce echoes)', () => {
    const h = createHistory();
    h.reset('a');
    h.push('b');
    expect(h.push('b')).toBe(false);
    expect(h.undo()).toBe('a');
  });

  it('redoes forward after an undo', () => {
    const h = createHistory();
    h.reset('a');
    h.push('b');
    h.push('c');
    h.undo();
    h.undo();
    expect(h.canRedo).toBe(true);
    expect(h.redo()).toBe('b');
    expect(h.redo()).toBe('c');
    expect(h.redo()).toBeNull(); // tip reached
  });

  it('forks the timeline: a push after undo drops the redo tail', () => {
    const h = createHistory();
    h.reset('a');
    h.push('b');
    h.push('c');
    h.undo(); // at b
    h.push('d'); // c is gone
    expect(h.canRedo).toBe(false);
    expect(h.undo()).toBe('b');
    expect(h.redo()).toBe('d');
  });

  it('reset drops everything and re-anchors', () => {
    const h = createHistory();
    h.reset('a');
    h.push('b');
    h.reset('z');
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);
    expect(h.push('z')).toBe(false); // same as the anchor
  });

  it('evicts the oldest entry past the limit', () => {
    const h = createHistory(3);
    h.reset('a');
    h.push('b');
    h.push('c');
    h.push('d'); // 'a' evicted
    expect(h.undo()).toBe('c');
    expect(h.undo()).toBe('b');
    expect(h.undo()).toBeNull(); // 'a' is gone
  });
});
