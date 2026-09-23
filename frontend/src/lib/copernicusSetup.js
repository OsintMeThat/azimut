/**
 * How to get Copernicus working, said the same way wherever it is needed.
 *
 * Detect cannot run without it, Compare's satellite passes cannot either, and
 * Settings is where the answer is typed in. The account and the Sentinel-2
 * configuration are one recipe; the Sentinel-1 layer is a second one, added to
 * that same configuration, and its form asks questions nobody could guess the
 * answers to. Both live here so the three places cannot drift apart.
 */

/** Where a free account is opened, and where its configurations are built. */
export const COPERNICUS_SIGNUP = 'https://dataspace.copernicus.eu/';
export const COPERNICUS_CONFIGURATIONS = 'https://shapps.dataspace.copernicus.eu/dashboard/#/configurations';

/** The account and its Sentinel-2 configuration, whose ID is the key. */
export const ACCOUNT_STEPS = Object.freeze([
  'Register on dataspace.copernicus.eu. It is free and asks for no card.',
  'Open the Sentinel Hub Dashboard, then Configuration Utility → New configuration, based on "Simple Sentinel-2 L2A template".',
  'Open it and turn off Show logo and Show warnings. Both are burned into every tile.',
  'Copy the ID under "Service endpoints" and paste it in Settings → Imagery → Sentinel Hub.',
]);

/** The Sentinel-1 layer, added to that same configuration. */
export const RADAR_STEPS = Object.freeze([
  'In the Configuration Utility, open the configuration whose ID Azimut has, and press Add new layer.',
  'Fill the form as below, then Save.',
  'Back here, press Find the radar layer. Each layer it asks about is one request.',
]);

/**
 * The "Add a new layer" form, field by field, as it reads on the dashboard.
 * Azimut draws with its own script, so Data processing only has to be valid.
 */
export const RADAR_FORM = Object.freeze([
  ['Layer name', 'Anything, for example RADAR', 'Azimut finds it by asking.'],
  ['Source', 'Sentinel-1 GRD', ''],
  ['Data processing', 'Any predefined product, from the pencil', 'Required by the form; Azimut replaces it.'],
  ['Time range', 'Leave both boxes unticked', ''],
  ['Mosaic order', 'Most recent', ''],
  ['Acquisition mode', 'IW', ''],
  ['Polarization', 'VV + VH', 'Every radar analyzer reads both.'],
  ['Resolution', 'High', '10 m, the grid Detect sweeps.'],
  ['Orbit Direction', 'Any', 'Azimut tells the passes apart.'],
  ['Orthorectification', 'Copernicus 30 m DEM', 'Keeps hills where they stand; twice the processing units. Disabled is fine at sea.'],
  ['Backscatter coefficient', 'gamma0', 'Terrain gamma0 costs 2.5 times more.'],
  ['Speckle Filter', 'None', 'Azimut averages speckle itself; a filter doubles the cost.'],
]);

/**
 * The script to paste when the form offers no predefined product. It only has
 * to be valid: Azimut sends its own with every request.
 */
export const RADAR_SCRIPT = `//VERSION=3
function setup() { return { input: ["VV", "VH", "dataMask"], output: { bands: 4 } }; }
function evaluatePixel(p) { return [p.VV * 2.5, p.VH * 8, 0, p.dataMask]; }`;

/** What is missing for a Copernicus road, from the providers the app offers. */
export function copernicusNeed(providers, { radar = false } = {}) {
  const has = (id) => (providers ?? []).some((provider) => provider.id === id && !provider.needs_key);
  if (!has('sentinel2')) return 'account';
  if (radar && !has('sentinel1')) return 'radar';
  return '';
}
