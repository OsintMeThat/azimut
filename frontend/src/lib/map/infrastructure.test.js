import { describe, expect, it } from 'vitest';
// The engine's own style validator, which ships inside maplibre-gl. A layer the
// engine refuses is not an error on screen: it simply draws nothing.
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { INFRASTRUCTURE, VOLTAGE_COLOUR } from './infrastructure.js';

function asStyle(spec) {
  return {
    version: 8,
    sources: Object.fromEntries(
      Object.entries(spec.sources).map(([name, url]) => [
        name,
        { type: 'vector', tiles: [url], maxzoom: spec.maxZoom },
      ])
    ),
    layers: spec.layers,
  };
}

describe('the infrastructure style', () => {
  it('is one the engine accepts, layer by layer', () => {
    expect(validateStyleMin(asStyle(INFRASTRUCTURE))).toEqual([]);
  });

  it('reads only layers Open Infrastructure Map serves from the source it names', () => {
    const served = {
      power: ['power_line', 'power_tower', 'power_substation', 'power_substation_point', 'power_plant', 'power_plant_point'],
      telecoms: ['telecoms_mast'],
      petroleum: ['petroleum_pipeline'],
    };
    for (const layer of INFRASTRUCTURE.layers) {
      expect(served[layer.source], layer.id).toContain(layer['source-layer']);
    }
  });

  it('draws buried lines apart from the ones a picture can show', () => {
    const lines = INFRASTRUCTURE.layers.filter((layer) => layer['source-layer'] === 'power_line');
    const buried = lines.find((layer) => layer.id === 'line-buried');
    expect(buried.paint['line-dasharray']).toBeTruthy();
    expect(lines.filter((layer) => layer.id !== 'line-buried').every((layer) => !layer.paint['line-dasharray'])).toBe(true);
  });

  it('colours voltage on Open Infrastructure Map’s own scale, from grey to cyan', () => {
    expect(VOLTAGE_COLOUR[2]).toBe('#7A7A85');
    expect(VOLTAGE_COLOUR.at(-1)).toBe('#00C1CF');
    expect(VOLTAGE_COLOUR.at(-2)).toBe(550);
  });

  it('asks for tiles from Open Infrastructure Map over https and nothing else', () => {
    for (const url of Object.values(INFRASTRUCTURE.sources)) {
      expect(url).toMatch(/^https:\/\/openinframap\.org\/map\/[a-z]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    }
  });
});
