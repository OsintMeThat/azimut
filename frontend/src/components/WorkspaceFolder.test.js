import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./WorkspaceFolder.svelte', import.meta.url), 'utf8');
const stopped = readFileSync(new URL('./WorkspaceStopped.svelte', import.meta.url), 'utf8');

describe('picking a workspace folder', () => {
  it('checks a folder before offering anything to do with it', () => {
    expect(source).toContain('inspectFolder(path)');
    expect(source).toContain('{#if verdict}');
    expect(source).toContain('{#each verdict.problems as problem}');
    expect(source).toContain('{#each verdict.warnings as warning}');
  });

  it('acts on the folder the backend resolved, not the one that was typed', () => {
    // a destination holding other files is redirected into an `Azimut` subfolder
    expect(source).toContain('useFolder(verdict.root)');
    expect(source).toContain('moveWorkspace(verdict.root)');
    expect(source).toContain('{#if verdict.nested}');
  });

  it('separates using a folder from moving into it', () => {
    expect(source).toContain('{#if can.use}');
    expect(source).toContain('{#if can.move}');
    expect(source).toContain('Use this folder');
    expect(source).toContain('Move everything here');
  });

  it('says how many cases would stay behind', () => {
    expect(source).toContain('{#if can.strands}');
    expect(source).toMatch(/Using it leaves \{can\.strands\} case/);
  });
});

describe('a move in progress', () => {
  it('polls while the backend reports one running', () => {
    expect(source).toContain("import { pollWhile } from '../lib/poll.js'");
    expect(source).toContain('if (status.moving)');
  });

  it('names the step and follows the bytes', () => {
    expect(source).toContain('moveProgress(move)');
    expect(source).toContain('{progress.label}');
    expect(source).toContain('humanBytes(move.copied_bytes)');
  });

  it('says the app is closed to other work rather than letting tools fail', () => {
    expect(source).toContain('closed to other work');
  });

  it('offers the old copy for deletion, and only after a clean move', () => {
    expect(source).toContain('{#if move?.done && !move.error && move.kept_aside}');
    expect(source).toContain('discardOldWorkspace()');
  });

  it('states that a stopped move lost nothing', () => {
    expect(source).toContain('{#if move?.error}');
    expect(source).toContain('Nothing was lost');
  });
});

describe('a folder set from the environment', () => {
  it('shows the path and hides the actions, since the env var wins every launch', () => {
    expect(source).toContain('{#if status?.environment}');
    expect(source).toContain('AZIMUT_HOME is set');
  });
});

describe('the stop screen', () => {
  it('names the folder Azimut expected and reuses the same picker', () => {
    expect(stopped).toContain("import WorkspaceFolder from './WorkspaceFolder.svelte'");
    expect(stopped).toContain('{root}');
    expect(stopped).toContain("The workspace folder isn't there");
  });

  it('says nothing was deleted or recreated', () => {
    expect(stopped).toContain('Nothing has been deleted or recreated');
  });

  it('reloads once a folder is chosen, so the app opens against the new root', () => {
    expect(stopped).toContain('onchange={() => location.reload()}');
  });

  it('tells a folder another Azimut holds from a folder that is gone', () => {
    expect(stopped).toContain("{#if reason === 'locked'}");
    expect(stopped).toContain('Another Azimut has this workspace');
    expect(stopped).toContain('{detail}');
  });

  it('says what two instances would cost, then offers to close the other one', () => {
    expect(stopped).toMatch(/lose settings and can leave a case half-migrated/);
    expect(stopped).toContain('Close the other Azimut and reload');
  });

  it('keeps the escape hatch, and warns before it', () => {
    expect(stopped).toContain('takeWorkspaceLock()');
    expect(stopped).toContain('Take it anyway');
    expect(stopped).toContain('Take it only if that Azimut is gone');
  });
});
