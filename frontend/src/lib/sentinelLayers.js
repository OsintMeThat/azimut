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

export function displayLayers(layers, verified, radarLayer = '') {
  const offered = layers.filter((entry) => entry.id !== radarLayer).map((entry) => ({
    ...entry, enabled: verified,
    reason: verified ? '' : 'Check your Copernicus layers first.',
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
