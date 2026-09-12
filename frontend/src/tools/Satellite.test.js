import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Satellite.svelte', import.meta.url), 'utf8');
const cluster = readFileSync(
  new URL('./satellite/MapToolCluster.svelte', import.meta.url),
  'utf8'
);
// The sky overlay's geometry moved to `lib/skyOverlay.js`, where it is exercised
// against real numbers (`skyOverlay.test.js`); the tool hands it to the map.
const sky = readFileSync(new URL('../lib/skyOverlay.js', import.meta.url), 'utf8');

/** The tool and everything it is made of, keyed by the path a failure names, for
 *  the checks that must hold of all of it. */
function satelliteSources() {
  const files = { 'Satellite.svelte': source };
  const dir = new URL('./satellite/', import.meta.url);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('.test.js')) continue;
    const at = `${entry.parentPath}/${entry.name}`;
    const key = at.slice(at.indexOf('/satellite/') + 1).replace(/\/{2,}/g, '/');
    files[key] = readFileSync(at, 'utf8');
  }
  return files;
}

describe('Satellite saved work', () => {
  // The indexes, the filter, the Locate pass and the row actions are the store's
  // (`satellite/state/saved.svelte.test.js`, which exercises them for real).
  // What is this file's business is that the tool hands them over.
  it('hands one store to the tree, the search and the map overlay', () => {
    expect(source).toContain("import { createSavedState } from './satellite/state/saved.svelte.js'");
    expect(source).toContain('<SavedTree');
    expect(source).toContain('<SavedSearch');
    expect(source).toContain('<SavedOverlay');
    expect(source).toContain('rows={savedWork.shownRows}');
    // the overlay draws the panel's filtered selection, never the whole index
    expect(source).toContain('items={savedWork.shown}');
    expect(source).not.toContain('items={savedWork.rows}');
  });

  it('loads and drops both indexes with the case, through the store', () => {
    expect(source).toContain('return savedWork.load(id);');
    expect(source).toContain('savedWork.loadProofs(caseState.current?.id, caseState.rev)');
  });

  it('closes over this case for every row action', () => {
    // a pass or a PATCH must never land in the case the analyst just left
    expect(source).toContain('savedWork.accept(caseState.current.id, row)');
    expect(source).toContain('savedWork.move(caseState.current.id, row, folder)');
    expect(source).toContain('savedWork.runLocate(caseState.current?.id)');
    expect(source).toContain('await savedWork.remove(caseId, row)');
  });

  it('drops the dialogs and the session layers before another case', () => {
    const effect = source.slice(
      source.indexOf('if (openFor !== id)'),
      source.indexOf('return savedWork.load(id);')
    );
    expect(effect).toContain('savedSearchOpen = false');
    expect(effect).toContain('deleteTarget = null');
    expect(effect).toContain('notesItem = null');
    expect(effect).toContain('placeModal = null');
    expect(effect).toContain('temporalMap = null');
    expect(effect).toContain('sheetPoints = null');
  });

  it('keeps the map overlay off by default and out of the case file', () => {
    expect(source).toContain('let savedOverlay = $state(false)');
    expect(source).toContain('{#if savedOverlay}');
    expect(cluster).toContain('savedOverlay = $bindable()');
    expect(cluster).toContain('onclick={() => (savedOverlay = !savedOverlay)}');
    // nothing about the overlay is written back to the case — session only
    expect(source).not.toContain('savedOverlay:');
  });

  it('shares one hovered id between the panel and the map', () => {
    expect(source).toContain('let hoveredSavedId = $state(null)');
    expect((source.match(/bind:hoveredId=\{hoveredSavedId\}/g) ?? []).length).toBe(3);
  });

  it('opens a proof rather than queueing it as a panel of a new one', () => {
    expect(source).toContain("if (item.kind === 'proof') {");
    expect(source).toContain('uiState.openProof = item.name');
  });

  it('opens a linked post in the existing Post Composer draft flow', () => {
    expect(source).toContain('function openLinkedPost(post)');
    expect(source).toContain('uiState.openDraft = post.name');
    expect(source).toContain('onpost={openLinkedPost}');
  });

  it('reveals a capture the case sidebar points at, whatever the filter was', () => {
    expect(source).toContain("savedWork.kind = 'all'");
    expect(source).toContain("savedWork.query = ''");
    expect(source).toContain('revealSavedId = row.id');
  });
});

describe('Capture extension settings handoff', () => {
  it('opens the extension section from both Satellite entry points', () => {
    expect(source.match(/uiState\.settingsTab = 'extension'/g)).toHaveLength(2);
  });
});

