/**
 * MapLibre's own build, for the live map of a note's web folder.
 *
 * A web folder's map goes live online (`engine/notes_html_assets/reader.live.js`): it
 * loads MapLibre GL JS from the folder itself, as plain files a static host serves. The
 * frontend build copies MapLibre's standalone build from `node_modules` into
 * `src/azimut/static/vendor/maplibre/` (git-ignored, shipped in the wheel with the rest
 * of `static/`), and the export copies it from there into each folder that has a map
 * (`engine/notes_web.py`). Nothing of it is kept in git.
 *
 * MapLibre 6 ships ES modules only: its main file, a shared chunk both it and its worker
 * import, and the worker, which it starts as a module worker from the file beside its own
 * (`new URL('./maplibre-gl-worker.mjs', import.meta.url)`), never from a `blob:` address,
 * so a page whose policy allows scripts from itself alone runs it. They are written here as
 * `.js` files, their names inside them changed to match: a host that does not know the
 * `.mjs` suffix serves it as a download, which a browser refuses to run as a module. The
 * comments naming source maps the folder does not carry are dropped.
 */

/** Where the build writes it, inside its output folder. */
export const VENDOR_DIR = 'vendor/maplibre';

/** Each file the folder gets, from the file of MapLibre's `dist` it is made of. */
export const VENDOR_FILES = {
  'maplibre-gl.js': 'dist/maplibre-gl.mjs',
  'maplibre-gl-shared.js': 'dist/maplibre-gl-shared.mjs',
  'maplibre-gl-worker.js': 'dist/maplibre-gl-worker.mjs',
  'maplibre-gl.css': 'dist/maplibre-gl.css',
  'LICENSE.txt': 'LICENSE.txt',
};

const RENAMED = [
  ['maplibre-gl-shared.mjs', 'maplibre-gl-shared.js'],
  ['maplibre-gl-worker.mjs', 'maplibre-gl-worker.js'],
];

/** One file as the folder holds it: its sibling modules named by their new names, no source map comment. */
export function vendored(name, text) {
  if (!name.endsWith('.js')) return text;
  let out = text;
  for (const [from, to] of RENAMED) out = out.split(from).join(to);
  return out.replace(/\n?\/\/# sourceMappingURL=\S+\s*$/, '\n');
}

/**
 * Every file to write under `VENDOR_DIR`, by name: MapLibre's, made `vendored`, and `VERSION`,
 * which the export names the folder's copy after. `read(path)` reads a file of the package as text.
 */
export function vendorFiles(read) {
  const files = {};
  for (const [name, from] of Object.entries(VENDOR_FILES)) files[name] = vendored(name, read(from));
  files.VERSION = `${JSON.parse(read('package.json')).version}\n`;
  return files;
}
