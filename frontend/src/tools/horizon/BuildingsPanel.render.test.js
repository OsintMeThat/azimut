// @vitest-environment happy-dom
/**
 * The Buildings settings panel, mounted over a plain stand-in for the state.
 *
 * Every control calls the state's set() with the one patch it means, the
 * alignment reset and the cache clear are their own calls, and the data lines
 * say where the footprints and heights come from.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import BuildingsPanel from './BuildingsPanel.svelte';
import { DEFAULTS } from '../../lib/horizon/buildings.js';

let live = [];

function buildings(over = {}) {
  return {
    settings: { ...DEFAULTS, sources: { ...DEFAULTS.sources }, shift: [0, 0], lean: [0, 0], ...over.settings },
    set: vi.fn(),
    resetAlignment: vi.fn(),
    clearCache: vi.fn(async () => {}),
    creditLines: [
      { id: 'ign', text: 'IGN (France), Licence Ouverte 2.0, 2010–2026', link: 'https://geoservices.ign.fr/bdtopo' },
      { id: 'osm', text: 'OpenStreetMap, ODbL, 2026', link: 'https://www.openstreetmap.org/copyright' },
    ],
    summaryText: '',
    busy: false,
    ...over,
  };
}

function render(props) {
  const target = document.createElement('div');
  document.body.append(target);
  live.push(mount(BuildingsPanel, { target, props }));
  flushSync();
  return target;
}

const button = (root, name) => [...root.querySelectorAll('button')].find((b) => b.textContent.trim() === name);
const slider = (root, label) => root.querySelector(`input[type="range"][aria-label="${label}"]`);

afterEach(() => {
  for (const component of live) unmount(component);
  live = [];
  document.body.innerHTML = '';
});

describe('the Buildings settings panel', () => {
  it('names itself and closes with its × button', () => {
    const onclose = vi.fn();
    const root = render({ buildings: buildings(), onclose });
    expect(root.querySelector('section[aria-label="Buildings settings"]')).not.toBeNull();
    root.querySelector('button[aria-label="Close"]').click();
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('picks the radius around the eye', () => {
    const state = buildings();
    const root = render({ buildings: state });
    expect(button(root, '2 km').getAttribute('aria-pressed')).toBe('true');
    button(root, '5 km').click();
    expect(state.set).toHaveBeenCalledWith({ radius: 5000 });
  });

  it('unticks a source by passing the whole sources object', () => {
    const state = buildings();
    const root = render({ buildings: state });
    const osm = [...root.querySelectorAll('label.check')].find((l) => l.textContent.includes('OpenStreetMap'));
    const box = osm.querySelector('input[type="checkbox"]');
    expect(box.checked).toBe(true);
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.set).toHaveBeenCalledWith({ sources: { ign: true, osm: false, globfp: true } });
  });

  it('says the Fit and the source rule in plain lines', () => {
    const root = render({ buildings: buildings() });
    expect(root.textContent).toContain('The Fit ignores buildings for now.');
    expect(root.textContent).toContain('Footprints come from the IGN where it has them');
  });

  it('hides the unknown heights', () => {
    const state = buildings();
    const root = render({ buildings: state });
    expect(button(root, 'Draw at 6 m').getAttribute('aria-pressed')).toBe('true');
    button(root, 'Hide').click();
    expect(state.set).toHaveBeenCalledWith({ unknown: 'hide' });
  });

  it('tints doubtful heights, with a legend for both kinds', () => {
    const state = buildings();
    const root = render({ buildings: state });
    const tint = [...root.querySelectorAll('label.check')].find((l) => l.textContent.includes('Tint doubtful heights'));
    const box = tint.querySelector('input');
    box.checked = false;
    box.dispatchEvent(new Event('change', { bubbles: true }));
    expect(state.set).toHaveBeenCalledWith({ showKinds: false });
    expect(root.textContent).toContain('range of storeys');
    expect(root.textContent).toContain('unknown');
  });

  it('switches roofs and look', () => {
    const state = buildings();
    const root = render({ buildings: state });
    button(root, 'Satellite photo').click();
    expect(state.set).toHaveBeenLastCalledWith({ roofs: 'photo' });
    const edges = button(root, 'Edges only');
    expect(edges.title).toBe("Edges only: the buildings' outlines, for laying a photo over them");
    edges.click();
    expect(state.set).toHaveBeenLastCalledWith({ look: 'outline' });
  });

  it('lines the picture up by the slider, in metres', () => {
    const state = buildings();
    const root = render({ buildings: state });
    const east = slider(root, 'Shift east');
    expect(east.min).toBe('-15');
    expect(east.max).toBe('15');
    expect(east.step).toBe('0.5');
    east.value = '3.5';
    east.dispatchEvent(new Event('input', { bubbles: true }));
    expect(state.set).toHaveBeenLastCalledWith({ shift: [3.5, 0] });
  });

  it('edits the lean as metres per 10 m of height', () => {
    const state = buildings();
    const root = render({ buildings: state });
    const lean = slider(root, 'Lean east');
    expect(lean.min).toBe('-8');
    expect(lean.max).toBe('8');
    lean.value = '2';
    lean.dispatchEvent(new Event('input', { bubbles: true }));
    expect(state.set).toHaveBeenLastCalledWith({ lean: [0.2, 0] });
  });

  it('resets the alignment, and says only the picture moves', () => {
    const state = buildings();
    const root = render({ buildings: state });
    expect(root.textContent).toContain('Only the picture moves; the buildings keep their coordinates.');
    button(root, 'Reset').click();
    expect(state.resetAlignment).toHaveBeenCalledTimes(1);
  });

  it('links each credit to its source', () => {
    const root = render({ buildings: buildings() });
    const links = [...root.querySelectorAll('a')];
    expect(links.map((a) => a.textContent)).toEqual([
      'IGN (France), Licence Ouverte 2.0, 2010–2026',
      'OpenStreetMap, ODbL, 2026',
    ]);
    expect(links[0].getAttribute('href')).toBe('https://geoservices.ign.fr/bdtopo');
    expect(links[0].target).toBe('_blank');
    expect(links[0].rel).toBe('noopener noreferrer');
  });

  it('clears the downloaded buildings, and cannot while busy', () => {
    const state = buildings();
    const root = render({ buildings: state });
    button(root, 'Clear downloaded buildings').click();
    expect(state.clearCache).toHaveBeenCalledTimes(1);

    const busy = render({ buildings: buildings({ busy: true }) });
    expect(button(busy, 'Clear downloaded buildings').disabled).toBe(true);
  });
});
