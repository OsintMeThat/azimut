import { describe, it, expect } from 'vitest';
import { WORKSPACES, workspaceOf, toolFromHash } from './workspaces.js';

const ALL_TOOLS = ['media', 'inspect', 'satellite', 'proof', 'post', 'settings'];

describe('workspaceOf', () => {
  it('maps every rail tool to exactly one workspace', () => {
    for (const tool of ['media', 'inspect', 'satellite', 'proof', 'post']) {
      const owners = WORKSPACES.filter((w) => w.tools.includes(tool));
      expect(owners).toHaveLength(1);
      expect(workspaceOf(tool)).toBe(owners[0]);
    }
  });

  it('groups proof and post under compose', () => {
    expect(workspaceOf('proof').id).toBe('compose');
    expect(workspaceOf('post').id).toBe('compose');
  });

  it('returns null for settings and unknown tools', () => {
    expect(workspaceOf('settings')).toBeNull();
    expect(workspaceOf('nope')).toBeNull();
  });
});

describe('toolFromHash', () => {
  it('keeps pre-workspace tool links working', () => {
    for (const tool of ALL_TOOLS) {
      expect(toolFromHash(`#${tool}`, ALL_TOOLS)).toBe(tool);
    }
  });

  it('accepts a bare workspace id (first tool)', () => {
    expect(toolFromHash('#collect', ALL_TOOLS)).toBe('media');
    expect(toolFromHash('#compose', ALL_TOOLS)).toBe('proof');
  });

  it('accepts workspace/tab form', () => {
    expect(toolFromHash('#compose/post', ALL_TOOLS)).toBe('post');
    expect(toolFromHash('#compose/proof', ALL_TOOLS)).toBe('proof');
  });

  it('falls back to the first tool on an unknown tab', () => {
    expect(toolFromHash('#compose/bogus', ALL_TOOLS)).toBe('proof');
  });

  it('returns null on garbage', () => {
    expect(toolFromHash('#bogus', ALL_TOOLS)).toBeNull();
    expect(toolFromHash('', ALL_TOOLS)).toBeNull();
  });

  it('works without the leading #', () => {
    expect(toolFromHash('map', ALL_TOOLS)).toBe('satellite');
  });
});
