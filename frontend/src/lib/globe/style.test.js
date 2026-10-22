import { describe, expect, it } from 'vitest';
import { compileLayer, evaluable, withOpacity } from './style.js';
import { BORDER_LINES } from '../map/borders.js';

const layerOf = (id) => compileLayer({ ...BORDER_LINES.layers.find((entry) => entry.id === id), source: 'borders' });

describe('the flat map’s style, read for the globe', () => {
  it('keeps the layers the globe draws and leaves the others', () => {
    expect(compileLayer({ id: 'r', type: 'raster', source: 's' })).not.toBeNull();
    expect(compileLayer({ id: 'h', type: 'hillshade', source: 's' })).toBeNull();
    expect(compileLayer({ id: 'b', type: 'background' })).toBeNull();
  });

  it('reads a filter and a paint value as the engine does', () => {
    const country = layerOf('country');
    const line = (properties) => evaluable('LineString', properties);
    expect(country.accepts(5, line({ admin_level: 2, maritime: 0, disputed: 0 }))).toBe(true);
    expect(country.accepts(5, line({ admin_level: 2, maritime: 1 }))).toBe(false);
    // the width is a zoom ramp: 1 at 2, 2.4 at 12
    expect(country.paint('line-width', 2, line({}))).toBeCloseTo(1);
    expect(country.paint('line-width', 12, line({}))).toBeCloseTo(2.4);
    expect(country.paint('line-color', 5, line({}))).toBe('rgba(242,239,230,1)');
  });

  it('reads a name as plain text, upper-cased as its layout says', () => {
    const names = layerOf('names');
    const place = evaluable('Point', { class: 'country', 'name:en': 'Yemen' });
    expect(names.layout('text-field', 5, place)).toBe('Yemen');
    expect(names.layout('text-transform', 5, place)).toBe('uppercase');
  });

  it('answers the zoom range and the visibility a layer was given', () => {
    const district = layerOf('district');
    expect(district.inRange(6)).toBe(false);
    expect(district.inRange(7)).toBe(true);
    const hidden = compileLayer({ id: 'x', type: 'line', source: 's', layout: { visibility: 'none' }, maxzoom: 10 });
    expect(hidden.visible).toBe(false);
    expect(hidden.inRange(10)).toBe(false);
  });

  it('draws a value it cannot read as unset rather than failing the frame', () => {
    const odd = compileLayer({ id: 'x', type: 'line', source: 's', paint: { 'line-width': ['get'] } });
    expect(odd.paint('line-width', 3, evaluable('LineString', {}))).toBeUndefined();
  });

  it('multiplies an opacity into a colour', () => {
    expect(withOpacity('#ff0000', 0.5)).toBe('rgba(255,0,0,0.5)');
    expect(withOpacity('rgba(0,0,255,0.5)', 0.5)).toBe('rgba(0,0,255,0.25)');
    expect(withOpacity('#00ff00', 1)).toBe('#00ff00');
  });
});
