import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const picker = readFileSync(new URL('./PointPicker.svelte', import.meta.url), 'utf8');
const tool = readFileSync(new URL('../Coordinates.svelte', import.meta.url), 'utf8');

describe('saved-point picker', () => {
  it('reads the same saved index the map panel does, on demand', () => {
    expect(tool).toContain('/satellite/index');
    // not on mount: an untouched tab asks the backend nothing
    expect(tool).toContain('async function openPicker()');
    expect(tool).toContain('let pickerRows = $state(null)');
  });

  it('offers the flat search and the My-work browse behind the "…"', () => {
    expect(picker).toContain("import FolderBrowser from '../../components/FolderBrowser.svelte'");
    expect(picker).toContain("import SearchInput from '../../components/SearchInput.svelte'");
    expect(picker).toContain('class="btn btn-ghost btn-sm browse-btn"');
    expect(picker).toContain('rootLabel="My work"');
  });

  it('lists only what carries a position', () => {
    // the picker exists to fill a coordinate field
    expect(picker).toContain('oneEach(rows).filter(isLocated)');
  });

  it('drops the proofs position, which is a mode of the map panel', () => {
    expect(picker).toContain('KINDS.filter((k) => !k.mode)');
  });

  it('stays read-only: editing saved work belongs to the map', () => {
    expect(picker).not.toContain('ondelete');
    expect(picker).not.toContain('onedit');
    expect(picker).not.toMatch(/api\.(post|put|patch|del)/);
  });

  it('bounds what it renders', () => {
    expect(picker).toContain('const CAP = 200');
    expect(picker).toContain('found.slice(0, CAP)');
    expect(picker).toContain('Showing {shown.length} of {found.length}');
  });

  it('fills the field through the same parser as typed input', () => {
    // one code path fills every notation and the sky panel below
    expect(tool).toContain('function usePoint(row)');
    expect(tool).toContain('text = `${row.lat}, ${row.lon}`');
    expect(tool).toContain('parse();');
  });

  it('asks for a case before offering the case its own points', () => {
    expect(tool).toContain("toast('Open a case to pick one of its points', 'warn')");
  });
});

describe('the look-up button', () => {
  it('is named for what it does, which is more than converting', () => {
    expect(tool).toContain("{parsing ? '…' : 'Look up'}");
    expect(tool).not.toContain('Convert');
  });
});
