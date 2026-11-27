/**
 * The analyzer the "Create your analyzer" journey is photographed on: the owner's own
 * AVIATION, from their US airports case, aircraft on the aprons of Al Udeid Air Base.
 *
 * Everything here is that case's, verbatim: the one rule (brightness dropped by 7% or
 * more), the check between 15 and 25 September 2026 with its 19 pins (13 aircraft, 6
 * places left empty), the four areas its routine watches, the routine's July reference
 * and the passes it read. The journey's stages make it again in the app, rule by rule and
 * pin by pin (stages.mjs). Reading those passes costs Copernicus requests, so a run copies
 * every Sentinel-2 tile set of those days from a tile cache that already holds them (the
 * owner's, or `GUIDE_CACHE_HOME`) and keeps its stand-in Copernicus id: a tile the cache
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
export const PASSES = ['2026-09-15', '2026-09-25'];

/** The routine's fixed picture: every pass it reads is compared with this one. */
export const REFERENCE = '2026-07-24';

/** The routine's cloud ceiling, in percent. */
export const MAX_CLOUD = 35;

/** The passes the routine read, oldest first: the first run, then the ones caught up. */
export const ROUTINE_PASSES = [
  '2026-09-25', '2026-09-30', '2026-10-05', '2026-10-12', '2026-10-15', '2026-10-20', '2026-10-25',
  '2026-10-30', '2026-11-01', '2026-11-04', '2026-11-09', '2026-11-14', '2026-11-21', '2026-11-24',
];

/** Where the aprons are, for the map before a check is put on it. */
export const AIRBASE = { lat: 25.1305, lon: 51.312, zoom: 15 };

/** The four areas the routine watches, as the case saved them: the main apron first. */
export const AREAS = [
  { name: 'Al Udeid Air Base 1', ring: [[51.314258, 25.1441575], [51.3179845, 25.1435796], [51.3159173, 25.1310946], [51.3172767, 25.1276405], [51.3154853, 25.1269257], [51.3145561, 25.127598], [51.3134332, 25.1305036], [51.314173, 25.1356909], [51.3129209, 25.1360222]] },
  { name: 'Al Udeid Air Base 2', ring: [[51.2993769, 25.138124], [51.2968469, 25.1372003], [51.2980323, 25.1348039], [51.3003854, 25.1357668]] },
  { name: 'Al Udeid Air Base 3', ring: [[51.3261471, 25.1178766], [51.3226004, 25.1166762], [51.3204014, 25.1218121], [51.3237108, 25.1230864], [51.3237177, 25.1230784]] },
  { name: 'Al Udeid Air Base 4', ring: [[51.3205302, 25.1168544], [51.319343, 25.116424], [51.3177791, 25.1199982], [51.3190064, 25.1203933]] },
];

/** The check's pins, verbatim: 13 aircraft that came between the two passes, then 6 places left empty. */
export const MARKS = [
  { point: [51.3147785, 25.1386401], expect: 'found' },
  { point: [51.3160014, 25.1409707], expect: 'found' },
  { point: [51.3149594, 25.1410975], expect: 'found' },
  { point: [51.3166991, 25.1421695], expect: 'found' },
  { point: [51.315689, 25.1422925], expect: 'found' },
  { point: [51.3147164, 25.14245], expect: 'found' },
  { point: [51.3164385, 25.1371347], expect: 'found' },
  { point: [51.313961, 25.1374362], expect: 'found' },
  { point: [51.3150012, 25.135183], expect: 'found' },
  { point: [51.3160418, 25.1350465], expect: 'found' },
  { point: [51.3158904, 25.1341731], expect: 'found' },
  { point: [51.314694, 25.1332603], expect: 'found' },
  { point: [51.3142383, 25.1363147], expect: 'found' },
  { point: [51.3155868, 25.139855], expect: 'empty' },
  { point: [51.3159984, 25.1384721], expect: 'empty' },
  { point: [51.3151597, 25.1372707], expect: 'empty' },
  { point: [51.3157346, 25.1331238], expect: 'empty' },
  { point: [51.3168372, 25.1396734], expect: 'empty' },
  { point: [51.3145763, 25.1373515], expect: 'empty' },
];

/** Every day the journey reads: the check's two passes, the reference and the routine's. */
const DAYS = [...new Set([...PASSES, REFERENCE, ...ROUTINE_PASSES])];

/**
 * Copy those days from an Azimut home's tile cache into the run's workspace, every
 * Sentinel-2 layer and band read of them. Says how many tile sets it copied: none means
 * the pictures of the journey cannot be made without spending quota.
 */
export function copyPasses(home, source = process.env.GUIDE_CACHE_HOME ?? join(homedir(), 'Azimut')) {
  const from = join(source, '.azimut/cache/tiles');
  if (!existsSync(from)) return 0;
  let copied = 0;
  for (const name of readdirSync(from)) {
    if (!name.startsWith('sentinel2~') || !DAYS.some((day) => name.includes(`~${day}~`))) continue;
    cpSync(join(from, name), join(home, '.azimut/cache/tiles', name), { recursive: true });
    copied += 1;
  }
  return copied;
}
