/**
 * The analyzer the "Create your analyzer" journey is photographed on: the one the Detect
 * tutorial film builds (`.docs/demos/tutorials/detect-airbase`), new aircraft on the
 * apron of Al Udeid Air Base between two Sentinel-2 passes.
 *
 * Its rules and its check are the film's, calibrated on those passes: 14 places where an
 * aircraft appeared and 6 where nothing did. The passes are not fetched. A check put on
 * the map and its Test read Sentinel-2 tiles, which cost Copernicus requests, so the run
 * copies the two passes from the tile cache of an Azimut that already read them (the
 * owner's, where the film was made) and keeps its stand-in Copernicus id: a tile the cache
 * lacks fails at Copernicus without spending anything. Only tiles are copied, never the
 * settings or the keys beside them.
 *
 * The imagery is Copernicus Sentinel-2 data, free and open, credited in
 * `photos/CREDITS.md` and on the map itself.
 */

import { cpSync, existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The two passes the check compares. */
export const PASSES = ['2026-07-27', '2026-09-30'];

/** Where the apron is, for the map before a check is put on it. */
export const AIRBASE = { lat: 25.1305, lon: 51.312, zoom: 15 };

/**
 * The film's check pins, verbatim from its reference: they were checked by eye against
 * both passes before it was filmed, 14 aircraft that appeared and 6 places left empty.
 */
const MARKS = [
  { point: [51.315660747009105, 25.12891186671085], expect: 'found' },
  { point: [51.31593671509438, 25.127841691939267], expect: 'found' },
  { point: [51.31464492852305, 25.129721264536286], expect: 'found' },
  { point: [51.31573451349814, 25.13612990843137], expect: 'found' },
  { point: [51.316434070973884, 25.137126909447375], expect: 'found' },
  { point: [51.31520073613271, 25.137317605583092], expect: 'found' },
  { point: [51.314579641889395, 25.137369702020422], expect: 'found' },
  { point: [51.313962974468836, 25.137465049936253], expect: 'found' },
  { point: [51.31567572966728, 25.133107345833068], expect: 'found' },
  { point: [51.3151028789633, 25.13476076275066], expect: 'empty' },
  { point: [51.31510713973648, 25.132448323465738], expect: 'empty' },
  { point: [51.31532036422911, 25.1299176346524], expect: 'empty' },
  { point: [51.31507872610433, 25.128498254262396], expect: 'empty' },
  { point: [51.315818021118474, 25.13845236517254], expect: 'empty' },
  { point: [51.314730304382806, 25.138465079944694], expect: 'empty' },
  { point: [51.31709769128079, 25.140882729581477], expect: 'found' },
  { point: [51.31601104362443, 25.141000046182185], expect: 'found' },
  { point: [51.314966601293094, 25.141153082008913], expect: 'found' },
  { point: [51.314918207247985, 25.139927008931764], expect: 'found' },
  { point: [51.315584864561345, 25.13984928092829], expect: 'found' },
];

/** The film's analyzer, as the library files it. */
export function airbaseAnalyzer() {
  return {
    id: 'custom',
    name: 'Aircraft activity',
    description: 'Review newly visible aircraft candidates using visible-band change and a local B08 drop.',
    phenomenon: 'Candidate',
    method: 'rules',
    parameters: {
      sensitivity: 60, min_area: 0, max_area: 0, cleanup: 0, smoothing: 1, index: 'ndvi', direction: 'both',
      sar_ground: 'any', ignore_clouds: true, ignore_shadows: true, cloud_margin: 5, merge_metres: 0, shape: 'compact',
    },
    colour: '#f6a81a',
    style: 'both',
    rules: [
      { measure: 'colour', on: 'change', op: 'ge', value: 0.045, around: 0 },
      { measure: 'band', band: 'B08', on: 'change', op: 'le', value: -0.05, around: 150 },
    ],
    match: 'all',
    sensor: 'sentinel2',
    dates: 'two',
    checks: [
      {
        id: 'apron-check',
        name: 'Apron check',
        a: { provider: 'sentinel2', date: PASSES[0], layer: 'TRUE_COLOR', maxcc: 100 },
        b: { provider: 'sentinel2', date: PASSES[1], layer: 'TRUE_COLOR', maxcc: 100 },
        marks: MARKS,
      },
    ],
  };
}

/**
 * Copy the two passes from an Azimut home's tile cache into the run's workspace, every
 * Sentinel-2 layer and band read of those days. Says how many tile sets it copied: none
 * means the pictures of the journey cannot be made without spending quota.
 */
export function copyPasses(home, source = process.env.GUIDE_CACHE_HOME ?? join(homedir(), 'Azimut')) {
  const from = join(source, '.azimut/cache/tiles');
  if (!existsSync(from)) return 0;
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (!name.startsWith('sentinel2~') || !PASSES.some((day) => name.includes(`~${day}~`))) continue;
    cpSync(join(from, name), join(home, '.azimut/cache/tiles', name), { recursive: true });
    copied += 1;
  }
  return copied;
}
