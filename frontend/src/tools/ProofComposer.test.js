import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';

vi.mock('konva', () => ({ default: {} }));

import ProofComposer from './ProofComposer.svelte';
import {
  bindPanelPointerLifecycle,
  createCanvasRenderGate,
  discardDraft,
} from './proof/canvasLifecycle.js';

const source = readFileSync(new URL('./ProofComposer.svelte', import.meta.url), 'utf8');

describe('Proof Composer empty state', () => {
  it('hides proof-specific chrome until a proof is started', () => {
    const { body } = render(ProofComposer);

    expect(body).toContain('Compose a proof');
    expect(body).not.toContain('Freehand (d)');
    expect(body).not.toContain('title-input');
    expect(body).not.toContain('<aside');
    expect(body).not.toContain('House style');
    expect(body).not.toContain('Coordinates');
    expect(body).not.toContain('Annotations');
  });
});

describe('Proof Composer header', () => {
  it('uses the same compact controls as Inspect', () => {
    const header = source.slice(source.indexOf('<div class="tool-header">'), source.indexOf('</div>\n\n  <div class="body">'));

    expect(header).not.toContain('class="btn"');
    expect(header).not.toContain('btn-primary');
    expect(header).toContain('btn-ok');
    expect(header).not.toContain('size={15}');
    expect(header).toContain('Open proof');
    expect(header).toContain("saving ? 'Saving…' : 'Save proof'");
    expect(header).toContain('<Icon name="save" size={14} /> {saving');
    expect(header).not.toContain('<Icon name="check" size={14} /> {saving');
    expect(header).toContain('btn-info');
    expect(source).toContain('align-items: baseline;');
    expect(source).toContain('font-weight: 700;');
  });

  it('exports the current proof and exposes its remembered destination', () => {
    const header = source.slice(source.indexOf('<div class="tool-header">'), source.indexOf('</div>\n\n  <div class="body">'));

    expect(header).toContain("exporting ? 'Exporting…' : 'Export PNG'");
    expect(header).toContain('onclick={exportProofPng}');
    expect(header).toContain('onclick={toggleExportMenu}');
    expect(source).toContain('exportDir = (await readDestinations()).proofs;');
    expect(source).toContain('kind="proofs"');
    expect(source).toContain('confirmLabel="Export here"');
    expect(source).toContain('onchosen={useExportFolder}');
    expect(source).toContain('api.post(`/api/cases/${cid}/proofs/${savedName}/export`)');
    expect(source).toContain('/proofs/export/reveal`');
    expect(source).toContain('if (dirty || !savedName) await save();');
    expect(source).toContain('if (dirty || !savedName) return;');
  });

  it('uses Copy as the main action and keeps export choices in the compact menu', () => {
    const split = source.slice(source.indexOf('<div class="export-split">'), source.indexOf('</div>\n    <button class="btn btn-ok'));
    const menu = source.slice(source.indexOf('<div class="export-menu card"'), source.indexOf('<div class="export-destination"'));

    expect(split).toContain('onclick={copyPng}');
    expect(split).toContain("copying ? 'Copying…' : 'Copy'");
    expect(menu.indexOf("onclick={exportProofPng}")).toBeLessThan(menu.indexOf('onclick={openExportPicker}'));
    expect(menu.indexOf('onclick={openExportPicker}')).toBeLessThan(menu.indexOf('onclick={revealProofExports}'));
    expect(menu).toContain('<span>{exporting ? \'Exporting…\' : \'Export PNG\'}</span>');
    expect(menu).toContain('<span>Export to another folder…</span>');
    expect(menu).toContain('<span>Show export folder</span>');
    expect(source).toContain('await exportProof();');
    expect(source).toContain('.export-main {');
    expect(source).toContain('.export-toggle {');
  });
});

describe('Proof Composer naming', () => {
  it('adopts the canonical filename stem returned by the backend', () => {
    expect(source).toContain('proof.title = result.title;');
  });

  it('checks the current hidden spec path before claiming a saved proof was deleted', () => {
    // Via the shared helper, never a literal: the path moved once already, and a
    // stale one matches nothing, so every save warns the proof was deleted.
    expect(source).toContain("lookupEntity(id, specAttr('proof'), specPath('proof', name))");
    expect(source).not.toContain('`proofs/${name}.json`');
  });
});