describe('filing saved work from its details dialog', () => {
  const captureDialog = readFileSync(
    new URL('./satellite/CaptureDetails.svelte', import.meta.url),
    'utf8'
  );

  it('offers the same folder picker the rest of the app uses, in both dialogs', () => {
    expect(captureDialog).toContain("import FolderSelect from '../../components/FolderSelect.svelte'");
    expect(captureDialog).toContain('bind:value={folder}');
    expect(captureDialog).toContain('emptyLabel="My work (root)"');
    const placeDialog = readFileSync(
      new URL('./satellite/PlaceDialog.svelte', import.meta.url),
      'utf8'
    );
    expect(placeDialog).toContain("import FolderSelect from '../../components/FolderSelect.svelte'");
    expect(placeDialog).toContain('bind:value={draft.folder}');
    expect(placeDialog).toContain('emptyLabel="My work (root)"');
  });

  it('opens each dialog on the folder the item is already in', () => {
    expect(captureDialog).toContain("let folder = $state(row.folder ?? '')");
    expect(source).toContain("folder: row.folder ?? ''");
  });

  it('files a capture in the patch it already sends', () => {
    expect(source).toContain('{ path: notesItem.path, notes, title, folder }');
  });

  it('files a place, whether it is being saved or edited', () => {
    expect(source).toContain("attrs: { notes: m.notes.trim(), folder: m.folder ?? '' }");
    expect(source).toContain('folder: m.folder,');
  });
});

describe('reference windows', () => {
  // When the case is read, where the windows live and how they stack are the
  // store's (`satellite/state/refs.svelte.test.js`); the picker itself is
  // `satellite/RefPicker.svelte`. What is this file's business is that the tool
  // hands one store to all three places the windows are touched.
  it('hands one store to the cluster, the picker and the windows', () => {
    expect(source).toContain("import { createRefsState } from './satellite/state/refs.svelte.js'");
    expect(source).toContain('referenceCount={refs.open.length}');
    expect(source).toContain('openRefPicker={() => refs.openPicker()}');
    expect(source).toContain('{#each refs.open as pane (pane.id)}');
    expect(source).toContain('onpick={(item) => refs.add(item)}');
  });

  it('keeps the windows in the session, never in the case', () => {
    // the store holds no list of its own: it reads and writes the tab's, which
    // is what makes the windows survive a tool switch and die with the tab
    expect(source).toContain('viewers: () => uiState.refViewers');
    expect(source).toContain('setViewers: (windows) => (uiState.refViewers = windows)');
    expect(source).not.toContain('refViewers:');
  });

  it('leaves them out of a screen capture, wherever the crop is taken', () => {
    // the rule is stated once, on the surface that owns the grab
    const surfaces = satelliteSources();
    expect(surfaces['satellite/MapSurface.svelte']).toContain('.map-wrap.grabbing');
  });
});

describe('the saved panel is resizable', () => {
  it('drives the width from the shared panel helpers, with its own key and range', () => {
    expect(source).toContain("import { panelWidth } from '../lib/panelWidth.js'");
    expect(source).toContain("key: 'azimut:satelliteSavedW'");
    expect(source).toContain('let savedW = $state(savedPanel.loadWidth())');
    expect(source).toContain('style={capturesCollapsed ? undefined : `width: ${savedW}px`}');
  });

  it('clamps every width it sets against the live window', () => {
    expect(source).toContain('savedW = savedPanel.clampWidth(w, window.innerWidth)');
    // nothing sets the width past the clamp
    expect((source.match(/savedW = /g) ?? []).length).toBe(2); // the $state, then setSavedWidth
  });

  it('gives the handle a keyboard path and a double-click reset', () => {
    expect(source).toContain('onpointerdown={startSavedResize}');
    expect(source).toContain('ondblclick={resetSavedWidth}');
    expect(source).toContain('onkeydown={onSavedResizeKey}');
    expect(source).toContain('aria-label="Resize the saved panel"');
  });

  it('stores the width once the drag ends, not on every frame', () => {
    expect(source).toContain('savedPanel.saveWidth(savedW); // one write per drag');
  });

  it('leaves the left button to whichever mode is armed for it', () => {
    // shift and the left button turn the map, but the capture marquee and the
    // grid box are both waiting on that same drag
    expect(source).toContain(
      "e.button === 0 && e.shiftKey && !capture.armed && grid.drawMode !== 'rect'"
    );
  });

  it('redraws the map for the new size', () => {
    expect(source).toContain('engine?.resize()');
  });

  it('hides the handle when the panel is collapsed to its rail', () => {
    expect(source).toContain('{#if !capturesCollapsed}');
  });
});

