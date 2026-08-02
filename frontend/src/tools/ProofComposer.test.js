import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { render } from 'svelte/server';

vi.mock('konva', () => ({ default: {} }));

import ProofComposer from './ProofComposer.svelte';
import {
  bindPanelPointerLifecycle,
  createCanvasRenderGate,
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
    expect(source).toContain("lookupEntity(id, 'spec', `proofs/.meta/${name}.json`)");
    expect(source).not.toContain("lookupEntity(id, 'spec', `proofs/${name}.json`)");
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
    expect(row).toContain('${entry.thumb ?? entry.png}');
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
    expect(source).toContain('} else if (clipboard) {');
    // the old Ctrl+V keydown branch would have swallowed the paste event
    expect(source).not.toContain("k === 'v' && clipboard");
    // and a paste into the title or a caption stays text
    expect(source).toContain('isTextTarget(e.target)');
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
    expect(source).toContain('transformer.keepRatio(!!sigNode || !!pasteNode)');
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
