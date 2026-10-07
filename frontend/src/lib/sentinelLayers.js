/** Display layers are configuration entries; rule quantities are computed from bands. */
export const DISPLAY_LAYERS = Object.freeze([
  { id: 'TRUE_COLOR', label: 'True colour', aliases: [] },
  { id: 'FALSE_COLOR', label: 'False colour (infrared)', aliases: ['COLOR_INFRARED'] },
  { id: 'SWIR', label: 'SWIR (short-wave infrared)', aliases: [] },
  { id: 'NDVI', label: 'NDVI (vegetation index)', aliases: ['VEGETATION_INDEX'] },
]);

export function displayLayerFamily(id) {
  return DISPLAY_LAYERS.find((entry) => entry.id === id || entry.aliases.includes(id))?.id ?? id;
}

/**
 * Every layer a picker may offer, with the ones it cannot render disabled and
 * told why.
 *
 * A configured layer is only offerable once the instance has confirmed it
 * serves it: offering one it does not just 400s on selection. A layer written
 * in Azimut needs no such confirmation — its script is on this machine and
 * renders through a base layer — so it is always offered.
 */
export function displayLayers(layers, verified, radarLayer = '') {
  const offered = layers.filter((entry) => entry.id !== radarLayer).map((entry) => ({
    ...entry, enabled: entry.custom ? true : verified,
    reason: entry.custom || verified ? '' : 'Check your Copernicus layers first.',
  }));
  for (const { id, label } of DISPLAY_LAYERS) {
    if (offered.some((entry) => displayLayerFamily(entry.id) === id)) continue;
    offered.push({ id, label, enabled: false,
      reason: verified ? 'Not in your Copernicus configuration.' : 'Check your Copernicus layers first.' });
  }
  return offered;
}

export function availableDisplayLayer(wanted, offered) {
  const available = offered.filter((entry) => entry.enabled !== false);
  return available.find((entry) => entry.id === wanted)?.id
    ?? available.find((entry) => displayLayerFamily(entry.id) === displayLayerFamily(wanted))?.id
    ?? available.find((entry) => entry.id === 'TRUE_COLOR')?.id
    ?? available[0]?.id ?? '';
}
