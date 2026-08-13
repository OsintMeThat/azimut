import { describe, it, expect } from 'vitest';
import {
  ALL_WORKSPACES,
  CASE_WORKSPACE,
  WORKSPACES,
  TOOL_LABELS,
  sidebarOpenForWorkspace,
  workspaceOf,
  toolFromHash,
} from './workspaces.js';

const ALL_TOOLS = [
  'board', 'graph', 'timeline', 'media', 'files', 'reverse', 'inspect', 'satellite', 'coordinates', 'proof', 'post', 'notebook',
  'settings',
];

describe('workspaceOf', () => {
  it('maps every tool to exactly one workspace', () => {
    for (const tool of ['board', 'graph', 'timeline', 'media', 'files', 'reverse', 'inspect', 'satellite', 'coordinates', 'proof', 'post', 'notebook']) {
      const owners = ALL_WORKSPACES.filter((w) => w.tools.includes(tool));
      expect(owners).toHaveLength(1);
      expect(workspaceOf(tool)).toBe(owners[0]);
    }
  });

  it('keeps the case off the rail: it is not a stage, it is what the stages file into', () => {
    expect(WORKSPACES.map((w) => w.id)).not.toContain('case');
    expect(WORKSPACES[0].id).toBe('collect');
    expect(workspaceOf('board')).toBe(CASE_WORKSPACE);
    expect(workspaceOf('timeline')).toBe(CASE_WORKSPACE);
  });

  it('resolves the case workspace even though the rail never lists it', () => {
    expect(ALL_WORKSPACES[0]).toBe(CASE_WORKSPACE);
    expect(ALL_WORKSPACES).toHaveLength(WORKSPACES.length + 1);
  });

  it('groups media, files and reverse search under collect', () => {
    expect(workspaceOf('media').id).toBe('collect');
    expect(workspaceOf('files').id).toBe('collect');
    expect(workspaceOf('reverse').id).toBe('collect');
  });

  it('groups satellite and coordinates under map', () => {
    expect(workspaceOf('satellite').id).toBe('map');
    expect(workspaceOf('coordinates').id).toBe('map');
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

describe('product-facing labels', () => {
  it('uses the Sources, Geo Proof and Geo Report names', () => {
    expect(WORKSPACES.find((w) => w.id === 'collect').label).toBe('Sources');
    expect(TOOL_LABELS.proof).toBe('Geo Proof');
    expect(TOOL_LABELS.post).toBe('Geo Report');
    expect(TOOL_LABELS.timeline).toBe('Timeline');
  });
});

describe('sidebarOpenForWorkspace', () => {
  it('defaults Map and Case closed, and other workspaces open', () => {
    expect(sidebarOpenForWorkspace('map')).toBe(false);
    // the board lists the same case: two lists side by side ask which is the real one
    expect(sidebarOpenForWorkspace('case')).toBe(false);
    expect(sidebarOpenForWorkspace('collect')).toBe(true);
    expect(sidebarOpenForWorkspace('examine')).toBe(true);
  });

  it('uses the remembered state instead of the workspace default', () => {
    expect(sidebarOpenForWorkspace('map', { map: true })).toBe(true);
    expect(sidebarOpenForWorkspace('collect', { collect: false })).toBe(false);
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
    // off the rail, still a workspace: #case has to keep resolving
    expect(toolFromHash('#case', ALL_TOOLS)).toBe('board');
    expect(toolFromHash('#case/timeline', ALL_TOOLS)).toBe('timeline');
  });

  it('accepts workspace/tab form', () => {
    expect(toolFromHash('#compose/post', ALL_TOOLS)).toBe('post');
    expect(toolFromHash('#compose/proof', ALL_TOOLS)).toBe('proof');
    expect(toolFromHash('#collect/files', ALL_TOOLS)).toBe('files');
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
