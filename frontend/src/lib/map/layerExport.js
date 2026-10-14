import { api, detailLine } from '../api.js';
import { markerImageKey, personalMarkerImage } from './addedLayer.js';

export function iconData(symbol, colour, marks = {}) {
  const canvas = document.createElement('canvas'); canvas.width = 64; canvas.height = 64;
  const ctx = canvas.getContext('2d');
  ctx.putImageData(personalMarkerImage(symbol, colour, marks), 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

export async function downloadLayer(caseId, row, format, { drawIcon = iconData, fetchFile = fetch, save = saveBlob } = {}) {
  const path = `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}`;
  const icons = {};
  if (format === 'kmz') {
    const document = await api.get(`${path}/data`);
    for (const feature of document.features) {
      if (feature.geometry.type !== 'Point' || feature.properties.icon) continue;
      const symbol = feature.properties.symbol || 'pin', colour = (feature.properties.colour || '#0072b2').toLowerCase();
      const marks = { status: feature.properties.status ?? '', external: feature.properties.provenance === 'external' };
      const key = markerImageKey(symbol, colour, marks);
      if (!(key in icons)) icons[key] = drawIcon(symbol, colour, marks);
    }
  }
  const response = await fetchFile(`${path}/export/${format}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ icons }) });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(detailLine(body.detail) || 'The layer could not be downloaded');
  }
  save(await response.blob(), `${row.title.replace(/[\\/<>:"|?*\u0000-\u001f]/g, '_')}.${format}`);
}

function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), link = document.createElement('a');
  link.href = url; link.download = name; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
