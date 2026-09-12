import { describe, it, expect } from 'vitest';
import {
  ALL_WORKSPACES,
  CASE_WORKSPACE,
  HOME_WORKSPACE,
  WORKSPACES,
  TOOL_LABELS,
  sidebarOpenForWorkspace,
  workspaceOf,
  toolFromHash,
} from './workspaces.js';

const ALL_TOOLS = [
  'overview', 'guide',
  'board', 'graph', 'timeline', 'sheet', 'media', 'files', 'reverse', 'inspect', 'satellite', 'coordinates', 'proof', 'post', 'notebook',
  'settings',
];

describe('workspaceOf', () => {
  it('maps every tool to exactly one workspace', () => {
    for (const tool of ['overview', 'guide', 'board', 'graph', 'timeline', 'sheet', 'media', 'files', 'reverse', 'inspect', 'satellite', 'coordinates', 'proof', 'post', 'notebook']) {
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

  it('resolves the two workspaces the rail never lists', () => {
    // the rail is a sequence of stages; neither home nor the case is one, so both
    // hang off the topbar and both still have to resolve as workspaces
    expect(ALL_WORKSPACES).toContain(HOME_WORKSPACE);
    expect(ALL_WORKSPACES).toContain(CASE_WORKSPACE);
    expect(ALL_WORKSPACES).toHaveLength(WORKSPACES.length + 2);
  });

  it('keeps home off the rail too, on the mark rather than a fifth seat', () => {
    expect(WORKSPACES.map((w) => w.id)).not.toContain('home');
    expect(workspaceOf('overview')).toBe(HOME_WORKSPACE);
    expect(workspaceOf('guide')).toBe(HOME_WORKSPACE);
    // two tabs, so the strip draws itself: the overview for somebody who has been
    // here, the guide for somebody who has not
    expect(HOME_WORKSPACE.tools).toEqual(['overview', 'guide']);
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
    // the tab is the overview; "Home" is the workspace the mark opens
    expect(TOOL_LABELS.overview).toBe('Overview');
    expect(TOOL_LABELS.guide).toBe('Guide');
  });
});

describe('sidebarOpenForWorkspace', () => {
  it('defaults Map, Case and Home closed, and other workspaces open', () => {
    expect(sidebarOpenForWorkspace('map')).toBe(false);
    // the board lists the same case: two lists side by side ask which is the real one
    expect(sidebarOpenForWorkspace('case')).toBe(false);
    // home is read rather than worked in, and its whole subject is the case the
    // sidebar would be listing again
    expect(sidebarOpenForWorkspace('home')).toBe(false);
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
    // off the rail, still a workspace: #case and #home have to keep resolving
    expect(toolFromHash('#case', ALL_TOOLS)).toBe('board');
    expect(toolFromHash('#case/timeline', ALL_TOOLS)).toBe('timeline');
    expect(toolFromHash('#home', ALL_TOOLS)).toBe('overview');
    expect(toolFromHash('#home/guide', ALL_TOOLS)).toBe('guide');
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
