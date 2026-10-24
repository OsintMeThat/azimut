import { api, detailLine } from '../api.js';
import { markerImageKey, ownMarkerImage, personalMarkerImage } from './addedLayer.js';
import { momentLabel } from './layerHistory.js';
import { iconVersion, layerIconUrl, loadPicture } from './ownIcons.js';

export function iconData(symbol, colour, marks = {}) {
  return pixelsData(personalMarkerImage(symbol, colour, marks));
}

/** One of the analyst's icons as the map draws it, in its disc or with its marks, or null. */
export async function ownIconData(url, colour, look) {
  const picture = await loadPicture(url);
  return picture ? pixelsData(ownMarkerImage(picture, colour, look)) : null;
}

function pixelsData(pixels) {
  if (!pixels) return null;
  const canvas = document.createElement('canvas'); canvas.width = pixels.width; canvas.height = pixels.height;
  canvas.getContext('2d').putImageData(pixels, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

/**
 * Download a personal layer. A tracked one can be had as it stood at `at`, which
 * is what a My Maps is sent, or with `history`, every state dated for a time
 * slider. A KMZ carries a picture of every marker style it holds, the statuses
 * of past states included. A marker in one of the analyst's icons goes as the
 * map draws it when that is more than the bare picture: in its disc, or with a
 * status stroke or an external rim; else the layer's own picture goes.
 */
export async function downloadLayer(caseId, row, format, { at = null, history = false, drawIcon = iconData,
  drawOwn = ownIconData, fetchFile = fetch, save = saveBlob } = {}) {
  const path = `/api/cases/${caseId}/map-layers/${encodeURIComponent(row.name)}`;
  const icons = {};
  if (format === 'kmz') {
    const document = await api.get(`${path}/data`);
    for (const feature of document.features) {
      if (feature.geometry.type !== 'Point') continue;
      const own = feature.properties.icon;
      const symbol = feature.properties.symbol || 'pin', colour = (feature.properties.colour || '#0072b2').toLowerCase();
      const mode = feature.properties.icon_mode === 'disc' ? 'disc' : 'image';
      const statuses = new Set([feature.properties.status ?? '',
        ...(feature.properties.states ?? []).filter((state) => !state.gone).map((state) => state.status ?? '')]);
      for (const status of statuses) {
        const marks = { status, external: feature.properties.provenance === 'external' };
        if (own && mode === 'image' && !marks.status && !marks.external) continue;
        const key = markerImageKey(own ? `own-${own}` : symbol, colour, marks);
        if (key in icons) continue;
        const drawn = own ? await drawOwn(layerIconUrl(caseId, row.name, own, iconVersion(row)), colour, { mode, ...marks }) : drawIcon(symbol, colour, marks);
        if (drawn) icons[key] = drawn;
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
