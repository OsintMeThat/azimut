/**
 * The candidates a run's analyst kept or pinned, as a table for a note, under a quoted
 * header that says what the run read: the areas, the analyzer, the passes, the threshold,
 * the cloud mask and how many were kept of how many were found.
 *
 * Only what somebody judged goes in. A candidate still in the queue is a lead and an
 * automated verdict is not Azimut's to print (SPEC non-goals), so the queue, and the
 * dismissed, never reach the table. What a row says is what the run measured, never a
 * conclusion.
 */
import { readingOf, sourceLabel, STRENGTHS } from '../../lib/map/analyzers.js';
import { candidatePair, candidateSize } from '../../lib/map/detectReview.js';
import { formatArea, formatDistance } from '../../lib/measure.js';
import { NOTE_ROWS, cutLine, tableChip, toMarkdown } from '../../lib/sheetExport.js';
import { pointText } from '../../lib/notes/syntax.js';
import { passDay } from './pinNote.js';

/** What was kept in a run: the candidates marked kept here or pinned in the case, in the run's order. */
export const keptRows = (results) => (results ?? []).filter((row) => row.review === 'kept' || row.review === 'noted');

/** The areas a run read, named, a long list cut. */
function areasOf(run) {
  const names = (run.input?.zones ?? []).map((zone) => String(zone.name ?? '').trim()).filter(Boolean);
  return names.length > 4 ? `${names.slice(0, 4).join(', ')} and ${names.length - 4} more` : names.join(', ');
}

/** The passes a run read between (`input`), or the one it read on, in words. */
function passesOf(input, single) {
  const first = passDay(input?.a);
  const second = passDay(input?.b);
  if (single || !first || first === second) return second ? `Pass: ${second}` : '';
  return second ? `Passes: A ${first}, B ${second}` : '';
}

/** What the run was told to leave out, in the words the analyzer's settings use. */
function thresholdOf(parameters, units) {
  const said = [];
  if (Number.isFinite(Number(parameters?.sensitivity))) said.push(`sensitivity ${parameters.sensitivity} of 100`);
  if (Number(parameters?.min_area) > 0) said.push(`from ${formatArea(Number(parameters.min_area), units)}`);
  if (Number(parameters?.max_area) > 0) said.push(`up to ${formatArea(Number(parameters.max_area), units)}`);
  return said.join(', ');
}

/** The cloud mask a run read through, or '' for radar, which sees through clouds. */
function cloudsOf(input, parameters) {
  if (input?.b?.provider === 'sentinel1') return '';
  const masked = [parameters?.ignore_clouds === false ? '' : 'clouds', parameters?.ignore_shadows === false ? '' : 'shadows'].filter(Boolean);
  if (!masked.length) return 'off';
  const margin = Number(parameters?.cloud_margin);
  return `${masked.join(' and ')} ignored${margin > 0 ? `, ${margin} px margin` : ''}`;
}

/**
 * The lines that make the table citable, each quoted above it. `single` is whether the
 * analyzer reads one pass (`recipeCapability(...).single`).
 */
export function keptHeader({ run, units = 'metric', single = false } = {}) {
  const input = run?.input ?? {};
  const results = run?.results ?? [];
  const kept = keptRows(results);
  const pinned = kept.filter((row) => row.review === 'kept').length;
  const clouds = cloudsOf(input, input.recipe?.parameters);
  const lines = [
    [`Detect run “${run?.title ?? ''}”`, areasOf(run ?? {})].filter(Boolean).join(': '),
    input.recipe?.name ? `Analyzer: ${input.recipe.name}` : '',
    passesOf(input, single),
    thresholdOf(input.recipe?.parameters, units) ? `Threshold: ${thresholdOf(input.recipe?.parameters, units)}` : '',
    clouds ? `Cloud mask: ${clouds}` : '',
    `${kept.length} kept of ${results.length} ${results.length === 1 ? 'candidate' : 'candidates'}${pinned ? `, ${pinned} pinned in the case` : ''}`,
  ];
  return lines.filter(Boolean);
}

/** A candidate's name: the pin's own as a chip, a candidate only kept here by what the run called it. */
function nameOf(row) {
  if (row.review === 'kept' && row.entity_id) return { markdown: tableChip(row.entity_id, row.title || row.phenomenon) };
  return String(row.title || row.phenomenon || '');
}

/** The table of what was kept, with its header, for a pinned note; '' when nothing was kept. */
export function keptTable({ run, methods = [], units = 'metric', single = false, limit = NOTE_ROWS } = {}) {
  const kept = keptRows(run?.results);
  if (!kept.length) return '';
  const shown = kept.slice(0, limit);
  const rows = shown.map((row) => {
    const size = candidateSize(row);
    const measured = [STRENGTHS[row.strength], readingOf(run.input?.recipe, methods, row.measure)].filter(Boolean).join(' · ');
    const pair = candidatePair(row, run);
    const first = passDay(pair.a);
    const second = passDay(pair.b);
    const when = single || !first || first === second ? second : `${first} → ${second}`;
    return [
      nameOf(row),
      row.coordinates ? pointText(row.coordinates[1], row.coordinates[0]) : '',
      [row.area > 0 ? formatArea(row.area, units) : '',
        size ? `≈ ${formatDistance(size.length, units)} × ${formatDistance(size.width, units)}` : ''].filter(Boolean).join(', '),
      measured,
      when || (pair.b ? sourceLabel(pair.b) : ''),
    ];
  });
  const cut = cutLine({ kept: shown.length, total: kept.length, noun: 'kept candidates', narrow: 'Dismiss the ones that are not findings for the rest.' });
  const header = keptHeader({ run, units, single });
  return toMarkdown({ columns: ['Candidate', 'Coordinates', 'Size', 'Reading', 'Dates'], rows }, cut ? [...header, cut] : header);
}

/**
 * The run's kept and pinned candidates, offered to a pinned note as a table. `read()`
 * answers what `keptTable` reads (`{ run, methods, units, single }`); the offer exists only
 * while something was kept.
 */
export function keptOffer({ read }) {
  return {
    id: 'kept',
    label: 'The kept candidates',
    hint: 'A table of what was kept or pinned in this run, under what the run read',
    icon: 'table',
    put: async () => {
      const text = keptTable(read() ?? {});
      if (!text) throw new Error('Keep or pin a candidate first');
      return { text };
    },
  };
}
