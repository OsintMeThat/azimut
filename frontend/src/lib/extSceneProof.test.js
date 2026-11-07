import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Make the proof, pressed on the extension's map panel: this tab opens Inspect's
 * chooser on the scene, its case first if another is open, through `openCase` and
 * the guards that ask about unsaved work. Nothing is written for it.
 */

const caseState = { current: { id: 'c1' }, list: [{ id: 'c1', name: 'Case one' }, { id: 'c2', name: 'Case two' }] };
const uiState = { tool: 'satellite', inspectScene: null };
const toast = vi.fn();
let started;
const openCase = vi.fn(async (id) => {
  caseState.current = { id };
  return true;
});
const refreshCaseList = vi.fn(async () => {});
vi.mock('./state.svelte.js', () => ({
  caseState, uiState, toast, openCase, refreshCaseList, sessionStarted: () => started,
}));

const { proveScene, takeSceneProof } = await import('./extSceneProof.js');

const SCENE = { caseId: 'c1', video: 'media/walk.mp4', draft: 'sc_2' };
const settle = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

beforeEach(() => {
  caseState.current = { id: 'c1' };
  Object.assign(uiState, { tool: 'satellite', inspectScene: null });
  started = Promise.resolve();
  toast.mockClear();
  openCase.mockClear();
  refreshCaseList.mockClear();
});

describe('a scene handed over by the extension', () => {
  it('opens Inspect’s Make the proof on it, in the case open', async () => {
    expect(await proveScene(SCENE)).toBe(true);
    expect(uiState).toEqual({ tool: 'inspect', inspectScene: { video: 'media/walk.mp4', draft: 'sc_2', proof: true } });
    expect(openCase).not.toHaveBeenCalled();
  });

  it('waits for the session to reopen its case, so a tab just opened does not lose it', async () => {
    let ready;
    started = new Promise((resolve) => (ready = resolve));
    caseState.current = null;
    const going = proveScene(SCENE);
    await settle();
    expect(openCase).not.toHaveBeenCalled();
    caseState.current = { id: 'c1' }; // the startup reopened it
    ready();
    expect(await going).toBe(true);
    expect(openCase).not.toHaveBeenCalled();
    expect(uiState.tool).toBe('inspect');
  });

  it('opens its case first, through the guards', async () => {
    expect(await proveScene({ ...SCENE, caseId: 'c2' })).toBe(true);
    expect(openCase).toHaveBeenCalledWith('c2');
    expect(uiState.inspectScene).toMatchObject({ proof: true });
  });

  it('stays, and says so, when the analyst keeps the case they are in', async () => {
    openCase.mockResolvedValueOnce(false);
    expect(await proveScene({ ...SCENE, caseId: 'c2' })).toBe(false);
    expect(uiState).toEqual({ tool: 'satellite', inspectScene: null });
    expect(toast).toHaveBeenCalledWith('Stayed in this case. The scene is in “Case two”', 'info');
  });

  it('says so for a case this Azimut does not hold, after reading the list again', async () => {
    expect(await proveScene({ ...SCENE, caseId: 'c9' })).toBe(false);
    expect(refreshCaseList).toHaveBeenCalled();
    expect(openCase).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith('The scene’s case is not in this Azimut', 'warn');
  });

  it('says why when the case would not open', async () => {
    openCase.mockRejectedValueOnce(new Error('case not found'));
    expect(await proveScene({ ...SCENE, caseId: 'c2' })).toBe(false);
    expect(toast).toHaveBeenCalledWith('case not found', 'danger');
  });

  it('answers at once, once per hand-off however often it is asked, and never in a map window', async () => {
    expect(takeSceneProof({ ...SCENE, id: 'h-1' })).toEqual({ ok: true });
    await settle();
    uiState.inspectScene = null;
    expect(takeSceneProof({ ...SCENE, id: 'h-1' })).toEqual({ ok: true });
    await settle();
    expect(uiState.inspectScene).toBe(null);
    uiState.tool = 'satellite';
    expect(takeSceneProof({ ...SCENE, id: 'h-2' }, { solo: true })).toEqual({
      ok: false, refused: true, error: 'a map window of Azimut makes no proof',
    });
    await settle();
    expect(uiState.tool).toBe('satellite');
  });
});
