import { describe, expect, it, vi } from 'vitest';
import { endExport, exportSays, exportShare, plateExport, startExport, stopExport } from './exportRun.svelte.js';

describe('the plate export under way', () => {
  it('says what it draws and how far, stops on demand, and is gone once ended', () => {
    const stop = vi.fn();
    startExport('Front, October', 'case-1', stop);
    expect(plateExport).toMatchObject({ running: true, name: 'Front, October', caseId: 'case-1', said: '' });
    expect(exportShare(plateExport)).toBeNull();
    exportSays('Drawing 3 Oct (2 of 4)…', 1, 4);
    expect(exportShare(plateExport)).toBe(25);
    stopExport();
    expect(stop).toHaveBeenCalledOnce();
    endExport();
    expect(plateExport.running).toBe(false);
    // nothing to stop once it is over
    stopExport();
    expect(stop).toHaveBeenCalledOnce();
  });
});
