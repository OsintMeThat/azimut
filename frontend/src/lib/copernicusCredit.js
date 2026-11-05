/**
 * The credits Copernicus data carries, worded once for the app's side.
 *
 * The European Commission's legal notice asks for "Contains modified Copernicus
 * Sentinel data [Year]" once the data has been adapted, and every Sentinel picture
 * here has been: rendered from its bands, reprojected, compressed. The year is the
 * data's, read off the days a map shows; an undated map says no year rather than a
 * wrong one.
 *
 * The relief comes from Mapterhorn, built on Copernicus GLO-30, whose licence asks a
 * picture drawn from adapted heights to carry its own notice, word for word. A map's
 * corner keeps the short "© Mapterhorn"; a picture filed or exported carries the
 * notice after it.
 *
 * The backend words both the same way (`engine/copernicus_credit.py`) and lists its
 * Sentinel basemaps with the notice and no year, since a basemap has no date until
 * a map picks its pass. Wherever a credit is shown or printed, it goes through
 * `normaliseAttribution` with the id the map draws, which names that pass.
 */

const SENTINEL_NOTICE = 'Contains modified Copernicus Sentinel data';
/** The Copernicus DEM licence's notice for adapted GLO-30 data (Article 6(b)), word for word,
 *  on one line so the backend's test finds it whole (tests/test_copernicus_credit.py). */
export const DEM_NOTICE = 'produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved';
const RELIEF = '© Mapterhorn';

const DAY = /(?<!\d)(\d{4})-\d{2}-\d{2}(?!\d)/g;
// The notice already written, but with no year after it.
const UNDATED = /Contains modified Copernicus Sentinel data(?!\s*\d)/g;
// What the app wrote before: "© Copernicus Sentinel data / Sentinel Hub" and its
// shorter forms. A notice in the modified form, or one with its year, is left alone.
const LEGACY = /(?:©\s*)?(?<!modified )Copernicus Sentinel data(?:\s*\/\s*Sentinel Hub)?(?!\s*\d)/g;
// The relief's short credit with nothing of the DEM's notice after it.
const BARE_RELIEF = /© Mapterhorn(?!, produced using Copernicus WorldDEM-30)/g;

/**
 * The years the days in `dated` name: `'2026'`, `'2025-2026'`, or `''`.
 *
 * @param {string|string[]|null|undefined} dated a provider id
 *   (`sentinel2~TRUE_COLOR~2026-05-12~2026-05-12`), a day, or a list of either
 */
function dataYears(dated) {
  const years = [dated].flat().filter((text) => typeof text === 'string')
    .flatMap((text) => [...text.matchAll(DAY)].map((found) => Number(found[1])));
  if (!years.length) return '';
  const first = Math.min(...years);
  const last = Math.max(...years);
  return first === last ? String(first) : `${first}-${last}`;
}

/**
 * A credit as it must read where it is shown, for imagery of those days: the
 * Sentinel notice dated, an older wording of it brought up to the notice, the
 * relief's short credit followed by the DEM's notice, and any other credit, or the
 * rest of a composed line, left exactly as it was.
 *
 * @param {string|null|undefined} text a provider's attribution, or one a file kept
 * @param {string|string[]|null|undefined} [dated] what `dataYears` reads
 */
export function normaliseAttribution(text, dated) {
  if (typeof text !== 'string' || !text) return '';
  const years = dataYears(dated);
  const notice = years ? `${SENTINEL_NOTICE} ${years}` : SENTINEL_NOTICE;
  return text.replace(UNDATED, notice).replace(LEGACY, notice).replace(BARE_RELIEF, `${RELIEF}, ${DEM_NOTICE}`);
}
