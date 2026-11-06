import { describe, expect, it } from 'vitest';
import { DEM_NOTICE, normaliseAttribution } from './copernicusCredit.js';

const NOTICE = 'Contains modified Copernicus Sentinel data';
const DEM = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 '
  + 'provided under COPERNICUS by the European Union and ESA; all rights reserved';

describe('the credit Copernicus data carries', () => {
  it('dates the notice the backend lists from the pass a map shows', () => {
    expect(normaliseAttribution(NOTICE, 'sentinel2~TRUE_COLOR~2026-05-12~2026-05-12~CC30')).toBe(`${NOTICE} 2026`);
    expect(normaliseAttribution(NOTICE, 'sentinel1~2024-10-06~151800')).toBe(`${NOTICE} 2024`);
    expect(normaliseAttribution(NOTICE, '2023-08-08')).toBe(`${NOTICE} 2023`);
  });

  it('names both years of a window across New Year, and the span of a series', () => {
    expect(normaliseAttribution(NOTICE, 'sentinel2~SWIR~2025-12-20~2026-01-10')).toBe(`${NOTICE} 2025-2026`);
    expect(normaliseAttribution(NOTICE, ['2019-06-01', '2022-06-01', '2020-01-01'])).toBe(`${NOTICE} 2019-2022`);
  });

  it('says no year when none is known rather than a wrong one', () => {
    expect(normaliseAttribution(NOTICE, 'sentinel2')).toBe(NOTICE);
    expect(normaliseAttribution(NOTICE, undefined)).toBe(NOTICE);
    // a layer whose name holds digits names no year
    expect(normaliseAttribution(NOTICE, 'sentinel2~LAYER_2020')).toBe(NOTICE);
  });

  it('reads the older wordings as the notice', () => {
    for (const legacy of ['© Copernicus Sentinel data / Sentinel Hub', 'Copernicus Sentinel data / Sentinel Hub',
      '© Copernicus Sentinel data']) {
      expect(normaliseAttribution(legacy, '2026-05-12')).toBe(`${NOTICE} 2026`);
    }
  });

  it('writes the DEM licence word for word after the relief, once', () => {
    expect(DEM_NOTICE).toBe(DEM);
    expect(normaliseAttribution('© Copernicus Sentinel data / Sentinel Hub · Relief © Mapterhorn', '2023-08-08'))
      .toBe(`${NOTICE} 2023 · Relief © Mapterhorn (mapterhorn.com/attribution), ${DEM}`);
    // written before Mapterhorn's page was named, or after: left as it is
    for (const published of [`© Mapterhorn, ${DEM} · 30 m relief`, `© Mapterhorn (mapterhorn.com/attribution), ${DEM} · 30 m relief`]) {
      expect(normaliseAttribution(published)).toBe(published);
    }
  });

  it('leaves every other credit exactly as it was', () => {
    const others = [
      `${NOTICE} 2024`,
      'Copernicus Sentinel data 2024',
      'EOxCloudless https://cloudless.eox.at by EOX IT Services GmbH (Contains modified Copernicus Sentinel data 2016 & 2017) · CC BY 4.0',
      'Esri, Vantor, Earthstar Geographics, and the GIS User Community',
      'Map data ©2026 Google',
      'Terrain Tiles, Mapzen and AWS Open Data',
    ];
    for (const credit of others) expect(normaliseAttribution(credit, '2026-05-12')).toBe(credit);
  });

  it('answers nothing for a provider with no credit', () => {
    expect(normaliseAttribution(undefined, '2026-05-12')).toBe('');
    expect(normaliseAttribution('', '2026-05-12')).toBe('');
  });
});
