import { expect, it } from 'vitest';
import { availableDisplayLayer, displayLayers } from './sentinelLayers.js';

const configured = [{ id: 'TRUE_COLOR', label: 'True colour' }, { id: 'VEGETATION_INDEX', label: 'Vegetation Index - NDVI' },
  { id: 'RADAR', label: 'Radar' }];

it('keeps actual identifiers, excludes the radar layer and greys missing displays', () => {
  const options = displayLayers(configured, true, 'RADAR');
  expect(options.find((entry) => entry.id === 'VEGETATION_INDEX').enabled).toBe(true);
  expect(options.some((entry) => ['NDVI', 'RADAR'].includes(entry.id))).toBe(false);
  expect(options.find((entry) => entry.id === 'SWIR')).toMatchObject({ enabled: false, reason: 'Not in your Copernicus configuration.' });
  expect(availableDisplayLayer('NDVI', options)).toBe('VEGETATION_INDEX');
  expect(availableDisplayLayer('SWIR', options)).toBe('TRUE_COLOR');
});

it('never treats the fallback catalogue as verified availability', () => {
  const options = displayLayers(configured, false);
  expect(options.every((entry) => !entry.enabled)).toBe(true);
  expect(availableDisplayLayer('TRUE_COLOR', options)).toBe('');
});

it('keeps a custom configured display and handles an empty configuration', () => {
  const options = displayLayers([{ id: 'MY_GROUND', label: 'My ground' }], true);
  expect(availableDisplayLayer('NDVI', options)).toBe('MY_GROUND');
  expect(displayLayers([], true).every((entry) => !entry.enabled)).toBe(true);
});

it('offers a layer written in Azimut whether or not the instance has been asked', () => {
  const mine = { id: 'PLUME_SWIR', label: 'SWIR plume', custom: true };
  for (const verified of [true, false]) {
    const row = displayLayers([mine], verified).find((entry) => entry.id === 'PLUME_SWIR');
    // the script is on this machine; GetCapabilities has no say in it
    expect(row.enabled).toBe(true);
    expect(row.reason).toBe('');
  }
});

it('still withholds a configured layer until the instance confirms it', () => {
  const row = displayLayers([{ id: 'SWIR', label: 'SWIR' }], false).find((e) => e.id === 'SWIR');
  expect(row.enabled).toBe(false);
  expect(row.reason).toBe('Check your Copernicus layers first.');
});

it('lets a layer written in Azimut be the display layer', () => {
  const offered = displayLayers([{ id: 'PLUME_SWIR', label: 'Plume', custom: true }], false);
  expect(availableDisplayLayer('PLUME_SWIR', offered)).toBe('PLUME_SWIR');
});
