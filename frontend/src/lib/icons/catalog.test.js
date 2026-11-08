import { describe, expect, it } from 'vitest';
import symbols from '../map/layerSymbols.json';
import { CATALOG, PROOF_GROUPS, catalogEntry, isModel, isStampable, proofPicker, searchCatalog } from './catalog.js';
import { MODEL_META } from './modelMeta.js';
import { STAMPS } from './stamps.js';

describe('the catalogue', () => {
  it('lists every stamp, every layer symbol and every model, each id once', () => {
    const ids = CATALOG.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STAMPS) expect(catalogEntry(s.name).kind).toBe('stamp');
    for (const s of symbols) expect(catalogEntry(s.id).kind).toBe(s.id.startsWith('badge-') ? 'glyph' : 'plain');
    for (const m of MODEL_META) expect(catalogEntry(m.id).kind).toBe('model');
    expect(catalogEntry('battleship')).toBeNull();
  });

  it('keeps the three drawings of a tank apart', () => {
    expect(catalogEntry('tank').kind).toBe('stamp');
    expect(catalogEntry('badge-tank').kind).toBe('glyph');
    expect(isModel('model-tank')).toBe(true);
  });

  it('lets a proof stamp a stamp, a glyph or a model, never a plain layer marker', () => {
    expect(isStampable('tank')).toBe(true);
    expect(isStampable('badge-flame')).toBe(true);
    expect(isStampable('model-heli')).toBe(true);
    expect(isStampable('pin')).toBe(false);
    expect(isStampable('nothing')).toBe(false);
  });
});

describe('the proof picker', () => {
  const picker = proofPicker();
  const of = (group) => picker.find((g) => g.group === group).items.map((e) => e.id);

  it('files the icons under Marks, Vehicles, Events, Places and People', () => {
    expect(picker.map((g) => g.group)).toEqual(PROOF_GROUPS);
    expect(of('Marks')).toEqual(expect.arrayContaining(['point', 'nord', 'camera', 'badge-crosshair']));
    expect(of('Events')[0]).toBe('impact');
    expect(of('Events')).toContain('badge-flame');
    expect(of('Places')).toEqual(expect.arrayContaining(['building', 'antenna', 'badge-bridge']));
    expect(of('People')).toEqual(expect.arrayContaining(['person', 'badge-soldier', 'badge-group', 'badge-person-above']));
    expect(of('Events')).toEqual(expect.arrayContaining(['badge-smoke', 'badge-firing-position', 'badge-launch', 'badge-flare']));
    expect(of('Places')).toEqual(expect.arrayContaining(['badge-bunker', 'badge-trench', 'badge-fortified', 'badge-obstacles']));
  });

  it('offers every one of the eleven stamps somewhere', () => {
    const offered = picker.flatMap((g) => g.items.map((e) => e.id));
    for (const s of STAMPS) expect(offered).toContain(s.name);
  });

  it('puts the flat vehicle stamps first, then every model family by family', () => {
    const vehicles = of('Vehicles');
    expect(vehicles.slice(0, 4)).toEqual(['vehicle', 'truck', 'tank', 'drone']);
    expect(vehicles.filter((id) => id.startsWith('model-'))).toHaveLength(MODEL_META.length);
    expect(vehicles.indexOf('model-block')).toBeLessThan(vehicles.indexOf('model-car'));
    expect(vehicles.indexOf('model-car')).toBeLessThan(vehicles.indexOf('model-tank'));
    expect(vehicles.indexOf('model-tank')).toBeLessThan(vehicles.indexOf('model-heli'));
  });

  it('leaves out what a proof is better served by elsewhere', () => {
    const offered = picker.flatMap((g) => g.items.map((e) => e.id));
    // a vehicle badge stands upright in a disc; its model turns to the picture
    expect(offered).not.toContain('badge-tank');
    // a source badge says where a file came from, not what is in a picture
    expect(offered).not.toContain('badge-video');
    // the proof's own person and building are already there
    expect(offered).not.toContain('badge-user');
    expect(offered).not.toContain('badge-building');
  });
});

describe('search', () => {
  it('finds by name, id or keyword, every word required', () => {
    expect(searchCatalog('helicopter').map((e) => e.id)).toEqual(expect.arrayContaining(['model-heli', 'badge-helicopter']));
    expect(searchCatalog('anti-aircraft twin').map((e) => e.id)).toEqual(['model-aa-gun', 'model-aa-pickup']);
    expect(searchCatalog('  ')).toBe(CATALOG);
  });
});
