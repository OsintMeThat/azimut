/**
 * A map of the case put in a note (`engine/notes_maps.py`): layers, a plate or a period
 * of proofs, written as a `::: map` block. The server frames it and files the ground under
 * it on the press, the way Add › This view files a capture, so the exported page holds it
 * and never fetches a tile. Each offer goes through `putInNote`, Undo included: the block
 * comes back out and the pictures filed only for it go to the Trash.
 *
 * In the HTML page the map is one a reader moves about, presses and plays through its
 * days; in the PDF it prints as a picture of its last day.
 */
import { api } from '../api.js';
import { reloadCase, toast } from '../state.svelte.js';

/** What a map put asks for: `{ title, layers, plate, proofs, provider }`, empty parts left out. */
export function mapRequest({ title = '', layers = [], plate = '', proofs = '', provider = '' } = {}) {
  const request = { title: String(title ?? '').replace(/\s+/g, ' ').trim() };
  const named = [...new Set((layers ?? []).map((name) => String(name ?? '').trim()).filter(Boolean))];
  if (named.length) request.layers = named;
  if (String(plate ?? '').trim()) request.plate = String(plate).trim();
  if (String(proofs ?? '').trim()) request.proofs = String(proofs).trim();
  if (provider) request.provider = provider;
  return request;
}

/** A period of proofs as the block writes it: `all`, `2026-09-01..2026-11-15`, an end left open, or "". */
export function proofsPeriod({ on = false, from = '', to = '' } = {}) {
  if (!on) return '';
  if (!from && !to) return 'all';
  if (from && to && from === to) return from;
  const [first, last] = from && to && to < from ? [to, from] : [from, to];
  return `${first}..${last}`;
}

/** Ask the server for the block; answers `{ text, filed }`, its warnings said once it is put. */
export async function putMap(caseId, request, { signal, post = api.post, reload = reloadCase, say = toast } = {}) {
  const answer = await post(`/api/cases/${encodeURIComponent(caseId)}/notes/maps`, request, { signal });
  if (answer?.filed?.length) await reload();
  for (const warning of answer?.warnings ?? []) say(warning, 'warn', 8000);
  return { text: answer?.text ?? '', filed: answer?.filed ?? [] };
}

/** The offer `putInNote` runs: `request()` read on the press, so it is what the tool shows then. */
export function mapOffer({ caseId, request, id = 'map', label = 'As an interactive map', hint = '', prepare = null, deps = {} }) {
  return {
    id,
    label,
    hint: hint || 'A map to move and play in the HTML page, a picture in the PDF',
    icon: 'mapArea',
    busy: 'Framing the map and filing its ground…',
    put: async ({ signal } = {}) => {
      if (prepare) await prepare({ signal });
      const asked = typeof request === 'function' ? request() : request;
      const owner = typeof caseId === 'function' ? caseId() : caseId;
      if (!owner || !asked) throw new Error('There is nothing to map here');
      return putMap(owner, mapRequest(asked), { signal, ...deps });
    },
  };
}

/** One of My layers, as a map of its own. */
export function layerMapOffer(caseId, row, deps = {}) {
  return mapOffer({ caseId, id: 'layer-map', label: 'This layer as a map', request: { title: row?.title ?? '', layers: [row?.name] }, deps });
}
