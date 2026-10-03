// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caseState, uiState } from './state.svelte.js';
import { joinOverlays } from './overlayStack.js';
import {
  anyUnsaved, caseShown, holdsUnsaved, installBackButton, onBackForward, settlePlace, showTool,
} from './backButton.js';

const TOOLS = ['overview', 'files', 'sheet', 'proof', 'satellite'];
let uninstall;
let push;
let replace;

/** Where the browser is, the way Back would leave it: an address and the state the
 *  entry was written with. */
function backTo(hash, state) {
  history.replaceState(state, '', hash);
  window.dispatchEvent(new PopStateEvent('popstate', { state }));
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
const entry = (caseId = 'c1') => ({ azimut: 1, case: caseId });

beforeEach(() => {
  caseState.current = { id: 'c1' };
  uiState.tool = 'overview';
  history.replaceState(null, '', '#overview');
  uninstall = installBackButton(TOOLS);
  push = vi.spyOn(history, 'pushState');
  replace = vi.spyOn(history, 'replaceState');
});

afterEach(() => {
  uninstall();
  vi.restoreAllMocks();
});

describe('changing tool', () => {
  it('is an entry Back returns to', () => {
    uiState.tool = 'files';
    showTool('files');
    expect(push).toHaveBeenCalledWith(entry(), '', '#files');
    expect(location.hash).toBe('#files');
  });

  it('only settles the address when the app opens, or in a tab that is one tool', () => {
    showTool('files', { first: true });
    showTool('proof', { solo: true });
    expect(push).not.toHaveBeenCalled();
    expect(location.hash).toBe('#proof');
  });

  it('writes nothing when Back or a link already names the tool', () => {
    showTool('overview');
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('carries the place the tool was left at', () => {
    settlePlace('files', { folder: 'Sources/Telegram' });
    showTool('files');
    expect(location.hash).toBe('#files?folder=Sources%2FTelegram');
  });
});

describe('a place inside a tool', () => {
  beforeEach(() => {
    uiState.tool = 'files';
    history.replaceState(entry(), '', '#files');
    replace.mockClear();
  });

  it('is an entry when the analyst goes there, and rewrites the entry otherwise', () => {
    window.dispatchEvent(new Event('pointerdown'));
    settlePlace('files', { folder: 'A' }, { navigate: true });
    expect(push).toHaveBeenCalledTimes(1);
    settlePlace('files', { folder: 'A renamed' });
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#files?folder=A+renamed');
  });

  it('writes nothing when it is already the address', () => {
    settlePlace('files', { folder: '' });
    settlePlace('files', {}, { navigate: true });
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it('is the same move as the switch that brought the tool, when nothing was pressed between', () => {
    uiState.tool = 'proof';
    showTool('proof');
    settlePlace('proof', { proof: 'convoy' }, { navigate: true });
    expect(push).toHaveBeenCalledTimes(1);
    expect(location.hash).toBe('#proof?proof=convoy');
  });

  it('is its own entry once the analyst pressed something after the switch', () => {
    uiState.tool = 'proof';
    showTool('proof');
    window.dispatchEvent(new Event('pointerdown'));
    settlePlace('proof', { proof: 'convoy' }, { navigate: true });
    expect(push).toHaveBeenCalledTimes(2);
  });

  it('is never written by a tool that is not on screen', () => {
    settlePlace('sheet', { sheet: 's1' }, { navigate: true });
    expect(location.hash).toBe('#files');
  });

  it('never adds an entry across a case switch', () => {
    caseState.current = { id: 'c2' };
    window.dispatchEvent(new Event('pointerdown'));
    settlePlace('files', { folder: 'B' }, { navigate: true });
    expect(push).not.toHaveBeenCalled();
    expect(history.state).toEqual(entry('c2'));
  });

  it('keeps the order the tool wrote, and ignores it when comparing', () => {
    settlePlace('satellite', { ll: '1,2', z: '5' });
    uiState.tool = 'satellite';
    history.replaceState(entry(), '', '#satellite?z=5&ll=1%2C2');
    replace.mockClear();
    settlePlace('satellite', { ll: '1,2', z: '5' });
    expect(replace).not.toHaveBeenCalled();
  });
});

describe('Back and Forward', () => {
  it('brings back the tool and the place it was at', async () => {
    const apply = vi.fn(() => true);
    onBackForward('files', apply);
    backTo('#files?folder=A', entry());
    await settle();
    expect(uiState.tool).toBe('files');
    expect(apply).toHaveBeenCalledWith({ folder: 'A' });
  });

  it('changes only the tool when the entry belongs to another case', async () => {
    const apply = vi.fn(() => true);
    onBackForward('files', apply);
    backTo('#files?folder=A', entry('other'));
    await settle();
    expect(uiState.tool).toBe('files');
    expect(apply).not.toHaveBeenCalled();
  });

  it('puts the address back on a tool that stayed, keeping the entry it came from', async () => {
    uiState.tool = 'proof';
    settlePlace('proof', { proof: 'edited' });
    onBackForward('proof', () => false);
    backTo('#proof?proof=older', entry());
    await settle();
    expect(push).toHaveBeenLastCalledWith(entry(), '', '#proof?proof=edited');
  });

  it('names where the tool landed when it could not go exactly there', async () => {
    uiState.tool = 'files';
    onBackForward('files', () => {
      settlePlace('files', { folder: 'Parent' }, { navigate: true });
      return true;
    });
    backTo('#files?folder=Parent%2FGone', entry());
    await settle();
    expect(push).not.toHaveBeenCalled();
    expect(location.hash).toBe('#files?folder=Parent');
  });

  it('waits for a tool that has not loaded yet', async () => {
    backTo('#sheet?sheet=s1', entry());
    await settle();
    expect(uiState.tool).toBe('sheet');
    const apply = vi.fn(() => true);
    onBackForward('sheet', apply);
    await settle();
    expect(apply).toHaveBeenCalledWith({ sheet: 's1' });
  });

  it('lets a later Back overtake one still waiting on an answer', async () => {
    uiState.tool = 'proof';
    settlePlace('proof', { proof: 'current' });
    let answer;
    onBackForward('proof', (to) => (to.proof === 'first' ? new Promise((r) => (answer = r)) : true));
    backTo('#proof?proof=first', entry());
    await settle();
    backTo('#proof', entry());
    await settle();
    answer(false);
    await settle();
    expect(push).not.toHaveBeenCalled();
  });

  it('ends the switch a move would have joined: a folder opened after Forward is a step', async () => {
    uiState.tool = 'proof';
    history.replaceState(entry(), '', '#proof');
    uiState.tool = 'files';
    showTool('files');
    backTo('#proof', entry());
    backTo('#files', entry());
    await settle();
    settlePlace('files', { folder: 'A' }, { navigate: true });
    expect(push).toHaveBeenCalledTimes(2);
  });
});

describe('Back on an open dialog', () => {
  it('closes the dialog, as Escape would, and keeps the tool where it is', async () => {
    uiState.tool = 'proof';
    settlePlace('proof', { proof: 'convoy' });
    history.replaceState(entry(), '', '#proof?proof=convoy');
    const apply = vi.fn(() => true);
    onBackForward('proof', apply);
    const close = vi.fn();
    const leave = joinOverlays({}, close);
    backTo('#files', entry());
    await settle();
    leave();
    expect(close).toHaveBeenCalledTimes(1);
    expect(uiState.tool).toBe('proof');
    expect(apply).not.toHaveBeenCalled();
    expect(push).toHaveBeenLastCalledWith(entry(), '', '#proof?proof=convoy');
  });
});

describe('an address typed or followed from a link', () => {
  it('closes an open dialog and goes where it says', async () => {
    uiState.tool = 'settings';
    history.replaceState(entry(), '', '#settings');
    const close = vi.fn();
    const leave = joinOverlays({}, close);
    backTo('#files', null);
    await settle();
    leave();
    expect(close).toHaveBeenCalledTimes(1);
    expect(uiState.tool).toBe('files');
    expect(push).not.toHaveBeenCalled();
  });
});

describe('a case opened', () => {
  it('makes the entry on screen belong to it', () => {
    history.replaceState(entry('c1'), '', '#files');
    caseState.current = { id: 'c2' };
    caseShown();
    expect(history.state).toEqual(entry('c2'));
    expect(location.hash).toBe('#files');
  });
});

describe('leaving Azimut', () => {
  const unload = () => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event;
  };

  it('asks while a tool holds unsaved work', () => {
    let dirty = true;
    holdsUnsaved('proof', () => dirty);
    expect(anyUnsaved()).toBe(true);
    expect(unload().defaultPrevented).toBe(true);
    dirty = false;
    expect(unload().defaultPrevented).toBe(false);
  });

  it('lets go once the tool stops declaring it', () => {
    const stop = holdsUnsaved('post', () => true);
    stop();
    expect(anyUnsaved()).toBe(false);
  });

  it('does not let a tool that cannot answer hold the page', () => {
    holdsUnsaved('sheet', () => {
      throw new Error('gone');
    });
    expect(anyUnsaved()).toBe(false);
  });
});
