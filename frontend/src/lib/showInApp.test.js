// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./state.svelte.js', () => ({ uiState: { tool: 'overview', guide: null }, toast: vi.fn() }));

const { toast, uiState } = await import('./state.svelte.js');
const { joinOverlays } = await import('./overlayStack.js');
const { pointing, showInApp, stopPointing } = await import('./showInApp.svelte.js');

const STEP = { tool: 'satellite', anchor: 'sat.place', label: 'Place', press: 'Open a place, then press Place' };

/** A control drawn under `anchor` at `box`, as the app would lay it out (happy-dom lays out nothing). */
function control(anchor, box = { left: 100, top: 100, width: 80, height: 28 }) {
  const element = document.createElement('button');
  element.setAttribute('data-guide', anchor);
  element.getBoundingClientRect = () => ({ ...box, right: box.left + box.width, bottom: box.top + box.height });
  element.scrollIntoView = vi.fn();
  document.body.append(element);
  return element;
}

beforeEach(() => {
  vi.useFakeTimers();
  uiState.tool = 'overview';
  uiState.guide = { at: 'journey:geolocate' };
  toast.mockClear();
  window.innerWidth = 1280;
  window.innerHeight = 800;
});

afterEach(() => {
  stopPointing();
  vi.useRealTimers();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('showing a step in the app', () => {
  it('closes the guide and opens the step’s tool', () => {
    showInApp(STEP);
    expect(uiState.guide).toBeNull();
    expect(uiState.tool).toBe('satellite');
  });

  it('opens the case panel on the view a control stands in, and leaves the view kept as it was', () => {
    uiState.sidebarOpen = false;
    uiState.sidebarView = 'folders';
    localStorage.setItem('azimut:sidebarView', 'folders');
    showInApp({ ...STEP, anchor: 'todo.go', sidebar: 'todo' });
    expect(uiState.sidebarOpen).toBe(true);
    expect(uiState.sidebarView).toBe('todo');
    expect(localStorage.getItem('azimut:sidebarView')).toBe('folders');
    showInApp(STEP);
    expect(uiState.sidebarView).toBe('todo');
  });

  it('opens Settings on the section a control stands in', () => {
    uiState.settingsTab = null;
    showInApp({ tool: 'settings', anchor: 'settings.hub-hosting', settings: 'website' });
    expect(uiState.tool).toBe('settings');
    expect(uiState.settingsTab).toBe('website');
  });

  it('lights the control once the tool has drawn it, by the name the step gives it', async () => {
    const lit = showInApp(STEP);
    await vi.advanceTimersByTimeAsync(500);
    expect(pointing.at).toBeNull();
    const place = control('sat.place');
    await vi.advanceTimersByTimeAsync(300);
    expect(await lit).toBe(place);
    expect(pointing.at).toEqual({ element: place, label: 'Place' });
    expect(toast).not.toHaveBeenCalled();
  });

  it('waits for the control to hold still, so the ring lands where it ends up', async () => {
    const place = control('sat.place');
    let top = 0;
    place.getBoundingClientRect = () => ({ left: 10, top, width: 80, height: 28, right: 90, bottom: top + 28 });
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(100);
    top = 60; // the tool still laying itself out
    await vi.advanceTimersByTimeAsync(100);
    expect(pointing.at).toBeNull();
    await vi.advanceTimersByTimeAsync(100);
    expect(pointing.at.element).toBe(place);
  });

  it('passes over a copy kept in a tool out of sight', async () => {
    control('sat.place', { left: 0, top: 0, width: 0, height: 0 });
    const unseen = control('sat.place');
    unseen.style.visibility = 'hidden';
    const shown = control('sat.place', { left: 300, top: 200, width: 60, height: 24 });
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(shown);
  });

  it('names the control by what to press when the step gives no name', async () => {
    control('sat.place');
    showInApp({ ...STEP, label: '' });
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.label).toBe(STEP.press);
  });

  it('leaves the tool as it is for a control the app always shows', async () => {
    const goTo = control('start.goto');
    showInApp({ anchor: 'start.goto', label: 'Go to', press: 'Press Go to' });
    expect(uiState.tool).toBe('overview');
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(goTo);
  });
});

describe('a control not on screen', () => {
  it('says what to press instead, after a few seconds', async () => {
    const lit = showInApp(STEP);
    await vi.advanceTimersByTimeAsync(2900);
    expect(toast).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(200);
    expect(await lit).toBeNull();
    expect(toast).toHaveBeenCalledWith(STEP.press, 'info', 6000);
    expect(pointing.at).toBeNull();
  });

  it('lights nothing under a dialog, and lights the control once the dialog is gone', async () => {
    const place = control('sat.place');
    const leave = joinOverlays({});
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(1000);
    expect(pointing.at).toBeNull();
    leave();
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(place);
  });

  it('says nothing once the reader has gone to another tool', async () => {
    const lit = showInApp(STEP);
    await vi.advanceTimersByTimeAsync(200);
    uiState.tool = 'media';
    control('sat.place');
    await vi.advanceTimersByTimeAsync(3000);
    expect(await lit).toBeNull();
    expect(pointing.at).toBeNull();
    expect(toast).not.toHaveBeenCalled();
  });

  it('gives way to a later ask', async () => {
    const first = showInApp(STEP);
    const second = showInApp({ tool: 'satellite', anchor: 'sat.search', label: 'Search', press: 'Press Search' });
    const search = control('sat.search');
    await vi.advanceTimersByTimeAsync(3500);
    expect(await first).toBeNull();
    expect(await second).toBe(search);
    expect(pointing.at.label).toBe('Search');
    expect(toast).not.toHaveBeenCalled();
  });

  it('waits for a tab behind the detached guide to come in front before looking', async () => {
    const state = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(toast).not.toHaveBeenCalled();
    state.mockReturnValue('visible');
    const place = control('sat.place');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(place);
  });
});

describe('bringing the control into view', () => {
  it('scrolls to a control the window cuts off, and only then', async () => {
    const low = control('sat.place', { left: 100, top: 1400, width: 80, height: 28 });
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(low.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'nearest', inline: 'nearest' }));

    document.body.innerHTML = '';
    const seen = control('sat.place');
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(seen);
    expect(seen.scrollIntoView).not.toHaveBeenCalled();
  });

  it('scrolls a panel that holds the control below its fold', async () => {
    const panel = document.createElement('div');
    panel.style.overflowY = 'auto';
    panel.getBoundingClientRect = () => ({ left: 0, top: 0, width: 300, height: 300, right: 300, bottom: 300 });
    document.body.append(panel);
    const deep = control('sat.place', { left: 20, top: 420, width: 80, height: 28 });
    panel.append(deep);
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(deep.scrollIntoView).toHaveBeenCalled();
  });

  it('does not scroll for a panel taller than the window, already in it', async () => {
    const rail = control('start.stages', { left: 0, top: 44, width: 64, height: 1200 });
    showInApp({ anchor: 'start.stages', label: 'Stages', press: '' });
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at.element).toBe(rail);
    expect(rail.scrollIntoView).not.toHaveBeenCalled();
  });

  it('jumps rather than glides for a reader who asked for less motion', async () => {
    vi.stubGlobal('matchMedia', () => ({ matches: true }));
    const low = control('sat.place', { left: 100, top: 1400, width: 80, height: 28 });
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    vi.unstubAllGlobals();
    expect(low.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: 'auto' }));
  });
});

describe('the pointer going', () => {
  it('goes on its way out, and a new ask clears the last one at once', async () => {
    control('sat.place');
    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at).not.toBeNull();
    stopPointing();
    expect(pointing.at).toBeNull();

    showInApp(STEP);
    await vi.advanceTimersByTimeAsync(300);
    expect(pointing.at).not.toBeNull();
    showInApp({ ...STEP, anchor: 'sat.search' });
    expect(pointing.at).toBeNull();
  });
});
