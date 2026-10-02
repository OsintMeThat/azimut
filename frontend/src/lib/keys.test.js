import { describe, expect, it } from 'vitest';
import { shortcut } from './keys.js';

describe('shortcut', () => {
  it('spells the modifier the way the machine labels its keys', () => {
    expect(shortcut('Undo (Ctrl+Z)', true)).toBe('Undo (⌘Z)');
    expect(shortcut('Ctrl+Shift+Z or Ctrl+Y', true)).toBe('⌘⇧Z or ⌘Y');
    expect(shortcut('Ctrl-click a second entry', true)).toBe('⌘-click a second entry');
  });

  it('leaves the label alone elsewhere', () => {
    expect(shortcut('Redo (Ctrl+Shift+Z)', false)).toBe('Redo (Ctrl+Shift+Z)');
  });
});