describe('filing saved work by dragging it in the panel', () => {
  it('hands the tree both groupings, the case folders and a move handler', () => {
    expect(source).toContain('bind:group={savedWork.group}');
    expect(source).toContain('onmove={moveSaved}');
    expect(source).toContain('folders={caseState.current?.folders ?? []}');
  });

  it('leaves folder browsing out of the search modal', () => {
    const modal = source.slice(source.indexOf('<SavedSearch'));
    expect(modal).not.toContain('onmove');
  });
});

describe('sun and moon mode', () => {
  // Where the path is anchored, what is asked of the backend and what reaches
  // the map are the store's (`satellite/state/sky.svelte.test.js`), and the
  // geometry under it is `lib/skyOverlay.js`, which has its own. What is left
  // here is what the mode means *in this tool*: one map mode among the others.
  it('is a map mode in the tool cluster, exclusive with the others', () => {
    expect(source).toContain("import { createSkyState } from './satellite/state/sky.svelte.js'");
    expect(source).toContain('{toggleSunMode}');
    // the same exclusivity the grid mode declares
    expect(source).toContain('if (capture.armed) toggleSelect()');
    expect(source).toContain('if (grid.on) toggleGridMode()');
    expect(source).toContain('else if (sky.on) toggleSunMode()'); // the Esc cascade
  });

  it('opens on the moved pin when there is one, else on the view', () => {
    expect(source).toContain('sky.open(markerLatLng ?? { lat: center.lat, lon: center.lon })');
  });

  it('redraws the arc when the view moves, since it is drawn in metres', () => {
    expect(source).toContain("return engine.on('view-settled', () => sky.draw())");
  });

  it('takes the handoff from Coords & Sky into the same mode', () => {
    expect(source).toContain('const handed = uiState.skyAt');
    expect(source).toContain('uiState.skyAt = null'); // consumed once, like gotoCoords
    expect(source).toContain('if (!sky.on) toggleSunMode()');
    // no computed value travels: the store asks for its own
    expect(source).not.toContain('handed.sun');
  });

  it('hands the panel the store, not a copy of its numbers', () => {
    expect(source).toContain('<SunPanel');
    expect(source).toContain('sky={sky.sky}');
    expect(source).toContain('onindex={(value) => sky.setIndex(value)}');
  });
});

describe('the capture button', () => {
  // The frame, the two roads to a filed crop and every refusal are the store's
  // (`satellite/state/capture.svelte.test.js`). What is this file's business is
  // the wiring only it can do: the shared drag outline, the mode exclusivity,
  // and giving the store the map element it does not own.
  it('hands one store to the options popover and both dialogs', () => {
    expect(source).toContain(
      "import {\n    createCaptureState,\n    PRESETS,\n    RATIOS,\n  } from './satellite/state/capture.svelte.js';"
    );
    expect(source).toContain('<CaptureOptions');
    expect(source).toContain('runCapture={() => capture.run()}');
    expect(source).toContain('capturing={capture.busy}');
    expect(source).toContain('{#if capture.shotOpen}');
    expect(source).toContain('{#if capture.extGate}');
  });

  it('asks the surface what drew the pixels, never the provider that was picked', () => {
    // an eco or soft-block fallback means the two differ, and provenance has to
    // name the imagery actually on screen
    expect(source).toContain('provenance: () => surface.provenance()');
  });

  it('shares one live outline with the grid rectangle, since one gesture draws both', () => {
    expect(source).toContain('onRect: (rect) => (selRect = rect)');
    expect(source).toContain('let selRect = $state(null);');
    // …and the grid's own drag writes the same outline
    expect(source).toContain('onChange: (rect) => (selRect = rect)');
  });

  it('cannot be armed at the same time as a measure tool', () => {
    // each direction is stated once: arming the marquee disarms measuring…
    expect(source).toContain('onArm: () => setMeasureMode(null)');
    // …and arming a measure tool disarms the marquee
    expect(source).toContain('if (measure.setMode(mode)) capture.disarm()');
  });

  it('gives the store the map element rather than reaching for one itself', () => {
    expect(source).toContain('element: () => mapEl');
    expect(source).toContain('function onSelectDrag(e)');
    expect(source).toContain("element.addEventListener('mousedown', onSelectDrag, true)");
    expect(source).toContain("element.removeEventListener('mousedown', onSelectDrag, true)");
  });
});