describe('Proof Composer pickers', () => {
  it('searches the panel picker and the saved-proof list only past six entries', () => {
    expect(source).toContain("import SearchInput from '../components/SearchInput.svelte'");
    expect(source).toContain('const PICKER_SEARCH_MIN = 6;');
    expect(source).toContain('{#if panelBrowserOpen || pickerItems.length > PICKER_SEARCH_MIN}');
    expect(source).toContain('{#if proofBrowserOpen || openList.length > PICKER_SEARCH_MIN}');
    expect(source).toContain('bind:value={panelQuery}');
    expect(source).toContain('bind:value={proofQuery}');
    expect(source).toContain('{#each visiblePanelItems as item (item.src)}');
    expect(source).toContain('{#each visibleProofs as entry (entry.name)}');
  });

  it('offers the Inspect folder browser behind the "…" in both pickers', () => {
    expect(source).toContain("import FolderBrowser from '../components/FolderBrowser.svelte'");
    expect(source).toContain('function togglePanelBrowser()');
    expect(source).toContain('function toggleProofBrowser()');
    expect(source).toContain('onconfirm={(item) => selectPanelBrowser(item, true)}');
    expect(source).toContain('onconfirm={(entry) => selectProofBrowser(entry, true)}');
    expect(source).toContain('disabled={!panelBrowseSelection} onclick={confirmPanelBrowser}');
    expect(source).toContain('disabled={!proofBrowseSelection} onclick={confirmProofBrowser}');
    expect(source).not.toContain('>Back</button>');
  });

  it('filters panels by satellite / other images, like the Create proof dialog', () => {
    expect(source).toContain("import PanelCategories from './proof/PanelCategories.svelte'");
    expect(source).toContain('<PanelCategories items={pickerItems} category={panelCategory} onpick={setPanelCategory} />');
    expect(source).toContain("filterProofPanelItems(pickerItems, '', panelCategory)");
  });

  it('calls a capture satellite exactly when the Media Library does', () => {
    expect(source).toContain("import { isSatelliteMedia } from '../lib/mediaFilter.js'");
    expect(source).toContain("kind: isSatelliteMedia(s) ? 'satellite' : 'media'");
    // captures are dropped from the media half by path, so a Street View grab
    // is listed once, under Other images, instead of twice
    expect(source).toContain('const captured = new Set(sats.map((s) => s.path));');
    expect(source).toContain('!captured.has(m.path)');
    expect(source).not.toContain('isSatelliteCapture');
  });

  it('searches panels by their title, not by the file name', () => {
    expect(source).toContain('label: m.title || m.filename');
    expect(source).toContain('placeholder="Search titles…"');
  });

  it('files panels and saved proofs by their case folder', () => {
    expect(source).toContain("folder: m.folder ?? ''");
    expect(source).toContain("folder: s.folder ?? ''");
    expect(source).toContain("fetchAllEntities(caseState.current.id, { types: ['proof'] })");
    expect(source).toContain('folders.get(entry.spec_path)');
  });
});

describe('Proof Composer empty canvas', () => {
  it('keeps the drawing rail out until a proof is open', () => {
    const rail = source.slice(source.indexOf('<div class="body">'), source.indexOf('<ProofCanvas'));

    expect(rail).toContain('{#if proofStarted}');
    expect(rail).toContain('<ProofToolbar');
  });
});

describe('Proof Composer drawing tools own the canvas', () => {
  it('mutes the document and its handles while a drawing tool is active', () => {
    const rule = source.slice(
      source.indexOf('function syncCanvasListening'),
      source.indexOf('function docPoint'),
    );

    expect(rule).toContain("const live = tool === 'select' && !spacePan;");
    expect(rule).toContain('docLayer?.listening(live);');
    expect(rule).toContain('uiLayer?.listening(live);');
    // Hold-space panning went through its own switch once. Two rules meant the
    // second could hand the canvas back while a drawing tool still held it.
    expect(source).not.toContain('docLayer.listening(false)');
    expect(source).not.toContain('docLayer?.listening(true)');
  });

  it('leaves the colour, size and keyboard acts to the tool that can show them', () => {
    expect(source).toContain("const editableShapes = $derived(tool === 'select' ? selectedShapes : []);");

    const controls = source.slice(
      source.indexOf('function setColor'),
      source.indexOf('// Arrow-key nudge'),
    );
    expect(controls).not.toContain('selectedShape');
    expect(source).toContain("(e.key === 'Delete' || e.key === 'Backspace') && tool === 'select'");
  });
});

describe('Proof Composer panel pointer lifecycle', () => {
  function fakeGroup() {
    const handlers = new Map();
    const group = { on: vi.fn((events, handler) => handlers.set(events, handler)) };
    return { handlers, group };
  }

  const panelHit = () => ({ target: { name: () => 'panel-hit' } });

  it('does not select and rebuild the panel during pointerdown', () => {
    const { group, handlers } = fakeGroup();
    const onPress = vi.fn();
    const onSelect = vi.fn();

    bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd: null });
    handlers.get('pointerdown')(panelHit());

    expect(onPress).toHaveBeenCalledOnce();
    expect(onSelect).not.toHaveBeenCalled();

    handlers.get('click tap')(panelHit());
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it('selects a dragged panel only after the drag has ended', () => {
    const { group, handlers } = fakeGroup();
    const calls = [];

    bindPanelPointerLifecycle(group, {
      onPress: vi.fn(),
      onSelect: () => calls.push('select'),
      onDragEnd: () => calls.push('commit'),
    });
    handlers.get('dragend')({ target: group });

    expect(calls).toEqual(['select', 'commit']);
  });

  it('ignores click and drag events bubbled from an annotation', () => {
    const { group, handlers } = fakeGroup();
    const onPress = vi.fn();
    const onSelect = vi.fn();
    const onDragEnd = vi.fn();
    const annotation = { name: () => '' };

    bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd });
    handlers.get('pointerdown')({ target: annotation });
    handlers.get('click tap')({ target: annotation });
    handlers.get('dragend')({ target: annotation });

    expect(onPress).not.toHaveBeenCalled();
    expect(onSelect).not.toHaveBeenCalled();
    expect(onDragEnd).not.toHaveBeenCalled();
  });
});

