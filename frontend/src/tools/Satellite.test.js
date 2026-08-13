import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('./Satellite.svelte', import.meta.url), 'utf8');
const cluster = readFileSync(
  new URL('./satellite/MapToolCluster.svelte', import.meta.url),
  'utf8'
);
// The sky overlay's geometry moved to `lib/skyOverlay.js`, where it is exercised
// against real numbers (`skyOverlay.test.js`); the tool hands it to Leaflet.
const sky = readFileSync(new URL('../lib/skyOverlay.js', import.meta.url), 'utf8');

describe('Satellite saved work', () => {
  it('opens the case on one compact index, not on every capture row', () => {
    expect(source).toContain('/satellite/index');
    // the flat Places and Captures lists, and everything that served only them
    expect(source).not.toContain('fetchAllEntities');
    expect(source).not.toContain('capturesSubCollapsed');
    expect(source).not.toContain('placesCollapsed');
    expect(source).not.toContain('cap-list');
    expect(source).not.toContain('place-list');
  });

  it('hands the index to the tree, the search and the map overlay', () => {
    expect(source).toContain('<SavedTree');
    expect(source).toContain('<SavedSearch');
    expect(source).toContain('<SavedOverlay');
    expect(source).toContain('rows={savedRows}');
    expect(source).toContain('items={savedShown}');
  });

  it('draws the panel’s filtered selection on the map, not the whole index', () => {
    expect(source).toContain(
      'const savedShown = $derived(filterSaved(savedRows, { kind: savedKind, query: savedQuery }))'
    );
    // the overlay must never be handed the unfiltered index again
    expect(source).not.toContain('items={saved}');
  });

  it('reads the proofs index only once the Proofs position is opened', () => {
    // opening a case must not pay for a view it may never show
    expect(source).toContain('const savedRows = $derived(isMode(savedKind) ? savedProofs : saved)');
    expect(source).toContain('if (!id || !isMode(savedKind) || proofsFor === stamp) return');
    expect(source).toContain('`/api/cases/${id}/proofs/index`');
  });

  it('files a dragged row through its own entity type', () => {
    // a proof filed as a capture would be routed to PATCH /media, which is the
    // sidecar of an image the proof is not
    expect(source).toContain("row.kind === 'proof' ? 'proof'");
  });

  it('re-reads the proofs index when the case is reloaded, not only when it changes', () => {
    // filing a proof reloads the case; keying only on the id would leave the
    // panel showing the folder the proof just left
    expect(source).toContain('const stamp = `${id}:${caseState.rev}`');
  });

  it('drops both saved indexes before loading a different case', () => {
    const effect = source.slice(
      source.indexOf('if (savedFor !== id)'),
      source.indexOf('return () => { live = false; };', source.indexOf('if (savedFor !== id)'))
    );
    expect(effect).toContain('saved = []');
    expect(effect).toContain('savedProofs = []');
    expect(effect).toContain('proofsFor = null');
    expect(effect).toContain('savedSearchOpen = false');
    expect(effect).toContain('deleteTarget = null');
    expect(effect).toContain('notesItem = null');
    expect(effect).toContain('placeModal = null');
    expect(effect).toContain('locateGeneration += 1');
    expect(effect.indexOf('saved = []')).toBeLessThan(effect.indexOf('/satellite/index'));
  });

  it('ignores an earlier case response after the case changes', () => {
    expect(source).toContain('.then((rows) => { if (live) saved = rows; })');
    expect(source).toContain('return () => { live = false; };');
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

  it('shares one hovered id between the panel and the map', () => {
    expect(source).toContain('let hoveredSavedId = $state(null)');
    expect((source.match(/bind:hoveredId=\{hoveredSavedId\}/g) ?? []).length).toBe(3);
  });

  it('keeps the map overlay off by default and out of the case file', () => {
    expect(source).toContain('let savedOverlay = $state(false)');
    expect(source).toContain('{#if savedOverlay}');
    expect(cluster).toContain('savedOverlay = $bindable()');
    expect(cluster).toContain('onclick={() => (savedOverlay = !savedOverlay)}');
    // nothing about the overlay is written back to the case — session only
    expect(source).not.toContain('savedOverlay:');
  });

  it('runs Locate in bounded batches that can be stopped', () => {
    expect(source).toContain('/satellite/locate?limit=${LOCATE_BATCH}');
    expect(source).toContain(
      'while (remaining > 0 && !locateStopped && generation === locateGeneration)'
    );
    expect(source).toContain('oncancelLocate={() => (locateStopped = true)}');
  });

  it('stops the Locate loop when a batch resolves nothing', () => {
    // offline, every batch comes back with the same backlog — looping on that
    // would hammer Nominatim forever
    expect(source).toContain('const stalled = batch.remaining >= remaining');
    expect(source).toContain('if (stalled || throttled) break;');
  });

  it('stops and says so when OpenStreetMap is rate-limiting the address', () => {
    // a 429 is not a lookup failure: running the pass again is exactly the
    // wrong advice, so the pass ends and the toast says to wait
    expect(source).toContain('throttled = Boolean(batch.throttled)');
    expect(source).toContain('OpenStreetMap is rate-limiting this address');
  });

  it('does not let a Locate pass continue in another case', () => {
    expect(source).toContain('const id = caseState.current.id');
    expect(source).toContain('const generation = ++locateGeneration');
    expect(source).toContain('generation === locateGeneration');
    expect(source).toContain('`/api/cases/${id}/satellite/locate?limit=${LOCATE_BATCH}`');
    expect(source).toContain('if (generation !== locateGeneration) return');
  });

  it('reveals a capture the case sidebar points at, whatever the filter was', () => {
    expect(source).toContain("savedKind = 'all'");
    expect(source).toContain("savedQuery = ''");
    expect(source).toContain('revealSavedId = row.id');
  });
});

describe('Capture extension settings handoff', () => {
  it('opens the extension section from both Satellite entry points', () => {
    expect(source.match(/uiState\.settingsTab = 'extension'/g)).toHaveLength(2);
  });
});

describe('filing saved work from its details dialog', () => {
  it('offers the same folder picker the rest of the app uses, in both dialogs', () => {
    expect(source).toContain("import FolderSelect from '../components/FolderSelect.svelte'");
    expect(source).toContain('bind:value={notesFolder}');
    expect(source).toContain('bind:value={placeModal.folder}');
    expect((source.match(/emptyLabel="My work \(root\)"/g) ?? []).length).toBe(2);
  });

  it('opens each dialog on the folder the item is already in', () => {
    expect(source).toContain("notesFolder = row.folder ?? ''");
    expect(source).toContain("folder: row.folder ?? ''");
  });

  it('files a capture in the patch it already sends', () => {
    expect(source).toContain('title: notesTitle, folder: notesFolder');
  });

  it('files a place, whether it is being saved or edited', () => {
    expect(source).toContain("attrs: { notes: m.notes.trim(), folder: m.folder ?? '' }");
    expect(source).toMatch(/notes: m\.notes,\s*\n\s*folder: m\.folder,/);
  });
});

describe('reference picker search', () => {
  it('searches the case media instead of only listing it', () => {
    expect(source).toContain("import { matchesQuery } from '../lib/mediaFilter.js'");
    expect(source).toContain('matchesQuery(m, refQuery)');
    expect(source).toContain('{#each visibleRefMedia as m (m.path)}');
  });

  it('only shows the box once the grid is long enough to need it', () => {
    expect(source).toContain('const REF_SEARCH_MIN = 6');
  });

  it('opens the picker on a cleared query', () => {
    expect(source).toMatch(/refPicker = true;\s*\n\s*refQuery = '';/);
  });

  it('tells the user when the search matched nothing', () => {
    expect(source).toContain('No media matches this search.');
  });

  it('swaps the grid for the folder browser behind the "…" button', () => {
    expect(source).toContain('<FolderBrowser');
    expect(source).toContain('onclick={toggleRefBrowser}');
    expect(source).toContain('entries={refBrowserEntries}');
    expect(source).toContain("rootLabel=\"Case media\"");
    // the browser reads the folder off attrs, like every other picker
    expect(source).toContain("attrs: { folder: m.folder ?? '' }");
  });

  it('keeps the search box up while browsing and filters the rows with it', () => {
    expect(source).toContain('{#if refBrowserOpen || refMedia.length > REF_SEARCH_MIN}');
    expect(source).toContain('matches={(entry) => matchesQuery(entry, refQuery)}');
  });

  it('adds the browsed pick on double-click or the confirm button', () => {
    expect(source).toContain('onconfirm={(entry) => addRef(entry)}');
    expect(source).toContain('disabled={!refBrowseSelection}');
    expect(source).toContain('onclick={confirmRefBrowser}');
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

  it('redraws the map for the new size', () => {
    expect(source).toContain('map?.invalidateSize({ animate: false })');
  });

  it('hides the handle when the panel is collapsed to its rail', () => {
    expect(source).toContain('{#if !capturesCollapsed}');
  });
});

describe('filing saved work by dragging it in the panel', () => {
  it('hands the tree both groupings, the case folders and a move handler', () => {
    expect(source).toContain('bind:group={savedGroup}');
    expect(source).toContain('folders={caseState.current?.folders ?? []}');
    expect(source).toContain('onmove={moveSaved}');
  });

  it('remembers which grouping the panel was left on', () => {
    expect(source).toContain("const GROUP_KEY = 'azimut:satelliteSavedGroup'");
    expect(source).toContain('let savedGroup = $state(loadSavedGroup())');
    expect(source).toContain('localStorage.setItem(GROUP_KEY, savedGroup)');
  });

  it('moves through the shared filing route, then reloads the case', () => {
    expect(source).toContain("import { assignFolder } from '../lib/filing.js'");
    expect(source).toContain('await assignFolder(caseState.current.id, entity, folder)');
    expect(source).toContain(
      "type: row.kind === 'place' ? 'place' : row.kind === 'proof' ? 'proof' : 'capture'"
    );
    expect(source).toContain('await reloadCase();\n      toast(');
  });

  it('leaves folder browsing out of the search modal', () => {
    expect(source).not.toContain('savedBrowsing');
    expect(source).not.toContain('bind:path=');
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
    expect(source).toContain('at(body.azimuth[sunIndex], markScale(altitude))');
    expect(source).toContain('function bodyIcon(kind, colour, illuminated, waxing)');
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
    expect(source).toContain("bindTooltip(body.key === 'moon'");
  });

  it('keeps a body below the horizon on the map, dashed', () => {
    expect(source).toContain('const altitude = body.altitude[sunIndex]');
    expect(sky).toContain('return altitude < 0;');
    expect(source).toContain('const below = isBelow(altitude)');
    expect(source).toContain("dashArray: below ? '6 6' : null");
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
    // a radius set by the diagonal runs off the top and bottom of a wide window
    expect(source).toContain('Math.min(across, down) * 0.22');
    expect(source).toContain('bounds.getNorthWest(), bounds.getNorthEast()');
  });

  it('restretches the arc when the view moves, since it is drawn in metres', () => {
    expect(source).toContain("map.on('zoomend moveend', redraw)");
    expect(source).toContain("map.off('zoomend moveend', redraw)");
    expect(source).toContain('bounds.getNorthWest(), bounds.getSouthWest()');
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
  // import enrichment still proposes places from a file's GPS, and the panel
  // reading them is where they are settled
  it('sends the same PATCH the sidebar does, so one click means one thing', () => {
    expect(source).toContain("status: 'confirmed',");
    expect(source).toContain('onaccept={acceptSaved}');
  });

  it('re-reads the case, or the row would keep claiming it is proposed', () => {
    const fn = source.slice(source.indexOf('async function acceptSaved'));
    expect(fn.slice(0, fn.indexOf('\n  }'))).toContain('await reloadCase()');
  });

  it('offers it in the search modal too, which lists the same index', () => {
    const modal = source.slice(source.indexOf('<SavedSearch'));
    expect(modal.slice(0, modal.indexOf('/>'))).toContain('onaccept={acceptSaved}');
  });
});
