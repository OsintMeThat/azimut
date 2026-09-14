import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Satellite.svelte', import.meta.url), 'utf8');
const rail = readFileSync(new URL('./satellite/MapRail.svelte', import.meta.url), 'utf8');
const layers = readFileSync(new URL('./satellite/MapLayers.svelte', import.meta.url), 'utf8');
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

  it('opens the details dialog when a capture row is edited', () => {
    // Edit on a capture, from the map popup or the panel, sets the row the
    // dialog renders; a call to a helper that no longer exists fails silently.
    const edit = source.slice(source.indexOf('function editSaved'));
    const body = edit.slice(0, edit.indexOf('\n  }'));
    expect(body).toContain("row.kind === 'place'");
    expect(body).toContain('notesItem = row');
    for (const [, name] of body.matchAll(/\b(open\w+)\(/g)) {
      expect(source, `${name} is called but never defined`).toMatch(
        new RegExp(`function ${name}\\b|const ${name}\\b`)
      );
    }
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
    // it is a layer, listed with the other layers rather than sitting in the
    // toolbox: nothing about it changes what the pointer does
    expect(source).toContain('toggle: () => (savedOverlay = !savedOverlay)');
    expect(layers).toContain('aria-pressed={Boolean(row.on)}');
    // one eye for both states: only its colour says whether the layer is on
    expect(layers).toContain('<Icon name="eye" size={13} />');
    expect(layers).not.toContain("'ghost'");
    expect(layers).toMatch(/\.eye\.on \{\s*color: var\(--accent\);/);
    expect(rail).not.toContain('savedOverlay');
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
  it('hands one store to the rail, the picker and the windows', () => {
    expect(source).toContain("import { createRefsState } from './satellite/state/refs.svelte.js'");
    // a rail seat that runs rather than arms: it opens a picker and a window
    expect(source).toContain("if (id === 'reference') return refs.openPicker();");
    expect(source).toContain('on: refs.open.length > 0,');
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
  it('is a map mode in the rail, exclusive with the others through the registry', () => {
    expect(source).toContain("import { createSkyState } from './satellite/state/sky.svelte.js'");
    // Exclusivity is declared once, not written out per pair: the mode says how
    // to open and close itself and `arm()` closes whatever else was on.
    expect(source).toContain("arm(modes, 'sky')");
    expect(source).toContain('isOn: () => sky.on,');
    expect(source).toContain('close: () => sky.close(),');
    // the pairwise calls this replaced are gone, in both directions
    expect(source).not.toContain('if (capture.armed) toggleSelect()');
    expect(source).not.toContain('if (grid.on) toggleGridMode()');
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

  it('cannot be armed at the same time as any other map mode', () => {
    // The marquee is armed from the Capture button rather than from the rail,
    // so it reports in to the registry instead of naming the one other mode it
    // used to know about — which left Grid Search and the sun path open.
    expect(source).toContain("onArm: () => closeOthers(modes, 'capture')");
    expect(source).toContain('capture: {');
    expect(source).toContain('close: () => capture.disarm(),');
    // …and a measure sub-mode still puts the marquee away
    expect(source).toContain('if (measure.setMode(mode)) capture.disarm()');
  });

  it('gives the store the map element rather than reaching for one itself', () => {
    expect(source).toContain('element: () => mapEl');
    expect(source).toContain('function onSelectDrag(e)');
    expect(source).toContain("element.addEventListener('mousedown', onSelectDrag, true)");
    expect(source).toContain("element.removeEventListener('mousedown', onSelectDrag, true)");
  });
});

describe('what is laid over the imagery', () => {
  const surface = readFileSync(new URL('./satellite/MapSurface.svelte', import.meta.url), 'utf8');

  it('hands the surface the list, not one flag per layer', () => {
    // the surface puts overlays on; which are offered is the tool's business,
    // and a second one used to mean a second prop through the same wall
    expect(source).toContain('{overlays}');
    expect(surface).toContain(
      'for (const id of OVERLAY_IDS) basemaps.setOverlay(id, asked.has(id), asked.get(id))'
    );
  });

  it('offers the railways over any basemap and the labels only over imagery', () => {
    // OSM's own street map already draws its labels twice; it draws a railway
    // as one more line, which is the thing OpenRailwayMap is for
    expect(source).toContain("osmOverlay && baseIsImagery && 'labels'");
    expect(source).toContain("railOverlay && 'railway'");
    const rows = source.slice(source.indexOf('const layerRows = $derived(['));
    expect(rows.slice(0, 900)).toContain("label: 'OSM railways'");
    expect(rows.slice(0, 900)).toContain('toggle: () => (railOverlay = !railOverlay)');
  });

  it('gives neither of them a rail seat', () => {
    expect(rail).not.toContain('railOverlay');
    expect(rail).not.toContain('osmOverlay');
  });

  it('fetches no railway tile until it is asked for', () => {
    // local-first: a map that is not showing railways phones nobody
    expect(source).toContain('let railOverlay = $state(false);');
  });

  it('reads what the fire layer can be asked without phoning NASA', () => {
    // our own backend, reading a catalogue and a settings file: safe on mount
    expect(source).toContain("await api.get('/api/firms/sensors')");
    expect(source).toContain('on: false,');
  });

  it('hears about a key pasted into Settings on the way back to the tab', () => {
    // tools stay mounted, so there is no fresh onMount to read it again — and
    // a reload to see a layer light up is a reload nobody should need
    const back = source.slice(source.indexOf('// re-sync providers + prefs when returning to this tab'));
    expect(back.slice(0, 700)).toContain('loadFireSensors()');
  });

  it('offers the layer disabled, with the reason, when there is no key', () => {
    const rows = source.slice(source.indexOf('const layerRows = $derived(['));
    expect(rows).toContain('disabled: !fires.keyed');
    expect(rows).toContain('Add a NASA FIRMS key in Settings → Imagery');
  });

  it('asks for no tile until the choice is one the service can answer', () => {
    // a dated window with no date yet is the normal state of a panel someone
    // just switched, not a request
    expect(source).toContain("fires.on && fires.keyed && firmsAskable && { id: 'firms'");
    expect(source).toContain('const firmsAskable = $derived(askable(fires))');
  });

  it('asks its two questions in the row rather than in a card over the map', () => {
    expect(source).toContain('controls: fires.on && fires.keyed ? firmsControls : null');
    const layersPanel = readFileSync(
      new URL('./satellite/MapLayers.svelte', import.meta.url),
      'utf8'
    );
    expect(layersPanel).toContain('{#if row.controls?.length}');
    expect(layersPanel).not.toContain('position: absolute');
  });
});

describe('choosing which saved work is drawn', () => {
  it('asks the layer\'s own two questions where the layer is listed', () => {
    // the same state the Saved panel binds, so a map read here and a panel read
    // beside it cannot disagree about what the case holds
    expect(source).toContain('controls: savedOverlay && savedWork.rows.length ? savedFilters : null');
    expect(source).toContain('pick: (id) => (savedWork.kind = id)');
    expect(source).toContain("pick: (id) => (savedWork.folder = id === 'all' ? null : id)");
  });

  it('offers the folder control only where there is a choice to make', () => {
    expect(source).toContain('if (folders.length > 1)');
  });

  it('picks folders from a list, since the analyst names them and there can be many', () => {
    expect(source).toContain('list: true');
    expect(layers).toContain('{#if control.list}');
    expect(layers).toContain('onchange={(event) => control.pick(event.currentTarget.value)}');
  });

  it('stacks a setting\'s options under their label rather than trailing them', () => {
    // right-aligned wrapping turned a handful of options into a staircase, one
    // per line, in a panel this narrow
    expect(layers).not.toContain('justify-content: flex-end');
    expect(layers).not.toContain('justify-content: space-between');
  });

  it('counts what is drawn rather than what the case holds', () => {
    expect(source).toContain('detail: savedWork.shown.length ? String(savedWork.shown.length)');
  });
});

describe('tracing a place\'s footprint', () => {
  it('is armed from that place\'s own card, never from the rail', () => {
    expect(source).toContain('ontrace={startTrace}');
    expect(source).toContain("closeOthers(modes, 'footprint')");
    // the registry still has to know it exists, or arming it would leave a
    // second mode waiting for the same click
    expect(source).toContain('footprint: {');
  });

  it('owns the map click while it is tracing', () => {
    expect(source).toContain('if (footprint.addPoint(at)) return;');
  });

  it('gives the panel slot the place it is tracing for', () => {
    expect(source).toContain('<FootprintPanel');
    expect(source).toContain('place={footprint.place}');
    // and whether the shape holds that place's own pin, which is what the panel
    // refuses on: a polygon traced beside the point describes somewhere else
    expect(source).toContain('covers={footprint.covers}');
  });
});

describe('the full editor, reached from the map', () => {
  // The dialog that saves a place asks for what an analyst fills at that moment;
  // everything else a place holds is edited in the panel every other surface opens,
  // so the map hands over to it rather than keeping a second copy of that form.
  const dialog = readFileSync(new URL('./satellite/PlaceDialog.svelte', import.meta.url), 'utf8');

  it('is offered from the place dialog, for a place that exists', () => {
    expect(dialog).toContain('{#if draft.id && ondetails}');
    expect(dialog).toContain('Edit more details');
    expect(source).toContain('ondetails={openPlaceDetails}');
  });

  it('asks before handing over would drop what was typed in the short form', () => {
    expect(dialog).toContain('touched ? (discarding = true) : ondetails()');
    expect(dialog).toContain('<ConfirmDialog');
  });

  it('is the same body the sidebar and the Media Library open', () => {
    expect(source).toContain("import EntityDetails from '../components/EntityDetails.svelte'");
    expect(source).toContain('entityId={detailsEntityId}');
    // its fields wait for Save, so Escape and the backdrop ask first
    expect(source).toContain('bind:dirty={detailsDirty}');
    expect(source).toContain('onclose={closeDetails}');
  });
});

describe('the two acts at the foot of the map', () => {
  it('keeps the marker behind one square rather than across the strip', () => {
    // a full-width select and a Move-pin toggle pushed Save place and Capture
    // onto a second row, which sat on the engine's own scale bracket
    expect(source).toContain('<MarkerMenu bind:style={markerStyle} free={moveMode}');
    expect(source).not.toContain("title=\"Marker style\"");
    expect(source).not.toContain('class="bar-sep"');
  });

  it('leaves the strip the two things that file something', () => {
    const acts = source.slice(source.indexOf('<MapStatusBar'), source.indexOf('</MapStatusBar>'));
    expect(acts).toContain('Save place');
    expect(acts).toContain('<CaptureOptions');
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

describe('a map in more than one window', () => {
  // The pure halves are `lib/hash.js` and `lib/map/view.js`, each with its own
  // tests. What is this file's business is that the tool opens on what the
  // address says, keeps it there, and can hand it to a second window.
  it('opens on the view in the address rather than the saved home view', () => {
    expect(source).toContain("const opening = splitHash(location.hash)");
    expect(source).toContain('const openingView = readView(opening.params)');
    expect(source).toContain('openingView?.lat != null');
    expect(source).toContain('zoom: openingView.zoom ?? prefs.homeView.zoom,');
    // the surface reads where it opens once, at build, so it has to be handed
    // the same answer the tool gave `center`
    expect(source).toContain('home={openingHome}');
    expect(source).toContain('center = { ...openingHome };');
  });

  it('refuses a basemap the catalogue does not hold, since an address is typed', () => {
    expect(source).toContain('if (openingView?.provider && imagery.find(openingView.provider))');
  });

  it('keeps this window\'s view in this window\'s address', () => {
    expect(source).toContain("history.replaceState(null, '', buildHash('satellite', params))");
    // panning is not navigating: a back button full of camera positions is worse
    // than no history at all
    expect(source).not.toContain('history.pushState');
  });

  it('writes nothing while another tool is open', () => {
    const writer = source.slice(source.indexOf("if (uiState.tool !== 'satellite' || !mapReady) return;"));
    expect(writer.slice(0, 400)).toContain('viewParams({');
  });

  it('opens a peer tab on the view it is showing, and says when refused', () => {
    // a tab, not a popup window: it can be torn onto the second screen and put
    // back, and it is what a browser does not refuse
    expect(source).toContain("window.open(url, '_blank')");
    expect(source).toContain('params.w = String(nextWindowNumber())');
    expect(source).toContain('params.case = caseState.current.id');
    expect(source).toContain('The browser refused a second tab');
  });

  it('greys the link until there is a second map to link to', () => {
    // a lit button that links one tab to nothing is a button that does nothing
    expect(source).toContain('disabled={!peerMaps}');
    expect(source).toContain("'Open a second map tab or the extension map tools to link the views'");
    // …and a link already on is dropped when the last peer goes
    expect(source).toContain('if (!count) linked = false;');
  });

  it('opens that tab on the map alone', () => {
    // the rail, the case bar and the tab strip are how you get somewhere else,
    // and a second screen showing one map is already somewhere (lib/hash.js)
    expect(source).toContain("params.solo = '1'");
  });

  it('numbers a detached window, and leaves the first one unnumbered', () => {
    expect(source).toContain('const windowNumber = readWindowLabel(opening.params)');
    expect(source).toContain('<h2>Satellite{windowNumber ? ` · ${windowNumber}` : \'\'}</h2>');
    expect(source).toContain('if (windowNumber) document.title = `Azimut · Map ${windowNumber}`');
  });

  it('keeps saying what the tab is as it rewrites where it is pointed', () => {
    // rewritten without it, the first pan would turn a detached map back into
    // the whole app on the next reload
    expect(source).toContain("if (solo) params.solo = '1';");
    expect(source).toContain('const solo = readSolo(opening.params)');
  });

  it('follows the other tabs only while the link is pressed', () => {
    expect(source).toContain('let linked = $state(false);');
    expect(source).toContain('if (!linked || !engine) return;');
    expect(source).toContain('viewLink?.send({ lat: center.lat, lon: center.lon, zoom: center.zoom, bearing })');
  });

  it('links to the extension panels on other sites as well as to its own tabs', () => {
    expect(source).toContain('relay: mapLinkRelay(),');
  });

  it('lets the channel go with the tool, so a closed map holds no listener', () => {
    expect(source).toContain('viewLink?.close();');
  });

  it('survives a profile that refuses local storage', () => {
    // the numbering is a label; losing it must not cost the window
    const counter = source.slice(source.indexOf('function nextWindowNumber()'));
    expect(counter.slice(0, 400)).toContain('} catch {');
  });
});

describe('the key-less reference layers', () => {
  it('fetches no tile from any of them until its switch is pressed', () => {
    // local-first: a map not showing borders asks Esri nothing about borders
    const state = source.slice(source.indexOf('const refLayers = $state({'));
    expect(state.slice(0, 200)).not.toContain('true');
    expect(source).toContain("const night = $state({ on: false, source: 'noaa20', day: lastNight() });");
  });

  it('asks for each by id, and the roads only over imagery like the labels', () => {
    for (const id of ['boundaries', 'power', 'seamarks', 'gpstraces']) {
      expect(source).toContain(`refLayers.${id} && '${id}'`);
    }
    expect(source).toContain("refLayers.roads && baseIsImagery && 'roads'");
    expect(source).toContain('if (!baseIsImagery && refLayers.roads) refLayers.roads = false;');
  });

  it('asks GIBS for no night until the choice is one it can answer', () => {
    expect(source).toContain("night.on && nightAskable && { id: 'nightlights', params: nightParams(night) }");
    expect(source).toContain('controls: night.on ? nightControls : null');
  });

  it('warns that a dark night is not an outage by itself', () => {
    expect(source).toContain('Cloud hides lights too, so a dark night is not an outage on its own.');
  });

  it('picks one night from a calendar bounded by the sensor’s record', () => {
    expect(source).toContain('min: firstNight(night.source)');
    expect(source).toContain('max: lastNight()');
    expect(layers).toContain('{#if control.day}');
  });
});

describe('Esri Wayback', () => {
  it('reads the release list only once the basemap is on screen', () => {
    // local-first: opening the tab names no release
    expect(source).toContain('if (mapReady && shown.provider?.id === WAYBACK_ID) wb.loadReleases();');
  });

  it('reads a point’s history only while its picker is open', () => {
    const effect = source.slice(source.indexOf('if (!wb.menuOpen || shown.provider?.id !== WAYBACK_ID) return;'));
    expect(effect.slice(0, 300)).toContain('wb.loadChanges()');
  });

  it('puts the release on the id every tile and capture keys on', () => {
    expect(source).toContain('imagery.displayed(providerId, center.zoom, { ...s2.variant, release: wb.release })');
    expect(source).toContain('wayback={wb}');
  });
});

describe('the right-click menu', () => {
  it('opens on the surface’s own right-click, for the point under the cursor', () => {
    expect(source).toContain('oncontextmenu={onMapContextMenu}');
    expect(source).toContain('<MapContextMenu');
    expect(source).toContain('onpick={onPointMenu}');
  });

  it('is the first thing Escape closes', () => {
    const escape = source.slice(source.indexOf("if (e.key !== 'Escape') return;"));
    expect(escape.slice(0, 200)).toContain('if (pointMenu) return closePointMenu();');
  });

  it('closes when the view moves out from under it', () => {
    expect(source).toContain("return engine.on('view-settled', closePointMenu);");
  });

  it('hands each act the clicked point rather than the map centre', () => {
    const acts = source.slice(source.indexOf('async function onPointMenu(id, value)'));
    const body = acts.slice(0, acts.indexOf('async function lookUpPoint'));
    expect(body).toContain('openNewPlaceAt(point)');
    expect(body).toContain('measure.addPoint(point)');
    expect(body).toContain('sky.handOff({ ...point');
    expect(body).toContain('engine.setView(point');
    expect(body).not.toContain('displayCoords');
  });

  it('drops a lookup answer that arrives after the menu moved on', () => {
    const lookup = source.slice(source.indexOf('async function lookUpPoint(point)'));
    expect(lookup.slice(0, 600)).toContain('if (mine !== pointLookupSeq || !pointMenu) return;');
  });
});
