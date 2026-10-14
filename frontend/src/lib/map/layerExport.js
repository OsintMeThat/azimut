import { api, detailLine } from '../api.js';
import { markerImageKey, personalMarkerImage } from './addedLayer.js';
import { momentLabel } from './layerHistory.js';

export function iconData(symbol, colour, marks = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(personalMarkerImage(symbol, colour, marks), 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Download a personal layer. A tracked one can be had as it stood at `at`, which
 * is what a My Maps is sent, or with `history`, every state dated for a time
 * slider. A KMZ carries a picture of every marker style it holds, the statuses
 * of past states included.
 */
export async function downloadLayer(caseId, row, format, { at = null, history = false, drawIcon = iconData,
  fetchFile = fetch, save = saveBlob } = {}) {
  const path = `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}`;
  const icons = {};
  if (format === 'kmz') {
    const document = await api.get(`${path}/data`);
    for (const feature of document.features) {
      if (feature.geometry.type !== 'Point' || feature.properties.icon) continue;
      const symbol = feature.properties.symbol || 'pin', colour = (feature.properties.colour || '#0072b2').toLowerCase();
      const statuses = new Set([feature.properties.status ?? '',
        ...(feature.properties.states ?? []).filter((state) => !state.gone).map((state) => state.status ?? '')]);
      for (const status of statuses) {
        const marks = { status, external: feature.properties.provenance === 'external' };
        const key = markerImageKey(symbol, colour, marks);
        if (!(key in icons)) icons[key] = drawIcon(symbol, colour, marks);
      }
    }
  }
  const body = { icons, ...(at !== null ? { at } : {}), ...(history ? { history: true } : {}) };
  const response = await fetchFile(`${path}/export/${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(detailLine(data.detail) || 'The layer could not be downloaded');
  }
  const stem = at !== null ? `${row.title} ${momentLabel(at).replace(' · ', ' ').replace(':', 'h')}` : row.title;
  save(await response.blob(), `${stem.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.${format}`);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