describe('accepting a proposed point from the Saved panel', () => {
  it('offers it wherever the panel lists a row', () => {
    // the tree and the search modal read the same index, so both offer it
    expect((source.match(/onaccept=\{acceptSaved\}/g) ?? []).length).toBe(2);
  });
});

describe('Satellite — lifecycle and the date line', () => {
  it('registers a teardown Svelte will actually call', () => {
    // Svelte only honours a cleanup returned from a *synchronous* onMount, and
    // the setup awaits the providers and the saved home view.
    expect(source).toContain('onMount(() => {');
    expect(source).not.toContain('onMount(async () => {');
    expect(source).toContain('async function build()');
    expect(source).toContain('teardown?.();');
  });

  it('takes the centre as the surface hands it over, and never rewraps it', () => {
    // Folding a centre back inside ±180 across the antimeridian is stated once,
    // in lib/map (facade.test.js). A second place reaching for wrapLon would be
    // a second place that guarantee could be got wrong — and now that the map
    // is a component, the tool only ever reads the view it reports.
    const surfaces = satelliteSources();
    expect(surfaces['satellite/MapSurface.svelte']).toContain(
      "engine.on('view-settled', (settled) => {"
    );
    expect(surfaces['satellite/MapSurface.svelte']).toContain(
      'view = { lat: settled.lat, lon: settled.lon, zoom: settled.zoom };'
    );
    for (const [name, text] of Object.entries(surfaces)) {
      expect(text, name).not.toContain('wrapLon');
    }
  });

  it('builds the map in one place, so a second one costs nothing to mount', () => {
    // The engine, its basemap and everything describing the pixels are the
    // surface's; the tool mounts one today and several for Compare.
    const surfaces = satelliteSources();
    expect(surfaces['satellite/MapSurface.svelte']).toContain(
      "import { createMapEngine } from '../../lib/map/engine.js';"
    );
    expect(source).toContain("import MapSurface from './satellite/MapSurface.svelte';");
    expect(source).not.toContain('createMapEngine');
    expect(source).not.toContain('createBasemaps');
  });

  it('goes through the façade for the camera, not through the engine', () => {
    // What must never come back is a tool moving, projecting or measuring the
    // map itself: that is the whole point of `lib/map`, and it is what made
    // replacing the engine a rewrite of five modules instead of a tool.
    for (const [name, text] of Object.entries(satelliteSources())) {
      expect(text, name).not.toContain('map.setView');
      expect(text, name).not.toContain('map.getCenter');
      expect(text, name).not.toContain('map.containerPointToLatLng');
      expect(text, name).not.toContain('map.latLngToContainerPoint');
    }
  });

  it('names no engine at all, not even in a class or a comment', () => {
    // The engine's chrome is dressed in lib/map/engine.css, and a mode armed
    // above the map says so on `.map-surface`, whichever engine drew it. This
    // held across one engine change; it is what will make the next one cheap.
    for (const [name, text] of Object.entries(satelliteSources())) {
      expect(text.toLowerCase(), name).not.toContain('leaflet');
      expect(text.toLowerCase(), name).not.toContain('maplibre');
    }
  });
});

describe('Satellite — the search bar', () => {
  it('is the suggesting combobox, fed by the case and the map centre', () => {
    expect(source).toContain("import PlaceSearch from './satellite/PlaceSearch.svelte';");
    expect(source).toContain('<PlaceSearch');
    expect(source).toContain('savedRows={savedWork.rows}');
    expect(source).toContain('centre={{ lat: center.lat, lon: center.lon }}');
    expect(source).toContain('units={prefs.units}');
    // the plain form it replaces is gone, not left beside it
    expect(source).not.toContain('class="go-form"');
  });

  it('keeps the old Enter behaviour as the fallback', () => {
    // Enter with nothing highlighted still parses or geocodes the raw text
    expect(source).toContain('onsubmit={goTo}');
    expect(source).toContain("await api.get(`/api/geo/geocode?q=");
  });

  it('opens a chosen saved item the way the panel does', () => {
    // same view and bearing as the tree and the modal — one road to a saved place
    expect(source).toContain('function goToSuggestion(item)');
    expect(source).toContain('if (item.row) {\n      openSaved(item.row);');
  });

  it('flies to a proposed point at the zoom that suits what it is', () => {
    expect(source).toContain('engine.setView(item, item.zoom ?? Math.max(engine.getZoom(), 13));');
  });
});
