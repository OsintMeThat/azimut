// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { splitHash } from './hash.js';
import { JOURNEYS, MENU_ITEMS } from './guide.js';
import { askApp, guideHash, isGuideTab, listenToGuide, openGuideTab, readGuidePlace } from './guideWindow.js';

const place = (hash) => readGuidePlace(splitHash(hash).params);
const workspace = MENU_ITEMS.find((entry) => entry.kind === 'workspace' && entry.tools.length > 1);
const journey = JOURNEYS.find((one) => one.result);

afterEach(() => {
  vi.restoreAllMocks();
});

describe('the guide tab address', () => {
  it('is told apart from the app by its route', () => {
    expect(isGuideTab('#guide?page=start')).toBe(true);
    expect(isGuideTab('#guide')).toBe(true);
    expect(isGuideTab('#media')).toBe(false);
    expect(isGuideTab('')).toBe(false);
  });

  it('carries a workspace tab and a journey step there and back', () => {
    const tab = { item: workspace.id, tool: workspace.tools[1], step: 0 };
    expect(place(guideHash(tab))).toEqual(tab);
    const walk = { item: `journey:${journey.id}`, tool: null, step: 2 };
    expect(place(guideHash(walk))).toEqual(walk);
  });

  it('writes no tab or step it does not need', () => {
    expect(guideHash({ item: 'start' })).toBe('#guide?page=start');
  });

  it('reaches a journey result, one step past its last', () => {
    const result = { item: `journey:${journey.id}`, tool: null, step: journey.steps.length };
    expect(place(guideHash(result))).toEqual(result);
  });

  it('falls back on what the guide has when the address was typed wrong', () => {
    expect(place('#guide?page=nowhere')).toEqual({ item: MENU_ITEMS[0].id, tool: MENU_ITEMS[0].tools[0] ?? null, step: 0 });
    expect(place(`#guide?page=${workspace.id}&tab=nowhere`).tool).toBe(workspace.tools[0]);
    for (const step of ['-1', '1.5', 'x', String(journey.steps.length + 1)]) {
      expect(place(`#guide?page=journey:${journey.id}&step=${step}`).step).toBe(0);
    }
    // a step means nothing outside a journey
    expect(place(`#guide?page=${workspace.id}&step=2`).step).toBe(0);
  });
});

describe('opening the guide tab', () => {
  it('opens one named tab on the reader’s place, so a second press reuses it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    openGuideTab({ item: workspace.id, tool: workspace.tools[1], step: 0 });
    const [url, name] = open.mock.calls[0];
    expect(url.endsWith(guideHash({ item: workspace.id, tool: workspace.tools[1] }))).toBe(true);
    expect(name).toBe('azimut-guide');
  });
});

describe('the guide asking the app', () => {
  const fakeTab = () => ({ closed: false, location: { origin: location.origin }, postMessage: vi.fn(), focus: vi.fn() });

  it('asks the tab that detached it, and brings that tab forward', () => {
    const opener = fakeTab();
    vi.spyOn(window, 'opener', 'get').mockReturnValue(opener);
    const open = vi.spyOn(window, 'open');
    askApp({ open: 'media' });
    expect(opener.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { open: 'media' } }, location.origin);
    expect(opener.focus).toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('opens the app on what was asked when no app tab is left, then asks that tab', () => {
    const closed = { ...fakeTab(), closed: true };
    vi.spyOn(window, 'opener', 'get').mockReturnValue(closed);
    const app = fakeTab();
    const open = vi.spyOn(window, 'open').mockReturnValue(app);
    askApp({ open: 'media' });
    expect(open.mock.calls[0][0].endsWith('#media')).toBe(true);
    expect(open.mock.calls[0][1]).toBe('azimut-app');
    expect(closed.postMessage).not.toHaveBeenCalled();
    askApp({ report: true });
    expect(app.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { report: true } }, location.origin);
    expect(open).toHaveBeenCalledTimes(1);
    app.closed = true; // the app tab it opened, closed in turn
  });

  it('opens Horizon for the example when no app tab is there, and asks once that tab has loaded', () => {
    vi.spyOn(window, 'opener', 'get').mockReturnValue(null);
    const app = { ...fakeTab(), addEventListener: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(app);
    askApp({ example: true });
    expect(open.mock.calls[0][0].endsWith('#horizon')).toBe(true);
    expect(app.postMessage).not.toHaveBeenCalled();
    const [event, loaded] = app.addEventListener.mock.calls[0];
    expect(event).toBe('load');
    loaded();
    expect(app.postMessage).toHaveBeenCalledWith({ 'azimut:guide': { example: true } }, location.origin);
    app.closed = true;
  });

  it('opens Settings for a report when no app tab is there to ask', () => {
    vi.spyOn(window, 'opener', 'get').mockReturnValue(null);
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    askApp({ report: true });
    expect(open.mock.calls[0][0].endsWith('#settings')).toBe(true);
  });
});

describe('the app hearing the guide', () => {
  function hear(data, origin = location.origin) {
    const open = vi.fn();
    const report = vi.fn();
    const example = vi.fn();
    const stop = listenToGuide({ tools: ['media', 'settings'], open, report, example });
    window.dispatchEvent(new MessageEvent('message', { data, origin }));
    stop();
    return { open, report, example };
  }

  it('opens the tool asked for, or the report', () => {
    expect(hear({ 'azimut:guide': { open: 'media' } }).open).toHaveBeenCalledWith('media');
    expect(hear({ 'azimut:guide': { report: true } }).report).toHaveBeenCalled();
    expect(hear({ 'azimut:guide': { example: true } }).example).toHaveBeenCalled();
  });

  it('ignores another site, a tool it does not have and anything else', () => {
    for (const heard of [
      hear({ 'azimut:guide': { open: 'media' } }, 'https://example.com'),
      hear({ 'azimut:guide': { open: 'nowhere' } }),
      hear({ 'azimut:guide': { report: 'yes' } }),
      hear({ 'azimut:guide': { example: 'yes' } }),
      hear({ open: 'media' }),
      hear('media'),
      hear(null),
    ]) {
      expect(heard.open).not.toHaveBeenCalled();
      expect(heard.report).not.toHaveBeenCalled();
      expect(heard.example).not.toHaveBeenCalled();
    }
  });

  it('stops hearing once the app lets go', () => {
    const open = vi.fn();
    listenToGuide({ tools: ['media'], open, report: vi.fn() })();
    window.dispatchEvent(new MessageEvent('message', { data: { 'azimut:guide': { open: 'media' } }, origin: location.origin }));
    expect(open).not.toHaveBeenCalled();
  });
});
