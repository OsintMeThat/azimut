/**
 * Reading a sheet as a geolocation index, and proposing which column is which.
 *
 * The build is the one road out of a sheet that fetches bytes, so it is offered on a
 * sheet that can actually feed it and hidden everywhere else: **two columns of addresses
 * and one of coordinates**. That is what a geolocation index is — what was filmed, what
 * was published about it, and where it turns out to be.
 *
 * What a column holds is read the same way the pass reads it: the declared role wins, and
 * a sheet imported five minutes ago has none, so the cells are read instead. A column of
 * links is decided here rather than by `detectRole`, which deliberately never answers
 * `url` — it suggests roles for display, and a column of sources turned into a wall of
 * thumbnails would fetch pages nobody asked for.
 */
import { ID_COLUMN } from './sheet.js';
import { detectRole } from './sheetRoles.js';

/** The same two thirds `detectRole` reads a column on: a binder's column is half-finished
 *  by definition, and one blank in three does not change what it holds. */
const ENOUGH = 0.66;

export function columnKinds(table, meta) {
  const columns = (table?.columns ?? []).filter(
    (name) => String(name).toLowerCase() !== ID_COLUMN,
  );
  const found = {};
  for (const name of columns) {
    const declared = meta?.roles?.[name]?.kind ?? '';
    if (declared) {
      found[name] = declared;
      continue;
    }
    const at = (table?.columns ?? []).indexOf(name);
    const cells = (table?.rows ?? [])
      .map((row) => String(row[at] ?? '').trim())
      .filter(Boolean);
    const share = cells.length
      ? cells.filter((cell) => /^https?:\/\//i.test(cell)).length / cells.length
      : 0;
    found[name] = share >= ENOUGH ? 'url' : (detectRole(cells) ?? '');
  }
  return found;
}

/** Whether this sheet can feed a build at all. Two addresses and a point: one address is
 *  a media library import, and no point is not a geolocation. */
export function canBuild(kinds) {
  const held = Object.values(kinds ?? {});
  return held.filter((kind) => kind === 'url').length >= 2 && held.includes('latlon');
}

/** Which column is which, proposed rather than decided: every one of these is a select the
 *  analyst can change, and a sheet whose columns are named anything at all still opens
 *  filled in.
 *
 *  The two addresses are told apart by their names when they say so — a column called
 *  *Geolocation proof* is the published picture — and by their order when they do not,
 *  because a binder writes the footage before what was made of it. */
export function proposal(table, meta) {
  const kinds = columnKinds(table, meta);
  const columns = Object.keys(kinds);
  const named = (test) => columns.find((name) => test.test(name)) ?? '';
  const urls = columns.filter((name) => kinds[name] === 'url');
  const published =
    urls.find((name) => /proof|geoloc|published|picture|image/i.test(name)) ?? urls[1] ?? '';
  const source = urls.find((name) => name !== published) ?? '';
  return {
    title: named(/^title$/i) || named(/title|subject|name|event/i) || firstPlain(columns, kinds),
    source,
    proof: published,
    point: columns.find((name) => kinds[name] === 'latlon') ?? '',
    note: named(/^notes?$/i) || named(/note|comment|remark/i),
    status: columns.find((name) => kinds[name] === 'state') ?? '',
  };
}

/** The first column carrying nothing the app already reads, which is where a name lives
 *  when nobody called it one. */
function firstPlain(columns, kinds) {
  return columns.find((name) => !kinds[name]) ?? '';
}
