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
