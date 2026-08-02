import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./ExportFolderPicker.svelte', import.meta.url), 'utf8');

describe('Export folder picker', () => {
  it('browses folders, creates one, and can return to the case default', () => {
    expect(source).toContain('roots = (await folderRoots()).roots');
    expect(source).toContain('view = await listFolder(path)');
    expect(source).toContain('const made = await createFolder(view.path, newName)');
    expect(source).toContain("onclick={() => choose('')}");
    expect(source).toContain('onclick={() => choose(view.path)}');
    expect(source).toContain("confirmLabel = 'Use this folder'");
    expect(source).toContain('{confirmLabel}');
  });

  it('does not select a folder the backend says is unwritable', () => {
    expect(source).toContain('disabled={busy || !view?.writable}');
    expect(source).toContain("Azimut can't write in that folder. Pick another one.");
  });
});
