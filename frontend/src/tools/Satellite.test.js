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

/** The tool and everything it is made of, for the checks that must hold of all of it. */
function satelliteSources() {
  const files = { 'Satellite.svelte': source };
  const dir = new URL('./satellite/', import.meta.url);
  for (const entry of readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || entry.name.endsWith('.test.js')) continue;
    const at = `${entry.parentPath}/${entry.name}`;
    files[at.slice(at.indexOf('/satellite/') + 1)] = readFileSync(at, 'utf8');
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
  // the picker itself is `satellite/RefPicker.svelte`, which owns the search,
  // the folder browser and what an empty case says
  it('reads the case media once, when the picker opens', () => {
    expect(source).toContain('async function openRefPicker()');
    expect(source).toContain('`/api/cases/${id}/media`');
    expect(source).toContain("m.kind === 'image' || m.kind === 'video'");
  });

  it('spawns the window the picker handed back, and closes it', () => {
    expect(source).toContain('onpick={addRef}');
    expect(source).toContain('createViewer(`ref-${++refSeq}`, item');
    expect(source).toContain('refPicker = false;');
  });

  it('keeps the windows out of the case: session state, never captured', () => {
    // they live in uiState for the tab's life, and the crop hides them
    expect(source).toContain('uiState.refViewers');
    expect(source).not.toContain('refViewers:');
    expect(source).toContain('.map-wrap.grabbing');
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
      "e.button === 0 && e.shiftKey && !selectArmed && gridDraw !== 'rect'"
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
  it('is a map mode in the tool cluster, exclusive with the others', () => {
    expect(source).toContain('let sunMode = $state(false)');
    expect(source).toContain('{toggleSunMode}');
    // the same exclusivity the grid mode declares
    expect(source).toContain('if (selectArmed) toggleSelect()');
    expect(source).toContain('if (gridMode) toggleGridMode()');
    expect(source).toContain('else if (sunMode) toggleSunMode()'); // the Esc cascade
  });

  it('anchors the path to a fixed point, never to the moving view', () => {
    expect(source).toContain('let sunAnchor = $state.raw(null)');
    expect(source).toContain('sunAnchor = markerLatLng ?? { lat: center.lat, lon: center.lon }');
    // and a click can move it
    expect(source).toContain('if (sunPlacing) {');
  });

  it('draws only the arc the body sweeps while it is up', () => {
    expect(sky).toContain('export function upRuns(altitudes)');
    expect(sky).toContain('if (altitude >= 0)');
    expect(source).toContain('for (const run of upRuns(body.altitude))');
    expect(source).toContain('measure.destination(origin, azimuth, reach * scale)');
  });

  it('ticks the arc hourly, longer every three hours', () => {
    expect(sky).toContain('if (minute % 60 || altitudes[i] < 0) return');
    expect(sky).toContain('long: minute % 180 === 0');
    expect(source).toContain('hourTicks(curve.minutes, body.altitude)');
  });

  it('rides the body along its own ray, as close to the anchor as it is high', () => {
    // the anchor stands for the zenith and the arc for the horizon, the same
    // radial convention as the compass rosette
    expect(sky).toContain('return (90 - altitude) / 90;');
    expect(source).toContain('at: at(body.azimuth[sunIndex], markScale(altitude))');
    // the glyph is skyOverlay's; the tool only says where the mark rides
    expect(source).toContain('html: bodySvg(');
  });

  it('leaves the ray bare while the body is under the horizon', () => {
    // a mark on it would claim the body is visible
    expect(source).toContain('if (!below) {');
  });

  it('draws the moon mark at its phase, worked out of the lit fraction', () => {
    expect(sky).toContain('Math.acos(clamped) * 180) / Math.PI');
    expect(sky).toContain('litPath(r, illuminated, phaseAngleOf(illuminated))');
    // a plan view has no vertical, so the bright-limb angle is not used here
    expect(sky).toContain('glyphRotation(waxing)');
    expect(sky).not.toContain('glyphRotation(waxing, ');
  });

  it('names the altitude on the mark and on the ray', () => {
    expect(sky).toContain('alt ${Math.round(altitude)}°');
    expect(source).toContain('bodyReading(');
    expect(source).toContain("tip: body.key === 'moon' ? `${reading} · ${sunSky.moon.phase}` : reading");
  });

  it('keeps a body below the horizon on the map, dashed', () => {
    expect(source).toContain('const altitude = body.altitude[sunIndex]');
    expect(sky).toContain('return altitude < 0;');
    expect(source).toContain('const below = isBelow(altitude)');
    expect(source).toContain("dash: below ? '6 6' : null");
  });

  it('scrubs the hour without asking the backend again', () => {
    // the whole day arrived in one response, so the slider reads an array
    expect(sky).toContain('export function nearestSample(clock, wanted)');
    expect(source).toContain('onindex={(value) => (sunIndex = value)}');
    expect(source).toMatch(/if \(sunDay\) params\.set\('date', sunDay\)/);
  });

  it('labels a moment from the payload clock, not from arithmetic on minutes', () => {
    expect(source).toContain('curve.clock[sunIndex]');
    expect(source).not.toContain('Math.floor(minute / 60)');
  });

  it('sizes the arc off the shorter side of the view, so it stays on screen', () => {
    // a radius set by the diagonal runs off the top and bottom of a wide window.
    // How far the view reaches each way is the façade's answer (facade.test.js);
    // which of the two the arc rides on is this tool's.
    expect(source).toContain('const { across, down } = engine.viewSpanMeters()');
    expect(source).toContain('Math.min(across, down) * 0.22');
  });

  it('restretches the arc when the view moves, since it is drawn in metres', () => {
    expect(source).toContain("return engine.on('view-settled', () => drawSun())");
  });

  it('takes the handoff from Coords & Sky into the same mode', () => {
    expect(source).toContain('const handed = uiState.skyAt');
    expect(source).toContain('uiState.skyAt = null'); // consumed once, like gotoCoords
    expect(source).toContain('if (!sunMode) toggleSunMode()');
    // no computed value travels: the map asks for its own
    expect(source).not.toContain('handed.sun');
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

  it('takes the centre as the façade hands it over, and never rewraps it', () => {
    // Folding a centre back inside ±180 across the antimeridian is stated once,
    // in lib/map (facade.test.js). A tool that reached for wrapLon again would
    // be the second place that guarantee could be got wrong.
    expect(source).toContain("engine.on('view-settled', (view) => {");
    expect(source).toContain('center = { lat: view.lat, lon: view.lon, zoom: view.zoom };');
    expect(source).not.toContain('wrapLon');
  });

  it('goes through the façade for the camera, not through the engine', () => {
    // What must never come back is a tool moving, projecting or measuring the
    // map itself: that is the whole point of `lib/map`, and it is what made
    // replacing the engine a rewrite of five modules instead of a tool.
    expect(source).toContain("import { createMapEngine } from '../lib/map/engine.js';");
    expect(source).not.toContain('map.setView');
    expect(source).not.toContain('map.getCenter');
    expect(source).not.toContain('map.containerPointToLatLng');
    expect(source).not.toContain('map.latLngToContainerPoint');
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
