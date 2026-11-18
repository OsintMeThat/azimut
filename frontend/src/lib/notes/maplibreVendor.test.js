import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { VENDOR_FILES, vendored, vendorFiles } from './maplibreVendor.js';

/** MapLibre's own build, as the frontend build copies it for a web folder's live maps. */

describe('MapLibre for a web folder', () => {
  it('copies MapLibre’s own build under names any static host serves, its modules naming one another so', () => {
    const main = 'import{a}from"./maplibre-gl-shared.mjs";let w=`maplibre-gl-worker.mjs`,d=`maplibre-gl-worker-dev.mjs`;\n//# sourceMappingURL=maplibre-gl.mjs.map\n';
    const made = vendored('maplibre-gl.js', main);
    expect(made).toContain('"./maplibre-gl-shared.js"');
    expect(made).toContain('`maplibre-gl-worker.js`');
    expect(made).not.toContain('sourceMappingURL');
    expect(vendored('maplibre-gl.css', '/* x */')).toBe('/* x */');
    const files = vendorFiles((path) => (path === 'package.json' ? '{"version":"6.8.0"}' : `// ${path}`));
    expect(Object.keys(files).sort()).toEqual([...Object.keys(VENDOR_FILES), 'VERSION'].sort());
    expect(files.VERSION).toBe('6.8.0\n');
  });

  it('copies the installed build whole: three modules that load nothing but one another', () => {
    const root = new URL('../../../node_modules/maplibre-gl/', import.meta.url);
    const files = vendorFiles((path) => readFileSync(new URL(path, root), 'utf8'));
    for (const name of ['maplibre-gl.js', 'maplibre-gl-shared.js', 'maplibre-gl-worker.js']) {
      expect(files[name], name).not.toMatch(/maplibre-gl-(shared|worker)\.mjs/);
      for (const [, path] of files[name].matchAll(/from\s*"([^"]+)"/g)) expect(path, name).toBe('./maplibre-gl-shared.js');
    }
    // its worker is started from the file beside it, never from a blob made of fetched code
    expect(files['maplibre-gl.js']).toMatch(/new URL\(`\.\/\$\{\w+\}`,\w+\)\.href/);
  });
});
