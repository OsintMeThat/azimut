// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { flushSync, mount, tick, unmount } from 'svelte';
import ProofPointMenu from './ProofPointMenu.svelte';
import ProofPointLayers from './ProofPointLayers.svelte';

vi.mock('../../lib/api.js', () => ({ api: { get: vi.fn(async () => ({ colours: [] })), put: vi.fn() } }));

let held;
afterEach(() => { if (held) unmount(held); held = null; document.body.innerHTML = ''; });
const front = { name: 'front', title: 'Front', styles: [{ symbol: 'flag', colour: '#d55e00' }, { symbol: 'star', colour: '#009e73' }], groups: [
  { id: 'g1', name: 'Positions', mode: 'individual', colour: '#0072b2', symbol: 'pin' },
  { id: 'g2', name: 'Checkpoints', mode: 'uniform', colour: '#009e73', symbol: 'star' }] };
const strikes = { name: 'strikes', title: 'Strikes', styles: [], groups: [{ id: 's', name: 'Markers', mode: 'uniform', symbol: 'star', colour: '#009e73' }] };
const sites = { name: 'sites', title: 'Sites', styles: [], groups: [{ id: 'm', name: 'Markers', mode: 'individual', symbol: 'pin', colour: '#cc79a7' }] };
const item = (label) => [...document.querySelectorAll('.fm-item')].find((node) => node.textContent.trim() === label);
const back = () => document.querySelector('.step-back');
function show(component, props) { held = mount(component, { target: document.body, props }); flushSync(); }
const open = (index = 0) => { document.querySelector(`[aria-label="Point ${index + 1} actions"]`).click(); flushSync(); };
const menu = (props) => show(ProofPointMenu, { index: 0, coords: '48.85, 2.29', targets: [front, strikes, sites], onadd: vi.fn(), oncreate: vi.fn(), oncheck: vi.fn(), ...props });

describe('a proof point’s menu', () => {
  it('goes from the layer to its group, and adds at once to a group with one style', () => {
    const onadd = vi.fn();
    menu({ onadd });
    open();
    const box = document.querySelector('[aria-label="Point 1 actions"][role="menu"]');
    // portalled out of the narrow side panel, so nothing cuts it
    expect(box.parentElement).toBe(document.body);
    expect([...document.querySelectorAll('.targets .fm-item')].map((node) => node.textContent.trim())).toEqual(['Front', 'Strikes', 'Sites']);
    item('Front').click(); flushSync();
    expect(back().textContent).toBe('Front');
    expect([...document.querySelectorAll('.fm-item')].map((node) => node.textContent.trim())).toEqual(['Positions', 'Checkpoints']);
    item('Checkpoints').click(); flushSync();
    expect(onadd).toHaveBeenCalledWith({ layer: front, group: front.groups[1], style: null });
    expect(document.querySelector('[role="menu"]')).toBeNull();
    // a layer of one group with one style: one press
    open(); item('Strikes').click(); flushSync();
    expect(onadd).toHaveBeenLastCalledWith({ layer: strikes, group: strikes.groups[0], style: null });
  });

  it('asks for the icon and colour of a marker in a group where each has its own', () => {
    const onadd = vi.fn();
    menu({ onadd });
    open();
    item('Front').click(); flushSync();
    item('Positions').click(); flushSync();
    expect(back().textContent).toBe('Front › Positions');
    // the layer's own styles first, then any icon in any colour
    document.querySelector('[aria-label="Point icon as Flag in #d55e00"]').click(); flushSync();
    document.querySelector('[aria-label="Point icon Vessel icon"]').click(); flushSync();
    const add = [...document.querySelectorAll('.add-row button')][0];
    expect(add.textContent.trim()).toBe('Add to Positions');
    add.click(); flushSync();
    expect(onadd).toHaveBeenCalledWith({ layer: front, group: front.groups[0], style: { symbol: 'badge-ship', colour: '#d55e00' } });
    // back steps up one level at a time
    open(); item('Sites').click(); flushSync();
    expect(back().textContent).toBe('Sites');
    expect(document.querySelector('[aria-label="Point icon Vessel icon"]')).toBeTruthy();
    back().click(); flushSync();
    expect(item('Front')).toBeTruthy();
  });

  it('ticks where the point already is and does not offer the same group twice', () => {
    menu({ held: new Set(['strikes|s', 'front|g2']) });
    open();
    expect(item('Strikes').disabled).toBe(true);
    expect(item('Front').disabled).toBe(false);
    expect(item('Front').querySelector('.fm-tick')).toBeTruthy();
    item('Front').click(); flushSync();
    expect(item('Checkpoints').disabled).toBe(true);
    expect(item('Positions').disabled).toBe(false);
  });

  it('makes a new layer and opens it to pick the marker', async () => {
    // the list is read again before the new layer's name comes back
    const oncreate = vi.fn(async () => 'sites');
    menu({ index: 1, unsaved: true, oncreate, targets: [front, sites] });
    open(1);
    expect(document.body.textContent).toContain('The proof is saved first, so the layer follows what it says.');
    item('New layer…').click(); flushSync();
    const name = document.querySelector('[aria-label="New layer name"]');
    name.value = 'Sites'; name.dispatchEvent(new Event('input', { bubbles: true })); flushSync();
    name.closest('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await tick(); await tick(); flushSync();
    expect(oncreate).toHaveBeenCalledWith('Sites');
    expect(back().textContent).toBe('Sites');
  });

  it.each([
    [{ coords: '' }, 'Write the point first.'],
    [{ canSave: false }, 'Add a picture first. The proof is saved before its point joins a layer.'],
  ])('says what is missing before a point can join a layer (%#)', (props, note) => {
    menu(props);
    open();
    expect(document.querySelector('.fm-note').textContent).toBe(note);
    expect(item('Strikes')).toBeUndefined();
  });

  it('sends a proposed point to the map to be checked first', () => {
    const oncheck = vi.fn();
    menu({ proposed: true, oncheck });
    open();
    item('Check this point on the map first').click();
    expect(oncheck).toHaveBeenCalledOnce();
  });

  it('raises a later point to the conclusion or removes it, never the first', () => {
    const onraise = vi.fn(), onremove = vi.fn();
    menu({ index: 2, onraise, onremove });
    open(2);
    item('Make it the conclusion').click(); flushSync();
    open(2);
    item('Remove this point').click();
    expect([onraise.mock.calls.length, onremove.mock.calls.length]).toEqual([1, 1]);
    unmount(held); held = null; document.body.innerHTML = '';
    menu({});
    open();
    expect(item('Make it the conclusion')).toBeUndefined();
  });
});

describe('the layers under a point', () => {
  it('names each layer the point is in, opens it, and takes it back out', () => {
    const onopen = vi.fn(), onremove = vi.fn();
    const places = [{ layer: front, group: front.groups[1], marker: { key: 'a' } }, { layer: strikes, group: strikes.groups[0], marker: { key: 'b' } }];
    show(ProofPointLayers, { places, onopen, onremove });
    expect([...document.querySelectorAll('.where')].map((node) => node.textContent)).toEqual(['In Front › Checkpoints', 'In Strikes']);
    document.querySelector('.open').click();
    expect(onopen).toHaveBeenCalledWith(places[0]);
    document.querySelector('[aria-label="Take it out of Strikes"]').click();
    expect(onremove).toHaveBeenCalledWith(places[1]);
  });
});