describe('Proof Composer canvas render gate', () => {
  function setup() {
    const callbacks = new Map();
    let nextId = 1;
    const schedule = vi.fn((callback) => {
      const id = nextId++;
      callbacks.set(id, callback);
      return id;
    });
    const cancel = vi.fn((id) => callbacks.delete(id));
    const rebuild = vi.fn();
    const refreshUi = vi.fn();
    const gate = createCanvasRenderGate(schedule, cancel, { rebuild, refreshUi });
    const runFrame = () => {
      const [id, callback] = callbacks.entries().next().value ?? [];
      if (!callback) return;
      callbacks.delete(id);
      callback();
    };
    return { gate, schedule, cancel, rebuild, refreshUi, callbacks, runFrame };
  }

  it('defers a reactive rebuild until the pointer gesture has ended', () => {
    const { gate, schedule, rebuild, runFrame } = setup();

    gate.beginPointer();
    gate.requestRebuild();

    expect(schedule).not.toHaveBeenCalled();
    expect(rebuild).not.toHaveBeenCalled();

    gate.endPointer();
    expect(schedule).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('coalesces repeated state changes into one rebuild', () => {
    const { gate, schedule, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.requestRebuild();
    gate.requestRebuild();

    expect(schedule).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('does not rebuild when a new pointer starts before the frame runs', () => {
    const { gate, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.beginPointer();
    runFrame();
    expect(rebuild).not.toHaveBeenCalled();

    gate.endPointer();
    runFrame();
    expect(rebuild).toHaveBeenCalledOnce();
  });

  it('refreshes selection UI without rebuilding the document', () => {
    const { gate, rebuild, refreshUi, runFrame } = setup();

    gate.requestUi();
    runFrame();

    expect(refreshUi).toHaveBeenCalledOnce();
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('lets a document rebuild absorb a queued selection refresh', () => {
    const { gate, rebuild, refreshUi, runFrame } = setup();

    gate.requestUi();
    gate.requestRebuild();
    runFrame();

    expect(rebuild).toHaveBeenCalledOnce();
    expect(refreshUi).not.toHaveBeenCalled();
  });

  it('cancels a queued rebuild when the canvas is destroyed', () => {
    const { gate, cancel, rebuild, runFrame } = setup();

    gate.requestRebuild();
    gate.destroy();

    expect(cancel).toHaveBeenCalledOnce();
    runFrame();
    expect(rebuild).not.toHaveBeenCalled();
  });
});

describe('Proof Composer panel previews', () => {
  it('builds picker cells from the cached thumbnail, never the full-size image', () => {
    // a satellite capture is a multi-megabyte PNG: rendering it in a 150px cell
    // is what made "Add panel" and "New proof" crawl
    expect(source).toContain("import { pollWhile } from '../lib/poll.js'");
    expect(source).toContain('...panelPreview(s)');
    expect(source).toContain('...panelPreview(m)');
    expect(source).not.toContain('thumb: s.path');
    expect(source).not.toContain('thumb: m.thumbnail ?? m.path');
  });

  it('renders a placeholder instead of an <img> while a thumbnail is missing', () => {
    expect(source).toContain('{#if item.thumb}');
    expect(source).toContain('{:else if item.thumbPending}');
  });

  it('re-lists the picker while the worker is still generating thumbnails', () => {
    expect(source).toContain(
      "const pickerThumbsPending = $derived(pickerItems.some((i) => i.thumbPending));"
    );
    expect(source).toContain(
      'pollWhile(() => pickerThumbsPending, () => refreshPickerItems(), 1500)'
    );
  });
});

describe('Proof Composer saved-proof list', () => {
  it('never blocks the list on the full-resolution export', () => {
    // the saved PNG is the export itself; it is decoded lazily and off the
    // main thread so opening the list stays instant
    const row = source.slice(source.indexOf('<div class="open-list">'), source.indexOf('open-del'));
    expect(row).toContain('loading="lazy"');
    expect(row).toContain('decoding="async"');
  });

  it('shows the export thumbnail, falling back to the export itself', () => {
    // a proof saved before thumbnails existed has none until the listing
    // backfills it, and one that could not be rendered never gets one
    const row = source.slice(source.indexOf('<div class="open-list">'), source.indexOf('open-del'));
    expect(row).toContain('{#if entry.thumb || entry.png}');
    expect(row).toContain('fileUrl(caseState.current.id, entry.thumb ?? entry.png)');
  });
});

describe('Proof naming', () => {
  it('names a fresh proof "Proof N", numbered past the case', () => {
    expect(source).toContain("const freshTitle = () => nextName('proof', savedProofTitles());");
    expect(source).toContain("savedTitles(proofEntities, 'proof')");
    expect(source).not.toContain('Untitled proof');
  });

  it('names the proof in the header and nowhere else', () => {
    expect(source).toContain('<input\n        class="input title-input"\n        bind:value={proof.title}');
    expect(source).not.toContain('newProofName');
  });

  it('renames in place: saving sends the bound slug so the backend moves the file', () => {
    expect(source).toContain('rename_from: savedName,');
    expect(source).toContain('title: proof.title,');
  });

  it('asks before an unbound proof takes a name another proof holds', () => {
    expect(source).toContain("if (!savedName && savedProofNames().has(slugify(proof.title, 'proof')))");
    expect(source).toContain('title="Overwrite this proof?"');
  });
});

describe('Proof Composer pasted images', () => {
  it('keeps a pasted image out of the case: no panel, no source, no media', () => {
    // it goes into its own array, so nothing that walks `panels` can mistake it
    // for evidence — the save files derived-from edges from panels alone
    expect(source).toContain("title: '', panels: [], pastes: []");
    expect(source).not.toContain('proof.panels.push(paste');
    expect(source).toContain('proof.pastes.unshift(paste)');
    // the picker and the ingest are never involved
    expect(source).toContain('accept="image/png,image/jpeg,image/webp"');
    expect(source).not.toContain('/api/cases/${c.id}/media');
  });

  it('needs a panel before an image has anywhere to land', () => {
    expect(source).toContain('if (!proof.panels.length) {');
    expect(source).toContain('Add a panel before adding an overlay');
  });

  it('lets one paste handler decide between an image and a copied annotation', () => {
    expect(source).toContain('onpaste={onPaste}');
    expect(source).toContain("i.type.startsWith('image/')");
    // the old Ctrl+V keydown branch would have swallowed the paste event
    expect(source).not.toContain("k === 'v' && clipboard");
    // and a paste into the title or a caption stays text
    expect(source).toContain('isTextTarget(e.target)');
  });

  it('decides that chord on which copy came last', () => {
    // Ctrl+C on a rectangle then Ctrl+V pasted whatever screenshot the system
    // clipboard was holding, because the system one was read first.
    expect(source).toContain('if (clipboard && (shapeCopyFresh || !item))');
    expect(source).toContain('shapeCopyFresh = true;');
  });

  it('hands the chord back to the system clipboard once the analyst leaves', () => {
    // going somewhere else is the only way an outside copy could have happened
    expect(source).toContain("window.addEventListener('blur', release)");
    expect(source).toContain('const release = () => (shapeCopyFresh = false)');
  });

  it('offers the file picker and the drop as well as Ctrl+V', () => {
    expect(source).toContain('{pickImageFile}');
    expect(source).toContain("containerEl.addEventListener('drop', onCanvasDrop)");
    // the drawing rail stays about drawing: adding an overlay lives in its own
    // side section, and pasting is the shortcut
    const rail = source.slice(source.indexOf('<ProofToolbar'), source.indexOf('<ProofCanvas'));
    expect(rail).not.toContain('pickImageFile');
    expect(source).not.toContain('navigator.clipboard.read');
  });

  it('sends a pasted image once, with the save that references it', () => {
    expect(source).toContain('.filter(({ entry }) => entry?.pending && entry.data)');
    expect(source).toContain('assets,');
    expect(source).toContain('if (entry) entry.pending = false;');
    // no upload endpoint of its own: an unsaved proof leaves nothing behind
    expect(source).not.toContain('/assets/upload');
  });

  it('reads pasted images back from the proof folder on open', () => {
    expect(source).toContain('proofs/${entry.name}.assets/${p.asset}');
    expect(source).toContain("pasteAssets.set(p.asset, { img, data: null, pending: false })");
    // annotations bound to a paste survive the reload with it
    expect(source).toContain('const validSurfaces = new Set([...proof.panels, ...proof.pastes]');
  });

  it('never lets a pasted image change the size of the document', () => {
    // docSize is measured from panels and shapes only, and a drag is clamped
    expect(source).toContain('docSize(proof.panels, proof.shapes');
    expect(source).toContain('Object.assign(paste, clampPaste(paste, width, height))');
  });

  it('draws pasted images over the panels and the legend', () => {
    const rebuild = source.slice(source.indexOf('function rebuild()'), source.indexOf("const st = proof.signatureText"));
    expect(rebuild.indexOf('for (let i = proof.panels.length - 1')).toBeLessThan(
      rebuild.indexOf('for (let i = proof.pastes.length - 1')
    );
    // and each one hosts its own annotations, like a panel does
    expect(rebuild).toContain('for (const s of proof.shapes.filter((x) => x.panel === paste.id))');
  });

  it('resizes a pasted image from its corners with the aspect locked', () => {
    // the list has grown a symbol since; what this test guards is that a paste
    // is still on it, not who else joined
    expect(source).toMatch(/transformer\.keepRatio\([^)]*!!pasteNode/);
    expect(source).toContain('implied < PASTE_SCALE_MIN || implied > PASTE_SCALE_MAX');
    expect(source).toContain('|| pasteNode || sigNode');
  });

  it('drops a pasted image with its annotations, and only one thing is selected', () => {
    expect(source).toContain('proof.shapes.filter((s) => s.panel !== paste.id)');
    expect(source).toContain('selectedPasteId = null');
    expect(source).toContain('removePaste(proof.pastes.findIndex((p) => p.id === selectedPasteId))');
  });
});

describe('Proof Composer frames', () => {
  const layers = readFileSync(new URL('./proof/ProofLayersPanel.svelte', import.meta.url), 'utf8');

  it('offers the same colour and thickness control on a panel and on a pasted image', () => {
    expect(layers).toContain('{#snippet frameControl(item)}');
    expect(layers.match(/\{@render frameControl\(/g)).toHaveLength(2);
    expect(layers).toContain('aria-label="border thickness"');
    expect(layers).toContain('setFrame(item, null)');
  });

  it('is decoration: a frame never reaches the legend', () => {
    // the legend is built from shape colours; frames are not shapes
    expect(source).toContain('orderedFeatureColors(proof.shapes');
    expect(source).not.toContain('orderedFeatureColors([...proof.shapes');
    expect(source).toContain('if (panel.frame) group.add(frameNode(panel.frame, panel.natural))');
    expect(source).toContain('if (paste.frame) group.add(frameNode(paste.frame, paste.natural))');
  });

  it('draws the border inset so it cannot move the layout', () => {
    const fn = source.slice(source.indexOf('function frameNode('), source.indexOf('// ---- rebuild canvas'));
    expect(fn).toContain('x: w / 2, y: w / 2');
    expect(fn).toContain('natural[0] - w');
  });
});

describe('POV', () => {
  it('asks what the point means, since the composition cannot say', () => {
    // recorded-at and shows are independent: a rooftop shot is recorded
    // somewhere it never shows
    expect(source).toContain('title="Point of view"');
    expect(source).toContain('onclick={() => togglePov(i)}');
  });

  it('lights one point at most, because a camera stood in one place', () => {
    expect(source).toContain('proof.points.map((one, at) => ({ ...one, pov: on && at === i }))');
  });
});

describe('the points a proof states', () => {
  it('keeps a single-point proof looking exactly as it did', () => {
    // no cross, no arrow: there is nothing to remove and nothing to move
    expect(source).toContain('{#if i > 0}');
    expect(source).toContain('placeholder="lat, lon"');
    expect(source).toContain('placeholder="label"');
  });

  it('materialises the auto point before a second one sits under it', () => {
    // an empty field means "whatever the imagery says", and that answer has to
    // become the conclusion in writing before the list can grow
    expect(source).toContain("if (!proof.points[0].coords.trim()) proof.points[0].coords = displayedCoords;");
  });

  it('chooses the conclusion by order, never by POV', () => {
    expect(source).toContain('function raisePoint(i)');
    expect(source).toContain("Make this the proof's conclusion");
  });

  it('caps the list where the engine caps it', () => {
    expect(source).toContain('if (proof.points.length >= MAX_POINTS) return;');
  });

  it('grows the list from the head, the way the sources do', () => {
    const head = source.slice(source.indexOf('<span>Coordinates</span>'), source.indexOf('placeholder="lat, lon"'));
    expect(head).toContain('{#if proof.points.length < MAX_POINTS}');
    expect(head).toContain('title="Add a point"');
    expect(head).toContain('onclick={addPoint}');
    expect(source).not.toContain('class="point-add"');
  });

  it('redraws the plate when a point or the footer switch changes', () => {
    // both feed the footer, and the footer decides the picture's height: a
    // rebuild that does not read them leaves the export a line behind
    const rebuild = source.slice(source.indexOf('Rebuild only when published document'));
    expect(rebuild.slice(0, rebuild.indexOf('requestRebuild')))
      .toContain('proof.footerCoords, proof.footerText, proof.points,');
  });

  it('measures the footer at the number of lines it will print', () => {
    expect(source).toContain('footerLines: footerLines(proof, prefs.coordFormat).length');
    expect(source).toContain(
      "const printed = proof.footerEnabled !== false ? footerLines(proof, prefs.coordFormat) : [];"
    );
    expect(source).toContain('if (proof.panels.length && printed.length) {');
  });
});

describe("the point a proof concludes on", () => {
  it('files what it can and asks about the rest, never for a point already saved', () => {
    // the server answers with nothing when the case holds those points already
    expect(source).toContain('if (result.place?.filed?.length)');
    expect(source).toContain('if (result.place?.asking?.length)');
  });

  it('asks with the coordinates, since the map is where the point will be read', () => {
    expect(source).toContain('Save this point as a place?');
    expect(source).toContain("'Save these points as places?'");
    expect(source).toContain('this proof and the files it composes will say they show them');
    expect(source).toContain('was recorded at the marked one');
  });

  it('answers through the proof, so the edge is filed with the point', () => {
    expect(source).toContain('/proofs/${encodeURIComponent(offer.name)}/place');
    expect(source).toContain('await reloadCase()');
  });

  it('asks before dropping the point a correction moved it off', () => {
    // the place stays on the map until the analyst says otherwise: a save
    // withdraws the claim, it does not clean up after them
    expect(source).toContain('orphanOffer = result.orphans?.length ? result.orphans : null');
    expect(source).toContain('Delete the old place?');
    expect(source).toContain('This proof no longer points at');
    expect(source).toContain('Nothing else in the case points there.');
  });

  it('queues that question behind the other one, since a save can raise both', () => {
    const dialogs = source.slice(source.indexOf('{#if placeOffer}'));
    expect(dialogs.indexOf('{:else if orphanOffer}')).toBeGreaterThan(-1);
    expect(dialogs.indexOf('{:else if orphanOffer}')).toBeLessThan(dialogs.indexOf('{#if deleteEntry}'));
  });

  it('drops it through the entity route, so it lands in the trash like any delete', () => {
    expect(source).toContain('await api.del(`/api/cases/${caseState.current.id}/entities/${place.id}`)');
    expect(source).toContain('restorable={RESTORABLE}');
  });
});

describe('Proof Composer — one document at a time', () => {
  const composer = readFileSync(new URL('./ProofComposer.svelte', import.meta.url), 'utf8');

  it('stops an earlier open from streaming panels into the proof that replaced it', () => {
    // The open list stays up while a proof loads, so clicking a second entry is
    // one gesture away. Without a guard, A's panels kept arriving into the
    // document now bound to B's name, and Save wrote the hybrid over B.
    expect(composer).toContain('let openRun = 0;');
    expect(composer).toContain('const run = ++openRun;');
    expect(composer.match(/if \(run !== openRun\) return;/g)?.length).toBeGreaterThanOrEqual(4);
  });

  it('cancels a pending history capture before an undo restores the document', () => {
    // The clear has to come before the histBusy guard, or a timer armed in the
    // 350 ms before the undo survives it and pushes the pre-undo state back.
    expect(composer).toMatch(
      /const json = docSnapshot\(\);[\s\S]*?clearTimeout\(histTimer\);\s*\n\s*if \(histBusy\) return;/
    );
  });
});


describe('a draft left in hand', () => {
  it('destroys the node and hands back nothing', () => {
    const destroy = vi.fn();
    expect(discardDraft({ node: { destroy } })).toBeNull();
    expect(destroy).toHaveBeenCalledOnce();
  });

  it('survives a draft that never got a node', () => {
    expect(discardDraft(null)).toBeNull();
    expect(discardDraft({})).toBeNull();
  });

  it('abandons the shape being drawn when Escape lands mid-drag', () => {
    // Escape used to switch the tool to Select and leave `drawing` armed, so
    // the release below took the Select branch and the draft never settled.
    const escape = source.slice(source.indexOf('function onKeydown'), source.indexOf('function onKeyup'));

    expect(escape).toContain("if (e.key === 'Escape' && drawing)");
    expect(escape).toContain('drawing = discardDraft(drawing)');
  });

  it('never lets Select swallow the release that settles a draft', () => {
    const up = source.slice(source.indexOf('function onPointerUp'), source.indexOf('function finishPath'));
    const select = up.indexOf("if (tool === 'select')");

    expect(select).toBeGreaterThan(-1);
    // the Select branch holds no nested block, so the next brace closes it:
    // whatever return it makes has to be guarded on there being no draft
    const branch = up.slice(select, up.indexOf('}', select));
    expect(branch).toContain('if (!drawing) return;');
    expect(branch).not.toMatch(/\n\s*return;/);
  });
});

describe('stamping a symbol', () => {
  const down = source.slice(source.indexOf('function onPointerDown'), source.indexOf('function onPointerMove'));

  it('places one on a single click and keeps the tool in hand', () => {
    // text switches to Select after placing because the next act is editing it;
    // marking six vehicles is one act, so the stamp stays armed
    expect(down).toContain("if (tool === 'icon')");
    expect(down).toContain("kind: 'icon', name: entry.name");
    const stamp = down.slice(down.indexOf("if (tool === 'icon')"), down.indexOf("// curve:"));
    expect(stamp).toContain('selectedIds = [s.id]');
    expect(stamp).not.toContain("tool = 'select'");
  });

  it('sizes it against the panel, so it reads the same on any resolution', () => {
    expect(down).toContain('size: iconSizeFor(hit.box.baseScale)');
  });

  it('gives a solid silhouette no stroke width to carry', () => {
    expect(down).toContain('...(isSolidIcon(entry.name) ? {} : { strokeWidth: strokeW })');
    const setStroke = source.slice(source.indexOf('function setStroke'), source.indexOf('/** Fill opacity'));
    expect(setStroke).toContain("if (s.kind === 'icon' && isSolidIcon(s.name)) continue;");
  });

  it('scales but never deforms: corners only, ratio locked', () => {
    const tr = source.slice(source.indexOf('transformer.rotateEnabled('), source.indexOf('if (handles) {'));
    const anchors = tr.slice(tr.indexOf('enabledAnchors'));

    expect(anchors).toContain("selKind === 'text' || selKind === 'icon'");
    // the middle handles are the ones that would let it be squashed
    expect(anchors).not.toMatch(/selKind === 'icon'[^?]*'middle-left'/);
    expect(source).toMatch(/transformer\.keepRatio\([^)]*selKind === 'icon'/);
    // and it reads selKind only after selKind exists: a const referenced above
    // its declaration throws, which takes the whole effect down with it —
    // panel handles and move arrows included
    expect(source.indexOf('const selKind = selectedShape?.kind;'))
      .toBeLessThan(source.indexOf('transformer.keepRatio('));
  });

  it('hangs the shape on the point it names rather than a corner', () => {
    const node = source.slice(source.indexOf('function makeIconNode'), source.indexOf('// ---- inline text editing'));

    expect(node).toContain('const origin = iconOrigin(s.name, size)');
    expect(node).toContain('id: s.id, x: s.x, y: s.y');
    // and it rebinds by that same point when dropped onto another surface
    expect(source).toContain("s.kind === 'ellipse' || s.kind === 'text' || s.kind === 'icon'");
  });

  it('turns the fill into a badge disc behind the glyph', () => {
    const node = source.slice(source.indexOf('function makeIconNode'), source.indexOf('// ---- inline text editing'));

    expect(node).toContain('const disc = s.fillOpacity ?? 0');
    expect(node).toContain('fill: fillPaint(s.color, disc)');
    expect(node).toContain('glyphInk(s.color, disc)');
    // a stroked glyph is mostly holes, so the press lands on the box
    expect(node).toContain("fill: '#000', opacity: 0");
  });

  it('divides the scale back out of the stroke, so a big symbol is not a fat one', () => {
    const node = source.slice(source.indexOf('function makeIconNode'), source.indexOf('// ---- inline text editing'));

    expect(node).toContain('strokeWidth: (s.strokeWidth ?? 4) / panelScale / k');
  });

  it('reaches the stamp with a key nothing else claims', () => {
    expect(source).toContain("else if (e.key === 's') tool = 'icon';");
  });
});

// ---- gestures the composer runs itself --------------------------------------
// The three below — drawing, marquee, pan — are handled in this file rather than
// by Konva, so the stranded-gesture net that covers the transformer and node
// drags (konvaGesture.js) never reached them.

const canvasSource = readFileSync(new URL('./proof/ProofCanvas.svelte', import.meta.url), 'utf8');
const down = source.slice(source.indexOf('function onPointerDown'), source.indexOf('function onPointerMove'));
const keys = source.slice(source.indexOf('function onKeydown'), source.indexOf('function onKeyup'));

describe('a release the canvas never hears', () => {
  const mount = source.slice(
    source.indexOf('onMount(() => {'),
    source.indexOf('// reset the document when the case changes'),
  );
  const settle = source.slice(
    source.indexOf('function settleStrandedGesture'),
    source.indexOf('function finishPath'),
  );
  const marquee = source.slice(
    source.indexOf('function applyMarquee'),
    source.indexOf('/** Fold the draft in hand'),
  );

  it('settles the gestures this file runs itself', () => {
    // Letting go over the side column — a hand's width from the canvas edge —
    // left a draft stretching under a bare pointer and a marquee standing with
    // no selection to show for it.
    expect(settle).toContain('if (marquee) applyMarquee();');
    expect(settle).toContain('if (drawing) commitDrawing();');
  });

  it('ends the pan on the spot, since it follows the live pointer', () => {
    // A frame's wait is invisible for a draft — it only moves on a pointermove
    // over the canvas — but a pan reads every move, so one arriving before the
    // frame slid the view after the button was let go.
    expect(mount).toContain('if (panDrag) endPan();');
    expect(mount.indexOf('if (panDrag) endPan();')).toBeLessThan(mount.indexOf('const seq = gestureSeq;'));
    expect(settle).not.toContain('endPan');
  });

  it('hangs on the same window release that closes the gestures Konva owns', () => {
    expect(mount).toContain('settleStrandedGesture();');
    expect(mount).toContain("window.addEventListener('pointerup', settlePointer, true)");
    expect(mount).toContain("window.addEventListener('pointercancel', settlePointer, true)");
    expect(mount).toContain("window.addEventListener('blur', settlePointer)");
  });

  it('never settles a gesture a fresh press has already replaced', () => {
    // The settle waits a frame so a normal release can close itself first. A
    // press landing inside that frame opens a new draft, and committing that
    // one would end a stroke still being drawn.
    expect(mount).toContain('gestureSeq += 1;');
    expect(mount).toContain('const seq = gestureSeq;');
    expect(mount).toContain('if (seq === gestureSeq) settleStrandedGesture();');
  });

  it('reads the marquee off its node rather than a pointer that has left', () => {
    expect(marquee).toContain('width: node.width(), height: node.height()');
    expect(marquee).not.toContain('docPoint()');
    expect(marquee).toContain('node?.destroy();');
    expect(marquee).toContain('marquee = null;');
  });

  it('commits the draft through the one path a normal release uses', () => {
    // Two commit paths would be two answers to "what did that stroke become".
    const up = source.slice(source.indexOf('function onPointerUp'), source.indexOf('function settleStrandedGesture'));
    expect(up).toContain('commitDrawing();');
    expect(up).toContain('applyMarquee();');
    expect(up).toContain('endPan();');
  });
});

describe('the button that draws', () => {
  it('is the primary one; the middle one pans', () => {
    expect(down).toContain('if (spacePan || e.evt.button === 1)');
    expect(down).toContain('if ((e.evt.button ?? 0) > 0) return;');
  });

  it('turns the right button away before either tool can answer it', () => {
    // A right-drag drew a whole annotation under the context menu opening over
    // it; in Select it cleared the selection and opened a marquee.
    expect(down.indexOf('(e.evt.button ?? 0) > 0'))
      .toBeLessThan(down.indexOf("if (tool === 'select')"));
  });
});

describe('Escape', () => {
  it('unwinds one level per press instead of meaning two opposite things', () => {
    expect(keys).toContain("if (e.key === 'Escape' && drawing)");
    expect(keys).toMatch(/if \(visiblePick\) \{[\s\S]*?\} else \{\s*tool = 'select';/);
  });

  it('never clears a pick and puts the pen down in the same press', () => {
    const rung = keys.slice(keys.indexOf('if (visiblePick) {'), keys.indexOf("} else if (e.key === 'v')"));
    const cleared = rung.slice(0, rung.indexOf('} else {'));

    expect(cleared).toContain('selectedIds = [];');
    expect(cleared).toContain('selectedPanelId = null;');
    expect(cleared).not.toContain("tool = 'select'");
  });

  it('counts only a pick that shows, so one held for later is not a rung', () => {
    const derived = source.slice(
      source.indexOf('const visiblePick = $derived('),
      source.indexOf('// Every dialog that can sit over'),
    );

    expect(derived).toContain('selectionLive');
    expect(derived).toContain('selectedIds.length > 0');
    expect(derived).toContain('!!selectedSig');
  });
});

describe('a dialog over the composer', () => {
  it('keeps the one-letter tool keys off the canvas behind it', () => {
    expect(keys).toContain('if (modalOpen) return;');
    expect(keys.indexOf('if (modalOpen) return;')).toBeLessThan(keys.indexOf("e.key === 'r'"));
    // and Escape belongs to the dialog closing, not to the tool underneath
    expect(keys.indexOf('if (modalOpen) return;')).toBeLessThan(keys.indexOf('if (visiblePick) {'));
  });

  it('still lets the export menu answer its own Escape first', () => {
    expect(keys.indexOf('exportMenuOpen = false;')).toBeLessThan(keys.indexOf('if (modalOpen) return;'));
  });

  it('names every dialog that can be up', () => {
    const derived = source.slice(
      source.indexOf('// Every dialog that can sit over'),
      source.indexOf('const editableShape ='),
    );

    for (const flag of [
      'picker', 'newProofOpen', 'importOpen', 'openList', 'discardConfirm',
      'replaceWithNewConfirm', 'exportPicker', 'overwritePrompt', 'placeOffer',
      'orphanOffer', 'deleteEntry', 'sourcePick',
    ]) {
      expect(derived).toContain(flag);
    }
  });
});

describe('picking from the side column', () => {
  const bodyOf = (name) => {
    const at = source.indexOf(`function ${name}`);
    return source.slice(at, source.indexOf('\n  }', at));
  };

  it('takes the hand back to Select, since a row cannot mean "draw here"', () => {
    // The canvas refuses instead: there a press means draw. A row that lit up
    // orange while Delete, the handles and the colour all ignored it was a
    // selection visible in one column and absent from the other.
    for (const name of ['pickShapeRow', 'pickPanelRow', 'pickPasteRow']) {
      expect(bodyOf(name)).toContain("tool = 'select';");
    }
  });

  it('wires the rows to those rather than to the raw pick the canvas guards', () => {
    expect(source).toContain('selectShape={pickShapeRow}');
    expect(source).toContain('selectPanelRow={pickPanelRow}');
    expect(source).toContain('selectPasteRow={pickPasteRow}');
    expect(source).not.toContain('bind:selectedPanelId');
    expect(source).not.toContain('bind:selectedPasteId');
  });

  it('lights a row only while the pick can be acted on', () => {
    expect(source).toContain("const selectionLive = $derived(tool === 'select');");
    expect(source).toContain('{selectionLive}');
  });

  it('clears a marquee that would otherwise swallow the row click', () => {
    expect(bodyOf('pickPanelRow')).toContain('marqueeEnded = false;');
  });
});

describe('the curve tool', () => {
  it('stays in hand like the box, the line and the arrow beside it', () => {
    const finish = source.slice(
      source.indexOf('function finishPath'),
      source.indexOf('function commitPasteNode'),
    );

    expect(finish).toContain("kind: 'curve'");
    expect(finish).not.toContain("tool = 'select'");
  });

  it('ends where it was and opens the next one on a vertex dropped elsewhere', () => {
    // The click used to be dropped in silence, which reads as a dead canvas.
    expect(down).toContain('if (pathDraft && pathDraft.panel.id !== panel.id) finishPath(true);');
  });
});

describe('placing a label', () => {
  it('opens the editor on the click that places it', () => {
    const text = down.slice(down.indexOf("if (tool === 'text')"), down.indexOf("if (tool === 'icon')"));

    // A frame later, or the press that placed it takes the focus straight back
    // out of the editor: the browser moves focus off whatever holds it when a
    // click lands on something that cannot, so an editor opened inside the
    // pointerdown was blurred, committed and closed before a key could reach it.
    expect(text).toContain('requestAnimationFrame(() => startTextEdit(s));');
    expect(text).toContain("tool = 'select';"); // the next act is the typing
  });

  it('places the editor off the surface box, since there is no node yet', () => {
    const start = source.slice(
      source.indexOf('function startTextEdit'),
      source.indexOf('function commitTextEdit'),
    );

    expect(start).toContain('surfacesOf().find((x) => x.id === s.panel)?.box');
    expect(start).not.toContain('getAbsolutePosition');
    // and over the words of a boxed label, not over its corner
    expect(start).toContain('textBoxPad(s.fontSize)');
    expect(source).toContain('const pad = textBoxPad(s.fontSize);');
  });

  it('holds more than one line, the way Konva draws it', () => {
    expect(canvasSource).toContain('<textarea');
    expect(canvasSource).not.toContain('<input\n      class="text-edit"');
    expect(canvasSource).toContain("if (event.key === 'Enter' && !event.shiftKey)");
    expect(canvasSource).toContain('white-space: pre;');
    expect(canvasSource).toContain("rows={textEdit.value.split('\\n').length}");
  });
});

describe('the room around the page', () => {
  it('pans under a drawing tool, the way it does under Select', () => {
    // Same room, same drag: it answered only to Select, so with a box in hand
    // the press was lost and the crosshair promised a stroke it never drew.
    expect(down).toContain('if (!hit) {\n      startPan();');
  });

  it('says so with the cursor while the view slides', () => {
    expect(source).toContain("containerEl.style.cursor = 'grabbing';");
    expect(source).toContain("containerEl.style.cursor = spacePan ? 'grab' : '';");
  });
});

describe('a freehand stroke', () => {
  it('resizes and turns like the shapes beside it', () => {
    // It is the one kind with neither vertex handles nor a shape to speak of,
    // so a dashed frame with nothing to pull read as a broken selection.
    const ui = source.slice(source.indexOf('transformer.rotateEnabled('), source.indexOf('if (handles) {'));

    expect(ui).toMatch(/rotateEnabled\([\s\S]*?selKind === 'freehand'/);
    expect(ui).toMatch(/enabledAnchors\([\s\S]*?selKind === 'freehand'[\s\S]*?'middle-left'/);
  });

  it('keeps its samples off the handles, which would bury the stroke', () => {
    expect(source).toContain("const POINT_KINDS = new Set(['line', 'arrow', 'curve']);");
  });

  it('folds the whole transform into its samples, having nowhere else to put it', () => {
    const at = source.indexOf("} else if (s.kind === 'freehand') {");
    const fold = source.slice(at, source.indexOf('s.rotation = node.rotation();', at));

    expect(fold).toContain('pointsWithTransform(s.points, node.getTransform().getMatrix())');
    expect(fold).toContain('node.position({ x: 0, y: 0 });');
    expect(fold).toContain('node.rotation(0);'); // nothing left on the node to rotate around
  });
});

describe('the unsaved badge', () => {
  it('goes away when an undo walks back to what is on disk', () => {
    const apply = source.slice(source.indexOf('function applySnapshot'), source.indexOf('function undo()'));

    expect(apply).toContain('dirty = docSnapshot() !== savedSnapshot;');
    expect(apply).not.toContain('dirty = true;');
  });

  it('remembers the document every save and every open leaves there', () => {
    const save = source.slice(
      source.indexOf('async function performSave'),
      source.indexOf('/** Open the list fresh'),
    );
    const open = source.slice(
      source.indexOf('async function openProof('),
      source.indexOf('const selectedShapes'),
    );
    const reset = source.slice(source.indexOf('function resetDoc'), source.indexOf('function discardProof'));

    expect(save).toContain('savedSnapshot = docSnapshot();');
    expect(open).toContain('savedSnapshot = docSnapshot();');
    expect(reset).toContain('savedSnapshot = null;');
  });
});
