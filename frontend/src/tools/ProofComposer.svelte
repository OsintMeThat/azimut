<script>
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { lookupEntity, fetchAllEntities } from '../lib/catalog.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { isSatelliteMedia } from '../lib/mediaFilter.js';
  import { caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords } from '../lib/state.svelte.js';
  import { templatesState } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ProofToolbar from './proof/ProofToolbar.svelte';
  import ProofCanvas from './proof/ProofCanvas.svelte';
  import ProofLayersPanel from './proof/ProofLayersPanel.svelte';
  import NewProofDialog from './proof/NewProofDialog.svelte';
  import PanelCategories from './proof/PanelCategories.svelte';
  import { bindPanelPointerLifecycle, createCanvasRenderGate } from './proof/canvasLifecycle.js';
  import {
    ANNO_COLORS, PAD, GAP, ROW_GAP, PANEL_H, TWEET_GUIDES,
    CAPTION_SIZE, LEGEND_SIZE, FOOTER_SIZE,
    BG, TEXT_MAIN, normSpace, textColors,
    layoutPanels, panelsBottom, freeNormalizeDelta, legendLineHeight, footerBand,
    attributionLine, docSize, offsetShape, autoLayoutRows,
    autoCoords, formatCoords, autoSource,
    toSpec, newId, loadImage, orderedFeatureColors, notesFromShapes,
    templateFromProof, applyProofStyle, normalizeProofStyle, newSignatureText,
    anchoredPos, anchoredOffset, SIG_TEXT_SIZE,
    copyShapeSpec, dedupeBySrc, satPanelInput, mediaPanelInput,
    SIG_ANCHORS, SIG_SCALE, newSignature, signatureBox, signatureOffset, signaturePairPositions,
    remapPanelXY, groupNeighborIndex, hasGroupNeighbor,
    denseRowValues, clampPanelScale, trimClosingDuplicate, freehandShape,
    canReassignLegendNote,
    surfaces, surfaceHitTest, pasteBoxes, clampPaste, clampPasteScale,
    pasteInsertScale, newPaste, newFrame, normalizeFrame, FRAME_WIDTH_MAX, FRAME_COLOR,
    PASTE_SCALE_MIN, PASTE_SCALE_MAX,
    filterProofPanelItems, hasProofCanvasContent, proofExportOptions, panelPreview,
  } from '../lib/composer.js';
  import {
    assetName, base64Of, PASTE_TYPES, MAX_PASTES, MAX_PASTE_BYTES,
  } from '../lib/pasteAsset.js';
  import { nextName, savedSlugs, savedTitles, savedTitle, slugify } from '../lib/naming.js';
  import { createHistory } from '../lib/history.js';
  import { pollWhile } from '../lib/poll.js';

  const SCALE_MIN = 0.25;
  const SCALE_MAX = 2.5;
  const SCALE_STEP = 0.05;

  const DRAW_TOOLS = [
    { id: 'select', icon: 'hand', label: 'Select / move', shortcut: 'v' },
    { id: 'rect', icon: 'square', label: 'Box', shortcut: 'r' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse', shortcut: 'e' },
    { id: 'arrow', icon: 'arrow', label: 'Arrow', shortcut: 'a' },
    { id: 'line', icon: 'line', label: 'Line', shortcut: 'l' },
    { id: 'curve', icon: 'curve', label: 'Curve (click points, double-click to finish)', shortcut: 'c' },
    { id: 'freehand', icon: 'freehand', label: 'Freehand', shortcut: 'd' },
    { id: 'text', icon: 'text', label: 'Text', shortcut: 't' },
  ];

  // Document state. Notes are keyed by color, shapes bind to surfaces and pasted
  // images remain local to this proof.
  const proof = $state({
    title: '', panels: [], pastes: [], shapes: [], notes: {}, legendOrder: [],
    templateId: null, // selected saved house style; its values remain copied below
    coordsText: '', source: '', // '' → auto-derived from panels; non-empty → manual override
    captionSize: CAPTION_SIZE, legendSize: LEGEND_SIZE, footerSize: FOOTER_SIZE, footer: '',
    footerEnabled: true, // false → no footer line at all
    footerColor: null, // null → auto from the background
    footerAlign: 'left',
    captionsEnabled: true, // whether newly added panels get a default caption
    bg: BG, // proof background fill; captions/legend/footer follow it (textColors)
    space: { pad: PAD, gap: GAP, rowGap: ROW_GAP }, // panel spacing, editable per proof
    layout: 'grid', // 'grid' (rows) | 'free' (drag panels anywhere, overlap allowed)
    panelDirection: 'horizontal', // preferred arrangement for the first two panels
    signature: null, // null → unsigned; else { anchor, dx, dy, scale, opacity }
    signatureText: null, // null → none; else a Settings-handle slot over the panels
    palette: [...ANNO_COLORS], // ordered drawing colours, most preferred first
  });

  // Load the app-wide signature once per session; null disables the control.
  let sigImg = $state(null);

  async function loadSignature() {
    try {
      sigImg = await loadImage('/api/settings/signature.png');
    } catch {
      sigImg = null; // No saved logo.
    }
  }
  let advancedOpen = $state(false);
  let collapsed = $state({ panels: false, overlays: false, annotations: false, elements: false });
  // Saved proof slug, or null before the first save.
  let savedName = $state(null);
  let dirty = $state(false);
  // A named proof can exist before it has content. This distinguishes the
  // initial composer shell from a template-only proof the user just created.
  let proofStarted = $state(false);

  // Drop the saved binding when another surface deletes the proof.
  // Keep the canvas so a later Save creates a new proof.
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    const name = savedName;
    if (!id || !name) return;
    let live = true;
    lookupEntity(id, 'spec', `proofs/${name}.json`).then((bound) => {
      if (live && !bound && savedName === name) {
        savedName = null;
        dirty = true;
        toast('The saved proof was deleted. Saving now creates a new one', 'warn');
      }
    });
    return () => { live = false; };
  });

  // Every saved proof (its slugs and titles) and every current media/capture
  // path, read a page at a time off the bounded catalog and the media shelves
  // rather than the case-open payload. Refreshed on case change and after any
  // reload elsewhere.
  let proofEntities = $state([]);
  let presentPaths = $state(new Set());
  $effect(() => {
    const id = caseState.current?.id;
    caseState.rev;
    if (!id) {
      proofEntities = [];
      presentPaths = new Set();
      return;
    }
    let live = true;
    fetchAllEntities(id, { types: ['proof'] })
      .then((list) => { if (live) proofEntities = list; })
      .catch(() => { if (live) proofEntities = []; });
    Promise.all([api.get(`/api/cases/${id}/media`), api.get(`/api/cases/${id}/satellite`)])
      .then(([media, sat]) => {
        if (live) presentPaths = new Set([...media, ...sat].map((it) => it.path));
      })
      .catch(() => { if (live) presentPaths = new Set(); });
    return () => { live = false; };
  });

  // Panels whose media was deleted: the image already drawn stays on the canvas,
  // but the panel is flagged so a re-save is not silently building on a ghost.
  const gonePanels = $derived(
    caseState.current ? proof.panels.filter((p) => !presentPaths.has(p.src)) : []
  );
  let tool = $state('select');
  let color = $state(ANNO_COLORS[0]);
  let strokeW = $state(4);
  let guide = $state(null); // null | '16:9' | '4:5' — tweet centre-crop overlay
  let selectedId = $state(null);
  let selectedPanelId = $state(null); // free-layout only: panel picked for move/resize
  let selectedPasteId = $state(null); // pasted image picked for move/resize/frame
  let selectedSig = $state(null); // null | 'logo' | 'text' — signature picked for resize
  let picker = $state(false);
  let pickerItems = $state([]);
  let newProofOpen = $state(false);
  let newProofTemplateId = $state('');
  let newProofPanelPaths = $state([]);
  let newProofQuery = $state('');
  let newProofCategory = $state('all');
  let newProofLoading = $state(false);
  let creatingProof = $state(false);
  let replaceWithNewConfirm = $state(false);
  const filteredNewProofItems = $derived(
    filterProofPanelItems(pickerItems, newProofQuery, newProofCategory)
  );
  const proofHasContent = $derived(hasProofCanvasContent(proof));
  // Both pickers below follow the Inspect rule: a flat list until it passes six
  // entries, then a search box and a "…" that swaps in the read-only folder
  // browser (crumbs, folders, then what is filed there).
  const PICKER_SEARCH_MIN = 6;
  let panelQuery = $state('');
  let panelCategory = $state('all');
  let panelBrowserOpen = $state(false);
  let panelBrowsePath = $state('');
  let panelBrowseSelection = $state(null);
  // The chips narrow the set (and the folders); the search box then narrows what
  // is shown inside it, in the grid and in the browser alike.
  const panelCategoryItems = $derived(filterProofPanelItems(pickerItems, '', panelCategory));
  const visiblePanelItems = $derived(filterProofPanelItems(panelCategoryItems, panelQuery, 'all'));
  const panelBrowserEntries = $derived(
    panelCategoryItems.map((item) => ({ ...item, id: item.src, attrs: { folder: item.folder ?? '' } }))
  );
  let openList = $state(null); // list of saved proofs, null = closed
  let proofQuery = $state('');
  let proofBrowserOpen = $state(false);
  let proofBrowsePath = $state('');
  let proofBrowseSelection = $state(null);
  const visibleProofs = $derived((openList ?? []).filter((entry) => matchesProofQuery(entry, proofQuery)));
  const proofBrowserEntries = $derived(
    (openList ?? []).map((entry) => ({ ...entry, id: entry.name, attrs: { folder: entry.folder ?? '' } }))
  );
  let saving = $state(false);
  let proofFor = $state(undefined);
  let discardConfirm = $state(false);

  // ---- undo / redo -------------------------------------------------------------
  // Snapshot-based history over the serializable document (toSpec). Mutations
  // are captured by a debounced effect, so a slider drag collapses into one
  // entry; panel images are re-attached from a cache on restore.
  const history = createHistory();
  const imgCache = new Map(); // src → HTMLImageElement, survives undo/redo
  // asset name → { img, data, pending }. `data` is the base64 body a paste that
  // has never been saved still has to hand to the server; `pending` clears once
  // the case holds the file. Survives undo/redo like imgCache does.
  const pasteAssets = new Map();
  let canUndo = $state(false);
  let canRedo = $state(false);
  let histBusy = false; // plain (untracked): suppresses capture while restoring
  let histTimer = null;

  const docSnapshot = () => JSON.stringify(toSpec(proof));

  function syncHist() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }

  function anchorHistory() {
    clearTimeout(histTimer);
    history.reset(docSnapshot());
    syncHist();
  }

  $effect(() => {
    const json = docSnapshot(); // reads every document field → tracked
    if (histBusy) return;
    clearTimeout(histTimer);
    histTimer = setTimeout(() => {
      history.push(json);
      syncHist();
    }, 350);
  });

  function applySnapshot(json) {
    const spec = JSON.parse(json);
    const style = normalizeProofStyle(spec);
    histBusy = true;
    proofStarted = true;
    if (pathDraft) finishPath(false);
    proof.title = spec.title ?? freshTitle();
    proof.coordsText = spec.coordsText ?? '';
    proof.source = spec.source ?? '';
    proof.captionSize = style.captionSize;
    proof.legendSize = style.legendSize;
    proof.footerSize = style.footerSize;
    proof.footer = style.footer;
    proof.footerEnabled = style.footerEnabled;
    proof.footerColor = style.footerColor;
    proof.footerAlign = style.footerAlign;
    proof.captionsEnabled = style.captionsEnabled;
    proof.bg = style.bg;
    proof.space = style.space;
    proof.layout = style.layout;
    proof.panelDirection = style.panelDirection;
    proof.signature = style.signature;
    proof.signatureText = style.signatureText;
    proof.palette = style.palette;
    color = proof.palette[0];
    proof.notes = spec.notes ?? {};
    proof.legendOrder = spec.legendOrder ?? [];
    proof.templateId = typeof spec.templateId === 'string' ? spec.templateId : null;
    proof.panels = spec.panels.map((p) => ({ ...p, img: imgCache.get(p.src) ?? null }));
    proof.pastes = (spec.pastes ?? []).map((p) => ({
      ...p,
      img: pasteAssets.get(p.asset)?.img ?? null,
    }));
    proof.shapes = spec.shapes ?? [];
    // a panel image missing from the cache (shouldn't happen) reloads async
    for (const p of proof.panels.filter((x) => !x.img)) {
      loadImage(`/files/${caseState.current?.id}/${p.src}`)
        .then((img) => {
          imgCache.set(p.src, img);
          p.img = img;
        })
        .catch(() => {});
    }
    selectedId = null;
    selectedPanelId = null;
    selectedPasteId = null;
    selectedSig = null;
    const template = templatesState.proof.find((t) => t.id === proof.templateId);
    appliedTemplate = template
      ? { id: template.id, name: template.name, prevStyle: templateFromProof(proof) }
      : null;
    dirty = true;
    requestAnimationFrame(fit);
    // outlast the capture debounce so the restore itself is not re-recorded
    setTimeout(() => (histBusy = false), 400);
  }

  function undo() {
    const json = history.undo();
    if (json != null) applySnapshot(json);
    syncHist();
  }

  function redo() {
    const json = history.redo();
    if (json != null) applySnapshot(json);
    syncHist();
  }

  // ---- konva ------------------------------------------------------------------
  let containerEl = $state();
  let stage, docLayer, uiLayer, transformer, endHandles, guideGroup, panelCtrls;
  let canvasRenderGate;
  let drawing = null; // {panel, node, start, box, kind}
  let pathDraft = null; // {panel, box, node, points:[]} — multi-click curve in progress
  let spacePan = false; // hold-space panning (manual, so it wins over shape drags)
  let panDrag = null; // {sx, sy, ox, oy} — space/middle-drag pan in progress
  let textEdit = $state(null); // {id, value, left, top, size} — inline text editor

  onMount(() => {
    loadSignature(); // async: the canvas redraws when it lands
    stage = new Konva.Stage({ container: containerEl, width: 100, height: 100 });
    canvasRenderGate = createCanvasRenderGate(
      requestAnimationFrame,
      cancelAnimationFrame,
      {
        rebuild: () => { if (stage) rebuild(); },
        refreshUi: () => { if (stage) refreshCanvasUi(); },
      },
    );
    docLayer = new Konva.Layer();
    uiLayer = new Konva.Layer();
    stage.add(docLayer, uiLayer);
    transformer = new Konva.Transformer({
      rotateEnabled: false,
      flipEnabled: false,
      anchorSize: 11,
      anchorCornerRadius: 3,
      anchorStroke: '#e8a33d',
      anchorFill: '#252525',
      borderStroke: '#e8a33d',
      borderDash: [4, 3],
      ignoreStroke: true,
    });
    guideGroup = new Konva.Group({ listening: false });
    uiLayer.add(guideGroup);
    uiLayer.add(transformer);
    endHandles = new Konva.Group();
    uiLayer.add(endHandles);
    panelCtrls = new Konva.Group();
    uiLayer.add(panelCtrls);

    const resize = new ResizeObserver(() => {
      stage.width(containerEl.clientWidth);
      stage.height(containerEl.clientHeight);
      fit();
    });
    resize.observe(containerEl);

    stage.on('wheel', onWheel);
    stage.on('pointerdown', onPointerDown);
    stage.on('pointermove', onPointerMove);
    stage.on('pointerup', onPointerUp);
    stage.on('dblclick dbltap', () => { if (pathDraft) finishPath(true); });

    // The release can happen outside the canvas. Capture it at window level so
    // a deferred rebuild is never left waiting after an interrupted drag.
    const beginPointer = () => canvasRenderGate?.beginPointer();
    const settlePointer = () => canvasRenderGate?.endPointer();
    // Capture before Konva dispatches the event: selected annotations stop
    // bubbling at their node, so a Stage listener alone cannot see every press.
    containerEl.addEventListener('pointerdown', beginPointer, true);
    window.addEventListener('pointerup', settlePointer, true);
    window.addEventListener('pointercancel', settlePointer, true);
    window.addEventListener('blur', settlePointer);

    return () => {
      resize.disconnect();
      containerEl.removeEventListener('pointerdown', beginPointer, true);
      window.removeEventListener('pointerup', settlePointer, true);
      window.removeEventListener('pointercancel', settlePointer, true);
      window.removeEventListener('blur', settlePointer);
      canvasRenderGate?.destroy();
      stage.destroy();
      canvasRenderGate = null;
      stage = null;
    };
  });

  // reset the document when the case changes
  $effect(() => {
    const id = caseState.current?.id;
    if (id !== proofFor) {
      proofFor = id;
      resetDoc();
    }
  });

  // consume the cross-tool queue (media/satellite “send to composer”)
  $effect(() => {
    if (uiState.tool === 'proof' && uiState.composeQueue.length && caseState.current) {
      const queue = [...uiState.composeQueue];
      uiState.composeQueue.length = 0;
      addPanelsFromPaths(queue);
    }
  });

  // consume an "open this proof" handoff from the sidebar
  $effect(() => {
    if (uiState.tool === 'proof' && uiState.openProof && caseState.current) {
      const name = uiState.openProof;
      uiState.openProof = null;
      openProof({ name });
    }
  });

  // leaving the curve tool abandons an unfinished draft
  $effect(() => {
    if (tool !== 'curve' && pathDraft) finishPath(false);
  });

  // Rebuild only when published document content changes. Selection is UI-only
  // and gets a lightweight refresh below, without recreating every image node.
  $effect(() => {
    JSON.stringify([
      proof.panels.map((p) => [p.src, p.caption, p.row, p.scale, p.x, p.y, p.frame]),
      proof.pastes.map((p) => [p.asset, p.x, p.y, p.scale, p.frame, !!p.img]),
      proof.shapes,
      proof.notes,
      proof.legendOrder,
      proof.captionSize, proof.legendSize, proof.footerSize, proof.footer,
      proof.footerEnabled, proof.footerColor,
      proof.footerAlign,
      proof.bg, proof.space,
      proof.layout,
      proof.panelDirection,
      proof.signature,
      proof.signatureText,
    ]);
    sigImg; // the logo lands async — redraw once it does
    prefs.signatureHandle; // Settings can change the rendered handle live
    if (stage) canvasRenderGate?.requestRebuild();
  });

  $effect(() => {
    selectedId;
    selectedPanelId;
    selectedPasteId;
    selectedSig;
    guide;
    tool;
    if (stage) canvasRenderGate?.requestUi();
  });

  // Text-size options threaded into every layout/size computation.
  const textOpts = () => ({
    captionSize: proof.captionSize,
    legendSize: proof.legendSize,
    footerSize: proof.footerSize,
    footerEnabled: proof.footerEnabled !== false,
  });

  // Layout boxes + document measure for the active layout mode. Pasted images
  // are deliberately absent from the measure: the panels alone size the
  // document, so moving a paste can never change the export.
  const boxesOf = () => layoutPanels(proof.panels, proof.captionSize, proof.layout, proof.space);
  const surfacesOf = () => surfaces(proof);
  const measureDoc = () =>
    docSize(proof.panels, proof.shapes, proof.notes, textOpts(), proof.legendOrder, proof.layout, proof.space);

  function resetDoc() {
    proof.title = freshTitle();
    proof.panels = [];
    proof.pastes = [];
    proof.shapes = [];
    proof.notes = {};
    proof.legendOrder = [];
    proof.templateId = null;
    proof.coordsText = '';
    proof.source = '';
    proof.captionSize = CAPTION_SIZE;
    proof.legendSize = LEGEND_SIZE;
    proof.footerSize = FOOTER_SIZE;
    proof.footer = '';
    proof.footerEnabled = true;
    proof.footerColor = null;
    proof.footerAlign = 'left';
    proof.captionsEnabled = true;
    proof.bg = BG;
    proof.space = { pad: PAD, gap: GAP, rowGap: ROW_GAP };
    proof.layout = 'grid';
    proof.panelDirection = 'horizontal';
    proof.signature = null;
    proof.signatureText = null;
    proof.palette = [...ANNO_COLORS];
    color = proof.palette[0];
    savedName = null;
    proofStarted = false;
    selectedId = null;
    selectedPanelId = null;
    selectedPasteId = null;
    selectedSig = null;
    appliedTemplate = null;
    dirty = false;
    imgCache.clear();
    pasteAssets.clear();
    anchorHistory();
  }

  function discardProof() {
    resetDoc();
    discardConfirm = false;
  }

  // ---- house-style templates ---------------------------------------------------
  // Apply a saved proof template (Settings → Templates) onto this proof.
  // Content stays put — templates carry only the look.
  // The house style laid over this proof: { id, name, prevStyle }. Choosing
  // "No template" restores the look from before the first template was applied.
  // It stays out of the saved spec because the style values are already copied.
  let appliedTemplate = $state(null);

  function applyTemplate(t, { notify = true } = {}) {
    // first apply snapshots the current look; re-applying keeps that original,
    // so Discard always walks back to the pre-template style, not the last one.
    const prevStyle = appliedTemplate?.prevStyle ?? templateFromProof(proof);
    applyProofStyle(proof, t.data, {
      logo: !!sigImg,
      handle: !!prefs.signatureHandle?.trim(),
    });
    color = proof.palette[0] ?? ANNO_COLORS[0];
    proof.templateId = t.id;
    appliedTemplate = { id: t.id, name: t.name, prevStyle };
    dirty = true;
    requestAnimationFrame(fit); // margins/layout may have changed the doc size
    if (notify) toast(`Template loaded: ${t.name}`, 'ok', 1400);
  }

  function applyFromSelect(e) {
    if (!proofStarted) return;
    const t = templatesState.proof.find((x) => x.id === e.currentTarget.value);
    if (t) applyTemplate(t);
    else discardTemplate();
  }

  function discardTemplate() {
    if (!appliedTemplate) return;
    applyProofStyle(proof, appliedTemplate.prevStyle, {
      logo: !!sigImg,
      handle: !!prefs.signatureHandle?.trim(),
    });
    color = proof.palette[0] ?? ANNO_COLORS[0];
    proof.templateId = null;
    appliedTemplate = null;
    dirty = true;
    requestAnimationFrame(fit);
    toast('Template removed', 'ok', 1200);
  }

  function openTemplateSettings() {
    uiState.settingsTab = 'templates';
    uiState.tool = 'settings';
  }

  // Pick the logo or the @handle so the transformer wraps it — click a corner to
  // resize it right on the canvas. Content selections drop, so only one thing
  // ever carries the handles.
  function selectSig(which) {
    selectedSig = which;
    selectedId = null;
    selectedPanelId = null;
    selectedPasteId = null;
  }

  function selectPaste(id) {
    if (tool !== 'select') return;
    selectedPasteId = id;
    selectedId = null;
    selectedPanelId = null;
    selectedSig = null;
  }

  function selectPanel(id) {
    if (tool !== 'select') return;
    selectedPanelId = id;
    selectedPasteId = null;
    selectedId = null;
    selectedSig = null;
  }

  // ---- panels ------------------------------------------------------------------

  async function fetchPanelItems() {
    if (!caseState.current) return [];
    const [media, sats] = await Promise.all([
      api.get(`/api/cases/${caseState.current.id}/media`),
      api.get(`/api/cases/${caseState.current.id}/satellite`),
    ]);
    // A capture *is* a media image, so it shows up in both lists. List it once,
    // via its richer capture entry (coordinates/attribution), and drop it from
    // the media half. dedupeBySrc is a belt-and-braces guard so a stray overlap
    // can never throw the keyed picker's `each_key_duplicate`.
    //
    // The capture listing also carries map screenshots the extension filed, and
    // only some of those are satellite imagery. The chips call an item satellite
    // exactly when the Media Library does (isSatelliteMedia), so a Street View
    // grab reads the same on both screens.
    const captured = new Set(sats.map((s) => s.path));
    return dedupeBySrc([
      ...sats.map((s) => ({
        ...satPanelInput(s, prefs.coordFormat),
        label: `${fmtCoords(s.lat, s.lon)} · z${s.zoom}`,
        ...panelPreview(s),
        kind: isSatelliteMedia(s) ? 'satellite' : 'media',
        folder: s.folder ?? '',
      })),
      ...media
        .filter((m) => m.kind === 'image' && !captured.has(m.path))
        .map((m) => ({
          ...mediaPanelInput(m, media),
          label: m.title || m.filename,
          ...panelPreview(m),
          kind: 'media',
          folder: m.folder ?? '',
        })),
    ]);
  }

  async function openNewProofDialog() {
    newProofTemplateId = '';
    newProofPanelPaths = [];
    newProofQuery = '';
    newProofCategory = 'all';
    pickerItems = [];
    newProofOpen = true;
    newProofLoading = true;
    try {
      pickerItems = await fetchPanelItems();
    } catch (e) {
      toast(`Could not load case images: ${e.message}`, 'danger');
    } finally {
      newProofLoading = false;
    }
  }

  function toggleNewProofPanel(src) {
    newProofPanelPaths = newProofPanelPaths.includes(src)
      ? newProofPanelPaths.filter((path) => path !== src)
      : [...newProofPanelPaths, src];
  }

  function requestNewProofCreation() {
    if (creatingProof) return;
    if (proofStarted && dirty) {
      replaceWithNewConfirm = true;
      return;
    }
    createNewProof();
  }

  async function createNewProof() {
    if (creatingProof) return;
    creatingProof = true;
    const template = templatesState.proof.find((t) => t.id === newProofTemplateId);
    const selectedItems = newProofPanelPaths
      .map((path) => pickerItems.find((item) => item.src === path))
      .filter(Boolean);
    try {
      resetDoc();
      proofStarted = true;
      if (template) applyTemplate(template, { notify: false });
      for (const item of selectedItems) await addPanel(item);
      dirty = true;
      anchorHistory();
      newProofOpen = false;
      replaceWithNewConfirm = false;
      if (proof.panels.length) requestAnimationFrame(fit);
    } finally {
      creatingProof = false;
    }
  }

  async function openPicker() {
    if (!caseState.current) {
      toast('Add media first. The composer works on case images', 'info');
      uiState.tool = 'media';
      return;
    }
    panelQuery = '';
    panelCategory = 'all';
    panelBrowserOpen = false;
    panelBrowsePath = '';
    panelBrowseSelection = null;
    pickerItems = await fetchPanelItems();
    picker = true;
  }

  // Items whose thumbnail the worker has not produced yet show a placeholder.
  // Re-list while a picker is open so they fill in on their own, and stop as
  // soon as nothing is pending (or the dialog closes).
  const pickerThumbsPending = $derived(pickerItems.some((i) => i.thumbPending));

  async function refreshPickerItems() {
    if (caseState.current) pickerItems = await fetchPanelItems();
  }

  $effect(() => {
    if (!pickerThumbsPending || !(picker || newProofOpen)) return;
    return pollWhile(() => pickerThumbsPending, () => refreshPickerItems(), 1500);
  });

  function setPanelCategory(category) {
    panelCategory = category;
    panelBrowsePath = '';
    panelBrowseSelection = null;
  }

  function togglePanelBrowser() {
    if (panelBrowserOpen) {
      panelBrowserOpen = false;
      return;
    }
    panelQuery = '';
    panelBrowsePath = '';
    panelBrowseSelection = null;
    panelBrowserOpen = true;
  }

  function openPanelFolder(path) {
    panelBrowsePath = path;
    panelBrowseSelection = null;
  }

  function selectPanelBrowser(item, confirm = false) {
    panelBrowseSelection = item.src;
    if (confirm) addPanelFromPicker(item);
  }

  function confirmPanelBrowser() {
    const item = panelBrowserEntries.find((entry) => entry.src === panelBrowseSelection);
    if (item) addPanelFromPicker(item);
  }

  function addPanelFromPicker(item) {
    addPanel(item);
    picker = false;
  }

  async function addPanel(item) {
    try {
      proofStarted = true;
      const img = await loadImage(`/files/${caseState.current.id}/${item.src}`);
      imgCache.set(item.src, img);
      // A template can stack the first pair. Later panels keep joining the
      // current bottom row, preserving the composer's existing workflow.
      const row = proof.panels.length === 1
        ? (proof.panelDirection === 'vertical' ? 1 : 0)
        : proof.panels.length
          ? Math.max(...proof.panels.map((p) => p.row ?? 0))
          : 0;
      const panel = {
        id: newId('p'),
        src: item.src,
        // captionsEnabled off → new panels start caption-less (you can still add
        // one). On → they carry the panel's own default (satellite coords, etc.).
        caption: proof.captionsEnabled === false ? '' : (item.caption ?? ''),
        row,
        scale: 1,
        natural: [img.naturalWidth, img.naturalHeight],
        meta: item.meta ?? {},
        img,
      };
      // grid: append (rightmost / bottom row); free: a new panel lands in front
      if (proof.layout === 'free') proof.panels.unshift(panel);
      else proof.panels.push(panel);
      dirty = true;
      requestAnimationFrame(fit);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function addPanelsFromPaths(paths) {
    const [media, sats] = await Promise.all([
      api.get(`/api/cases/${caseState.current.id}/media`),
      api.get(`/api/cases/${caseState.current.id}/satellite`),
    ]);
    for (const path of paths) {
      if (proof.panels.some((p) => p.src === path)) continue;
      const sat = sats.find((s) => s.path === path);
      if (sat) {
        await addPanel(satPanelInput(sat, prefs.coordFormat));
        continue;
      }
      const m = media.find((x) => x.path === path);
      if (m) await addPanel(mediaPanelInput(m, media));
    }
  }

  // Renumber rows to a dense 0..n-1 range after a move may have emptied one.
  function normalizeRows() {
    const rows = denseRowValues(proof.panels);
    proof.panels.forEach((p, i) => { p.row = rows[i]; });
  }

  // Swap a panel with its left/right neighbour *within the same row*.
  function movePanel(index, delta) {
    const target = groupNeighborIndex(proof.panels, index, delta, (p) => p.row ?? 0);
    if (target < 0) return;
    const [panel] = proof.panels.splice(index, 1);
    proof.panels.splice(target, 0, panel);
    dirty = true;
  }

  // Move a panel up/down a row; going past the last row starts a fresh row.
  function movePanelRow(index, delta) {
    const panel = proof.panels[index];
    const maxRow = Math.max(...proof.panels.map((p) => p.row ?? 0));
    const next = (panel.row ?? 0) + delta;
    if (next < 0 || next > maxRow + 1) return;
    panel.row = next;
    normalizeRows();
    selectedId = null;
    dirty = true;
    requestAnimationFrame(fit);
  }

  const canMoveLeft = (i) => hasGroupNeighbor(proof.panels, i, -1, (p) => p.row ?? 0);
  const canMoveRight = (i) => hasGroupNeighbor(proof.panels, i, 1, (p) => p.row ?? 0);

  // Grow / shrink a single panel (its drawn elements scale with it, since they
  // live in the panel's natural pixel space and render at the panel box scale).
  function scalePanel(index, delta) {
    const p = proof.panels[index];
    const cur = p.scale ?? 1;
    const next = clampPanelScale(cur, delta, SCALE_MIN, SCALE_MAX);
    if (next === cur) return;
    if (proof.layout === 'free') materializeFreePositions(); // others must not reflow
    p.scale = next;
    dirty = true;
    requestAnimationFrame(fit);
  }

  // ---- free layout ------------------------------------------------------------
  // In free mode a panel's stored x/y is its doc position; a panel without one
  // renders at its grid fallback (layoutPanelsFree). Before any mutation that
  // could shift those fallbacks (drag, resize, scale), stored positions are
  // materialised from the rendered layout so panels only move when moved.

  function materializeFreePositions() {
    const boxes = layoutPanels(proof.panels, proof.captionSize, 'free', proof.space);
    proof.panels.forEach((p, i) => {
      p.x = boxes[i].x;
      p.y = boxes[i].y;
    });
  }

  // Re-anchor stored positions at PAD (dragging past the top/left edge grows
  // the document) and shift the stage by the same amount so nothing jumps.
  function normalizeFree() {
    const { dx, dy } = freeNormalizeDelta(proof.panels, proof.captionSize, proof.space);
    if (!dx && !dy) return;
    for (const p of proof.panels) {
      p.x += dx;
      p.y += dy;
    }
    stage.position({ x: stage.x() - dx * stage.scaleX(), y: stage.y() - dy * stage.scaleY() });
  }

  // Fold a finished panel drag / corner-resize back into the document.
  function commitPanelNode(panel, node, { resized = false } = {}) {
    materializeFreePositions();
    if (resized) {
      // transformer scales the group; group scale = (PANEL_H·scale)/naturalH
      const next = (node.scaleX() * panel.natural[1]) / PANEL_H;
      panel.scale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)) * 100) / 100;
    }
    panel.x = node.x();
    panel.y = node.y();
    normalizeFree();
    dirty = true;
  }

  function setLayoutMode(mode) {
    if ((proof.layout ?? 'grid') === mode) return;
    proof.layout = mode;
    selectedPanelId = null;
    dirty = true;
    requestAnimationFrame(fit);
  }

  // Free mode: array order is the z-order, front→back (Z1 = foreground), so
  // "bring forward" swaps toward index 0 and "send backward" toward the end.
  function movePanelZ(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= proof.panels.length) return;
    const [panel] = proof.panels.splice(index, 1);
    proof.panels.splice(target, 0, panel);
    dirty = true;
  }

  // "Magic" tweet fit: re-pack panels into rows so the composite lands closest
  // to the active tweet aspect (the toggled 16:9 / 4:5 guide, else 16:9) and
  // reset every panel to its default size. Row packing is a grid concept, so
  // from free mode this also switches the proof back to the grid layout.
  function applyMagic() {
    if (!proof.panels.length) return;
    proof.layout = 'grid';
    selectedPanelId = null;
    const target = guide ? TWEET_GUIDES[guide] : TWEET_GUIDES['16:9'];
    const rows = autoLayoutRows(
      proof.panels, proof.shapes, proof.notes, textOpts(), target, proof.space,
    );
    proof.panels.forEach((p, i) => { p.row = rows[i]; p.scale = 1; });
    normalizeRows();
    selectedId = null;
    dirty = true;
    requestAnimationFrame(fit);
  }

  function removePanel(index) {
    const panel = proof.panels[index];
    proof.shapes = proof.shapes.filter((s) => s.panel !== panel.id);
    proof.panels.splice(index, 1);
    normalizeRows();
    selectedId = null;
    selectedPanelId = null;
    dirty = true;
    requestAnimationFrame(fit);
  }

  // ---- overlays ----------------------------------------------------------------
  // An image dropped straight into the composition: a screenshot, a chart, a
  // crop from somewhere else. It never becomes a panel, so it is never filed as
  // media and the save records no source for it — it is decoration the analyst
  // moves, sizes and frames. Called a paste in the code and in the spec, after
  // how it gets there; the UI calls it an overlay, after what it is. The caps
  // mirror the ones the API enforces.

  let imageInputEl = $state();

  /** Doc-space centre of what the analyst is looking at. */
  function viewCentre() {
    if (!stage || !containerEl) return { x: 0, y: 0 };
    return {
      x: (containerEl.clientWidth / 2 - stage.x()) / stage.scaleX(),
      y: (containerEl.clientHeight / 2 - stage.y()) / stage.scaleY(),
    };
  }

  async function addPastedImage(file) {
    // A paste sits on top of a proof; the panels are what give the document its
    // size, so there has to be one before an image has anywhere to land.
    if (!proof.panels.length) {
      toast('Add a panel before adding an overlay', 'warn', 5000);
      return;
    }
    if (!file || !PASTE_TYPES.includes(file.type)) {
      toast('Paste a PNG, JPEG or WebP image', 'warn');
      return;
    }
    if (proof.pastes.length >= MAX_PASTES) {
      toast(`A proof holds ${MAX_PASTES} overlays at most`, 'warn');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length > MAX_PASTE_BYTES) {
        toast('That image is too large to paste (20 MB max)', 'warn');
        return;
      }
      const name = await assetName(bytes, file.type);
      const data = base64Of(bytes);
      const img = await loadImage(`data:${file.type};base64,${data}`);
      // an image already in the case keeps its saved state: no re-upload
      pasteAssets.set(name, { img, data, pending: pasteAssets.get(name)?.pending ?? true });
      const { width, height } = measureDoc();
      const natural = [img.naturalWidth, img.naturalHeight];
      const scale = pasteInsertScale(natural, width);
      const centre = viewCentre();
      const paste = newPaste(name, natural, {
        x: centre.x - (natural[0] * scale) / 2,
        y: centre.y - (natural[1] * scale) / 2,
        scale,
      });
      Object.assign(paste, clampPaste(paste, width, height));
      paste.img = img;
      proof.pastes.unshift(paste); // newest lands in front
      tool = 'select';
      selectPaste(paste.id);
      dirty = true;
    } catch (e) {
      toast(`Could not add that image (${e.message})`, 'danger');
    }
  }

  const isTextTarget = (el) =>
    !!el && (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable);

  /**
   * One place decides what Ctrl+V means: an image in the system clipboard is
   * what the analyst just copied, so it wins; otherwise the copied annotation is
   * pasted, which is what this shortcut did before images could be pasted.
   */
  function onPaste(e) {
    if (uiState.tool !== 'proof' || isTextTarget(e.target)) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (item) {
      e.preventDefault();
      addPastedImage(item.getAsFile());
    } else if (clipboard) {
      e.preventDefault();
      pasteShape();
    }
  }

  function pickImageFile() {
    imageInputEl?.click();
  }

  function onImageFile(e) {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = ''; // so picking the same file twice still fires
    if (file) addPastedImage(file);
  }

  function onCanvasDrop(e) {
    const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('image/'));
    if (!file) return;
    e.preventDefault();
    addPastedImage(file);
  }

  // Dropping an image on the canvas pastes it. Wired here rather than in the
  // markup so the canvas needs no interactive ARIA role to be a drop target.
  $effect(() => {
    if (!containerEl) return;
    const allow = (e) => e.preventDefault();
    containerEl.addEventListener('dragover', allow);
    containerEl.addEventListener('drop', onCanvasDrop);
    return () => {
      containerEl.removeEventListener('dragover', allow);
      containerEl.removeEventListener('drop', onCanvasDrop);
    };
  });

  function removePaste(index) {
    const paste = proof.pastes[index];
    if (!paste) return;
    proof.shapes = proof.shapes.filter((s) => s.panel !== paste.id);
    proof.pastes.splice(index, 1);
    selectedId = null;
    if (selectedPasteId === paste.id) selectedPasteId = null;
    dirty = true;
  }

  function movePasteZ(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= proof.pastes.length) return;
    const [paste] = proof.pastes.splice(index, 1);
    proof.pastes.splice(target, 0, paste);
    dirty = true;
  }

  /**
   * The decorative border of a panel or a pasted image. `patch` of null removes
   * it, `{}` adds it at the default colour and thickness, and a width of 0
   * removes it too — which is how the thickness input turns one off.
   */
  function setFrame(item, patch) {
    item.frame = patch === null ? null : normalizeFrame({ ...(item.frame ?? newFrame()), ...patch });
    dirty = true;
  }

  // ---- view (zoom / pan / fit) ----------------------------------------------------

  function fit() {
    if (!stage || !containerEl || !containerEl.clientWidth) return;
    const { width, height } = measureDoc();
    const k = Math.min(
      (containerEl.clientWidth - 24) / width,
      (containerEl.clientHeight - 24) / height,
      1.2
    );
    stage.scale({ x: k, y: k });
    stage.position({
      x: (containerEl.clientWidth - width * k) / 2,
      y: (containerEl.clientHeight - height * k) / 2,
    });
    stage.batchDraw();
  }

  function onWheel(e) {
    e.evt.preventDefault();
    const old = stage.scaleX();
    const pointer = stage.getPointerPosition();
    const factor = e.evt.deltaY > 0 ? 0.9 : 1.1;
    const k = Math.min(Math.max(old * factor, 0.08), 4);
    stage.scale({ x: k, y: k });
    stage.position({
      x: pointer.x - ((pointer.x - stage.x()) / old) * k,
      y: pointer.y - ((pointer.y - stage.y()) / old) * k,
    });
    if (guide) {
      const { width, height } = measureDoc();
      drawGuide(width, height);
    }
    drawPanelMoveControls(boxesOf()); // keep the arrow bar screen-sized
    stage.batchDraw();
  }

  // ---- drawing ----------------------------------------------------------------------

  function docPoint() {
    const p = stage.getPointerPosition();
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  }

  // Annotations are drawn on whatever surface is under the pointer — a panel or
  // a pasted image. Pasted images are in front, so they claim the point first.
  function surfaceAt(doc) {
    return surfaceHitTest(surfacesOf(), doc);
  }

  function onPointerDown(e) {
    // space-drag / middle-drag pans regardless of the active tool
    if (spacePan || e.evt.button === 1) {
      e.evt.preventDefault();
      const p = stage.getPointerPosition();
      panDrag = { sx: p.x, sy: p.y, ox: stage.x(), oy: stage.y() };
      return;
    }
    if (tool === 'select') {
      const onEmpty = e.target === stage || e.target.name() === 'bg';
      stage.draggable(onEmpty);
      if (onEmpty) {
        selectedId = null;
        selectedPanelId = null;
        selectedPasteId = null;
        selectedSig = null;
      }
      return;
    }
    stage.draggable(false);
    const hit = surfaceAt(docPoint());
    if (!hit) return;
    // `panel` here is the surface the annotation binds to: the shape's `panel`
    // field holds a panel id or a pasted image's id.
    const panel = hit.item;
    const group = docLayer.findOne(`#pg-${panel.id}`);
    if (!group) return;
    // text is placed with a single click (no drag) then edited in the side list
    if (tool === 'text') {
      const s = {
        id: newId('s'), panel: panel.id, kind: 'text', color,
        x: hit.nx, y: hit.ny, text: 'Text', fontSize: 28,
      };
      proof.shapes.push(s);
      selectedId = s.id;
      tool = 'select';
      dirty = true;
      return;
    }
    // curve: each click drops a vertex; double-click / Enter finishes
    if (tool === 'curve') {
      if (pathDraft && pathDraft.panel.id !== panel.id) return;
      if (!pathDraft) {
        const node = new Konva.Line({
          points: [hit.nx, hit.ny], tension: 0.5, stroke: color,
          strokeWidth: strokeW / hit.box.baseScale, lineCap: 'round', lineJoin: 'round',
          listening: false,
        });
        group.add(node);
        pathDraft = { panel, box: hit.box, node, points: [hit.nx, hit.ny] };
      } else {
        pathDraft.points.push(hit.nx, hit.ny);
        pathDraft.node.points([...pathDraft.points]);
        docLayer.batchDraw();
      }
      return;
    }
    const sw = strokeW / hit.box.baseScale;
    if (tool === 'freehand') {
      const node = new Konva.Line({
        points: [hit.nx, hit.ny], tension: 0.25, stroke: color,
        strokeWidth: sw, lineCap: 'round', lineJoin: 'round', listening: false,
      });
      group.add(node);
      drawing = { panel, node, box: hit.box, kind: tool };
      return;
    }
    const common = { stroke: color, strokeWidth: sw, listening: false };
    let node;
    if (tool === 'rect') {
      node = new Konva.Rect({ x: hit.nx, y: hit.ny, width: 1, height: 1, cornerRadius: 2, ...common });
    } else if (tool === 'ellipse') {
      node = new Konva.Ellipse({ x: hit.nx, y: hit.ny, radiusX: 1, radiusY: 1, ...common });
    } else {
      node = new Konva.Arrow({
        points: [hit.nx, hit.ny, hit.nx, hit.ny],
        pointerLength: tool === 'arrow' ? 14 / hit.box.baseScale : 0,
        pointerWidth: tool === 'arrow' ? 14 / hit.box.baseScale : 0,
        fill: color,
        ...common,
      });
    }
    group.add(node);
    drawing = { panel, node, start: { x: hit.nx, y: hit.ny }, box: hit.box, kind: tool };
  }

  function onPointerMove() {
    if (panDrag) {
      const p = stage.getPointerPosition();
      stage.position({ x: panDrag.ox + p.x - panDrag.sx, y: panDrag.oy + p.y - panDrag.sy });
      stage.batchDraw();
      return;
    }
    if (pathDraft) {
      const box = pathDraft.box;
      const doc = docPoint();
      const nx = Math.min(Math.max((doc.x - box.x) / box.scale, 0), pathDraft.panel.natural[0]);
      const ny = Math.min(Math.max((doc.y - box.y) / box.scale, 0), pathDraft.panel.natural[1]);
      pathDraft.node.points([...pathDraft.points, nx, ny]);
      docLayer.batchDraw();
      return;
    }
    if (!drawing) return;
    const box = drawing.box;
    const doc = docPoint();
    // clamp to the panel even if the pointer leaves it
    const nx = Math.min(Math.max((doc.x - box.x) / box.scale, 0), drawing.panel.natural[0]);
    const ny = Math.min(Math.max((doc.y - box.y) / box.scale, 0), drawing.panel.natural[1]);
    const { start, node, kind } = drawing;
    if (kind === 'freehand') {
      const points = node.points();
      const lx = points[points.length - 2];
      const ly = points[points.length - 1];
      if (nx !== lx || ny !== ly) node.points([...points, nx, ny]);
    } else if (kind === 'rect') {
      node.setAttrs({
        x: Math.min(start.x, nx), y: Math.min(start.y, ny),
        width: Math.abs(nx - start.x), height: Math.abs(ny - start.y),
      });
    } else if (kind === 'ellipse') {
      node.setAttrs({
        x: (start.x + nx) / 2, y: (start.y + ny) / 2,
        radiusX: Math.abs(nx - start.x) / 2, radiusY: Math.abs(ny - start.y) / 2,
      });
    } else {
      node.points([start.x, start.y, nx, ny]);
    }
    docLayer.batchDraw();
  }

  function onPointerUp() {
    if (panDrag) {
      panDrag = null;
      return;
    }
    if (tool === 'select') {
      stage.draggable(false);
      return;
    }
    if (!drawing) return;
    const { node, kind, panel } = drawing;
    const box = drawing.box;
    drawing = null;
    const minSize = 5 / box.scale;
    let shape = null;
    if (kind === 'rect' && node.width() > minSize && node.height() > minSize) {
      shape = { kind, x: node.x(), y: node.y(), w: node.width(), h: node.height() };
    } else if (kind === 'ellipse' && node.radiusX() * 2 > minSize && node.radiusY() * 2 > minSize) {
      shape = { kind, x: node.x(), y: node.y(), w: node.radiusX() * 2, h: node.radiusY() * 2 };
    } else if (kind === 'arrow' || kind === 'line') {
      const pts = node.points();
      if (Math.hypot(pts[2] - pts[0], pts[3] - pts[1]) > minSize) {
        shape = { kind, points: pts };
      }
    } else if (kind === 'freehand') {
      shape = freehandShape(node.points(), {
        minDistance: 2 / (box.scale * stage.scaleX()),
        minLength: minSize,
      });
    }
    node.destroy();
    if (shape) {
      const s = {
        id: newId('s'), panel: panel.id, color,
        strokeWidth: strokeW, ...shape,
      };
      proof.shapes.push(s);
      selectedId = s.id;
      dirty = true;
    }
  }

  function finishPath(commit) {
    if (!pathDraft) return;
    const { node, points, panel } = pathDraft;
    pathDraft = null;
    node.destroy();
    // the double-click that finishes drops a duplicate last vertex — trim it
    const pts = trimClosingDuplicate(points);
    if (commit && pts.length >= 4) {
      const s = {
        id: newId('s'), panel: panel.id, kind: 'curve', color,
        strokeWidth: strokeW, points: pts, tension: 0.5,
      };
      proof.shapes.push(s);
      selectedId = s.id;
      tool = 'select';
      dirty = true;
    } else {
      proof.shapes = [...proof.shapes]; // force rebuild to drop the preview
    }
  }

  // Fold a drag or a corner-resize of a pasted image back into its stored
  // position and scale, then hold it inside the document.
  function commitPasteNode(paste, node, { resized = false } = {}) {
    if (resized) paste.scale = clampPasteScale(node.scaleX());
    paste.x = node.x();
    paste.y = node.y();
    const { width, height } = measureDoc();
    Object.assign(paste, clampPaste(paste, width, height));
    node.scale({ x: paste.scale, y: paste.scale });
    node.position({ x: paste.x, y: paste.y });
    dirty = true;
  }

  /**
   * The decorative border of a panel or a pasted image, drawn inset so it never
   * spills past the image: the document is measured from the panels, and a frame
   * must not change what that measure sees. Width is in the surface's own pixels,
   * so it grows with the surface exactly as an annotation does.
   */
  function frameNode(frame, natural) {
    const w = frame.width;
    return new Konva.Rect({
      x: w / 2, y: w / 2,
      width: Math.max(0, natural[0] - w), height: Math.max(0, natural[1] - w),
      stroke: frame.color, strokeWidth: w, listening: false,
    });
  }

  // ---- rebuild canvas from state ------------------------------------------------------

  function rebuild() {
    docLayer.destroyChildren();
    // A template can be selected before any panels are chosen. Keep its style
    // in state, but do not render a background, footer, logo, or handle yet.
    if (!hasProofCanvasContent(proof)) {
      transformer.nodes([]);
      endHandles.destroyChildren();
      panelCtrls.destroyChildren();
      guideGroup.destroyChildren();
      docLayer.batchDraw();
      uiLayer.batchDraw();
      return;
    }
    const { width, height, legend, cols } = measureDoc();
    const boxes = boxesOf();
    const pasteBox = pasteBoxes(proof.pastes);
    const capSize = proof.captionSize ?? CAPTION_SIZE;
    const free = proof.layout === 'free';
    const { pad } = normSpace(proof.space);
    const bgFill = proof.bg ?? BG;
    const tc = textColors(bgFill); // caption/legend/footer colours track the bg

    docLayer.add(
      new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: bgFill })
    );

    // Drawn back→front: array order is front→back, so Z1 (the first panel in
    // the side list) is the foreground panel where free-mode panels overlap.
    for (let i = proof.panels.length - 1; i >= 0; i--) {
      const panel = proof.panels[i];
      const box = boxes[i];
      // Outer group is NOT clipped so an element can be dragged across panels;
      // only the image itself is clipped to the panel box (inner group).
      const group = new Konva.Group({
        id: `pg-${panel.id}`,
        x: box.x, y: box.y,
        scaleX: box.scale, scaleY: box.scale,
        draggable: free,
      });
      // Invisible full-panel hit target: the image itself never listens (so
      // drawing tools pass through to the stage), but the panel must catch
      // select-clicks — and, in free mode, drags. Added first so shapes stay
      // on top for hit-testing.
      group.add(new Konva.Rect({
        x: 0, y: 0, width: panel.natural[0], height: panel.natural[1],
        fill: 'transparent', listening: true, name: 'panel-hit',
      }));
      bindPanelPointerLifecycle(group, {
        // Only the select tool touches panels. Selection itself waits until the
        // gesture settles so rebuild() cannot destroy the pointerdown target.
        onPress: () => group.draggable(free && tool === 'select' && !spacePan),
        onSelect: () => selectPanel(panel.id),
        onDragEnd: free ? () => commitPanelNode(panel, group) : null,
      });
      if (free) {
        group.on('transformend', () => commitPanelNode(panel, group, { resized: true }));
      } else {
        // grid: corner-drag only changes the panel's scale — the grid decides
        // where it sits, so the row re-flows around the new size
        group.on('transformend', () => {
          const next = (group.scaleX() * panel.natural[1]) / PANEL_H;
          panel.scale = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, next)) * 100) / 100;
          dirty = true;
          requestAnimationFrame(fit);
        });
      }
      if (panel.img) {
        const imgClip = new Konva.Group({
          clip: { x: 0, y: 0, width: panel.natural[0], height: panel.natural[1] },
          listening: false,
        });
        imgClip.add(new Konva.Image({
          image: panel.img, width: panel.natural[0], height: panel.natural[1], listening: false,
        }));
        group.add(imgClip);
      }
      if (panel.frame) group.add(frameNode(panel.frame, panel.natural));
      for (const s of proof.shapes.filter((x) => x.panel === panel.id)) {
        group.add(makeShapeNode(s, box));
      }
      docLayer.add(group);
      if (panel.caption?.trim()) {
        docLayer.add(new Konva.Text({
          x: box.x + 2, y: box.y + box.h + 9,
          width: box.w - 4, text: panel.caption,
          fontSize: capSize, fontFamily: 'system-ui, sans-serif',
          fill: tc.dim, ellipsis: true, wrap: 'none', listening: false,
        }));
      }
    }

    // legend (colored dots) laid out in `cols` columns, then footer.
    // Dot + text scale with the legend font size and stay vertically centred.
    const legendSize = proof.legendSize ?? 17;
    const lineH = legendLineHeight(legendSize);
    const r = Math.round(legendSize * 0.62);
    const legendTop = panelsBottom(proof.panels, proof.captionSize, proof.layout, proof.space) + 8;
    const colW = (width - pad * 2 - (cols - 1) * pad) / cols;
    legend.filter((l) => l.text).forEach((line, i) => {
      const col = i % cols;
      const rowN = Math.floor(i / cols);
      const cx = pad + col * (colW + pad);
      const cy = legendTop + rowN * lineH + lineH / 2;
      docLayer.add(new Konva.Circle({
        x: cx + r, y: cy, radius: r, fill: line.color, listening: false,
      }));
      docLayer.add(new Konva.Text({
        x: cx + r * 2 + 8, y: cy - legendSize * 0.62, width: colW - (r * 2 + 8),
        text: line.text, fontSize: legendSize, fill: tc.main,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
    });
    if (proof.panels.length && proof.footerEnabled !== false) {
      const footerSize = proof.footerSize ?? 13;
      const footerText = proof.footer?.trim() || attributionLine(proof.panels);
      docLayer.add(new Konva.Text({
        x: pad,
        y: height - pad - footerBand(footerSize) + Math.round((footerBand(footerSize) - footerSize) / 2),
        width: width - pad * 2,
        text: footerText,
        align: proof.footerAlign === 'right' ? 'right' : 'left',
        fontSize: footerSize, fill: proof.footerColor || tc.faint,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
    }

    // Pasted images, over the panels and the legend: pixels laid on top of the
    // proof rather than part of its composition. Back→front like the panels, so
    // the first one in the list is the one in front.
    for (let i = proof.pastes.length - 1; i >= 0; i--) {
      const paste = proof.pastes[i];
      const box = pasteBox[i];
      const group = new Konva.Group({
        id: `pg-${paste.id}`,
        x: box.x, y: box.y,
        scaleX: box.scale, scaleY: box.scale,
        draggable: false,
      });
      // same invisible hit target as a panel: the image never listens, so a
      // drawing tool passes through to the stage, but a click still selects.
      group.add(new Konva.Rect({
        x: 0, y: 0, width: paste.natural[0], height: paste.natural[1],
        fill: 'transparent', listening: true, name: 'panel-hit',
      }));
      bindPanelPointerLifecycle(group, {
        onPress: () => group.draggable(tool === 'select' && !spacePan),
        onSelect: () => selectPaste(paste.id),
        onDragEnd: () => commitPasteNode(paste, group),
      });
      group.on('transformend', () => commitPasteNode(paste, group, { resized: true }));
      if (paste.img) {
        group.add(new Konva.Image({
          image: paste.img, width: paste.natural[0], height: paste.natural[1], listening: false,
        }));
      }
      if (paste.frame) group.add(frameNode(paste.frame, paste.natural));
      for (const s of proof.shapes.filter((x) => x.panel === paste.id)) {
        group.add(makeShapeNode(s, box));
      }
      docLayer.add(group);
    }

    const st = proof.signatureText && prefs.signatureHandle?.trim() ? proof.signatureText : null;
    const pendingHandleNode = st ? new Konva.Text({
      id: 'sig-text',
      text: prefs.signatureHandle.trim(),
      fontSize: st.size ?? SIG_TEXT_SIZE,
      fontStyle: 'bold',
      fontFamily: 'system-ui, sans-serif',
      fill: st.color ?? '#ffffff',
      opacity: st.opacity ?? 1,
      listening: true,
    }) : null;
    const sigNatural = proof.signature && sigImg
      ? [sigImg.naturalWidth, sigImg.naturalHeight]
      : null;
    const baseLogoBox = sigNatural
      ? signatureBox(proof.signature, width, height, sigNatural)
      : null;
    const pair = pendingHandleNode
      ? signaturePairPositions(
          proof.signature, st, width, height, baseLogoBox,
          pendingHandleNode.width(), pendingHandleNode.height(),
        )
      : null;

    // signature — last, so the logo sits over everything it overlaps. Drawn into
    // docLayer (not the UI layer) because it's part of the published image.
    if (proof.signature && sigImg) {
      const box = pair?.logo ?? baseLogoBox;
      const node = new Konva.Image({
        id: 'sig-logo',
        image: sigImg, x: box.x, y: box.y, width: box.w, height: box.h,
        opacity: proof.signature.opacity ?? 1,
      });
      // grabbable only with the select tool, and never mid-pan: a drawing tool
      // must pass through to the panel under the logo. Resolved on pointerdown
      // like the panels do, so the live tool decides without a rebuild.
      node.on('pointerdown', () => {
        node.draggable(tool === 'select' && !spacePan);
      });
      // a plain click (no drag) selects the logo so the resize handles appear.
      node.on('click tap', () => { if (tool === 'select') selectSig('logo'); });
      // the corner picker gets you there; the drag fine-tunes. Either way the
      // stored value is an offset from the anchor, so it survives a doc resize
      node.on('dragend', () => {
        const placement = signatureOffset(
          proof.signature, width, height, sigNatural, node.x(), node.y(),
        );
        proof.signature = { ...proof.signature, ...placement };
        dirty = true;
      });
      // corner-drag scales the logo; fold it back into the stored width share.
      node.on('transformend', () => {
        const scale = (proof.signature.scale ?? SIG_SCALE) * node.scaleX();
        node.scale({ x: 1, y: 1 });
        proof.signature = {
          ...proof.signature,
          scale: Math.round(Math.max(0.03, Math.min(0.4, scale)) * 1000) / 1000,
        };
        dirty = true;
      });
      docLayer.add(node);
    }

    // Account handle laid over the panels. Positioned
    // by anchor + drag like the logo, so it survives a document resize; drag it
    // anywhere with the select tool.
    if (st && pendingHandleNode) {
      const node = pendingHandleNode;
      const tw = node.width();
      const th = node.height();
      const pos = pair?.handle ?? anchoredPos(st, width, height, tw, th);
      node.position(pos);
      node.on('pointerdown', () => node.draggable(tool === 'select' && !spacePan));
      node.on('click tap', () => { if (tool === 'select') selectSig('text'); });
      node.on('dragend', () => {
        const placement = anchoredOffset(st, width, height, tw, th, node.x(), node.y());
        proof.signatureText = { ...st, ...placement };
        dirty = true;
      });
      // corner-drag scales the handle; fold it back into the stored font size.
      node.on('transformend', () => {
        const size = Math.round((st.size ?? SIG_TEXT_SIZE) * node.scaleX());
        node.scale({ x: 1, y: 1 });
        proof.signatureText = { ...st, size: Math.max(12, Math.min(300, size)) };
        dirty = true;
      });
      docLayer.add(node);
    }

    docLayer.batchDraw();
    refreshCanvasUi(boxes, width, height);
  }

  function refreshCanvasUi(boxes = null, width = null, height = null) {
    boxes ??= boxesOf();
    if (width === null || height === null) {
      const measured = measureDoc();
      width = measured.width;
      height = measured.height;
    }
    // Selection is keyed on the shape's kind, not the Konva node's class name,
    // since a framed/backgrounded text renders as a Group rather than a Text.
    // A whole panel can be selected instead (both modes): corner anchors only
    // (aspect locked, elements scale along), never rotated. In grid mode the
    // resize keeps only the scale — the grid re-flows the position.
    const selectedNode = selectedId ? docLayer.findOne(`#${selectedId}`) : null;
    const panelNode = !selectedNode && selectedPanelId
      ? docLayer.findOne(`#pg-${selectedPanelId}`)
      : null;
    // Panels are scale-clamped *during* the gesture: letting the transform run
    // free and clamping on release made the panel visibly snap back whenever
    // the drag overshot the 25–250% range (worst at the bounds, where a resize
    // in the blocked direction just reverted). Shapes stay unconstrained.
    // the logo or the @handle, picked for a corner-resize (aspect locked).
    // a pasted image resizes from its corners with its aspect locked, within the
    // same kind of scale bounds a panel has
    const pasteNode = !selectedNode && !panelNode && selectedPasteId
      ? docLayer.findOne(`#pg-${selectedPasteId}`)
      : null;
    const sigNode = !selectedNode && !panelNode && !pasteNode && selectedSig
      ? docLayer.findOne(selectedSig === 'logo' ? '#sig-logo' : '#sig-text')
      : null;
    const boundPanel = panelNode ? proof.panels.find((p) => p.id === selectedPanelId) : null;
    const boundPaste = pasteNode ? proof.pastes.find((p) => p.id === selectedPasteId) : null;
    transformer.boundBoxFunc((oldBox, newBox) => {
      if (boundPaste) {
        const implied = newBox.width / stage.scaleX() / boundPaste.natural[0];
        return implied < PASTE_SCALE_MIN || implied > PASTE_SCALE_MAX ? oldBox : newBox;
      }
      if (!boundPanel) return newBox;
      const impliedScale =
        (newBox.width / stage.scaleX()) * (boundPanel.natural[1] / (boundPanel.natural[0] * PANEL_H));
      return impliedScale < SCALE_MIN || impliedScale > SCALE_MAX ? oldBox : newBox;
    });
    transformer.keepRatio(!!sigNode || !!pasteNode);
    transformer.nodes(
      selectedNode
        ? [selectedNode]
        : panelNode ? [panelNode] : pasteNode ? [pasteNode] : sigNode ? [sigNode] : []
    );
    const selKind = selectedShape?.kind;
    transformer.rotateEnabled(selKind === 'text' || selKind === 'rect' || selKind === 'ellipse');
    transformer.enabledAnchors(
      selKind === 'rect' || selKind === 'ellipse'
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
        : selKind === 'text' || panelNode || pasteNode || sigNode
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : []
    );
    drawEndHandles(surfacesOf());
    drawPanelMoveControls(boxes);
    drawGuide(width, height);
    uiLayer.batchDraw();
  }

  // Tweet centre-crop preview: X displays a single image with object-fit: cover
  // into a box of the chosen aspect, so it crops whatever falls outside the
  // largest centred rect of that aspect. We dim that outside region and outline
  // the safe area. Screen-only (drawn on uiLayer, never exported).
  function drawGuide(width, height) {
    guideGroup.destroyChildren();
    const aspect = guide ? TWEET_GUIDES[guide] : null;
    if (!aspect || !proof.panels.length) return;
    let w = width, h = width / aspect;
    if (h > height) { h = height; w = height * aspect; }
    const gx = (width - w) / 2;
    const gy = (height - h) / 2;
    const dim = 'rgba(14, 14, 14, 0.62)';
    const masks = [
      { x: 0, y: 0, width, height: gy },
      { x: 0, y: gy + h, width, height: height - gy - h },
      { x: 0, y: gy, width: gx, height: h },
      { x: gx + w, y: gy, width: width - gx - w, height: h },
    ];
    for (const m of masks) {
      if (m.width > 0.5 && m.height > 0.5) {
        guideGroup.add(new Konva.Rect({ ...m, fill: dim, listening: false }));
      }
    }
    guideGroup.add(new Konva.Rect({
      x: gx, y: gy, width: w, height: h,
      stroke: '#e8a33d', strokeWidth: 2 / stage.scaleX(), dash: [10 / stage.scaleX(), 6 / stage.scaleX()],
      listening: false,
    }));
    guideGroup.add(new Konva.Text({
      x: gx + 8, y: gy + 6, text: `${guide} · visible in tweet`,
      fontSize: 15 / stage.scaleX(), fontStyle: 'bold', fill: '#e8a33d',
      fontFamily: 'system-ui, sans-serif', listening: false,
    }));
  }

  // Draggable per-vertex handles for the selected line / arrow / curve, so any
  // point can be re-placed after drawing (rects/ellipses/text use the transformer).
  // Freehand strokes stay draggable as a whole; showing every sampled point
  // would cover the stroke in handles.
  const POINT_KINDS = new Set(['line', 'arrow', 'curve']);
  function drawEndHandles(list) {
    endHandles.destroyChildren();
    const s = selectedShape;
    if (tool !== 'select' || !s || !POINT_KINDS.has(s.kind)) return;
    const surface = list.find((x) => x.id === s.panel);
    if (!surface) return;
    const box = surface.box;
    const panel = surface.item;
    const node = docLayer.findOne(`#${s.id}`);
    const r = 7 / stage.scaleX();
    for (let vi = 0; vi < s.points.length; vi += 2) {
      const handle = new Konva.Circle({
        x: box.x + s.points[vi] * box.scale,
        y: box.y + s.points[vi + 1] * box.scale,
        radius: r, fill: '#252525', stroke: '#e8a33d', strokeWidth: 2 / stage.scaleX(),
        draggable: true, name: 'endh',
      });
      const apply = (commit) => {
        const nx = Math.min(Math.max((handle.x() - box.x) / box.scale, 0), panel.natural[0]);
        const ny = Math.min(Math.max((handle.y() - box.y) / box.scale, 0), panel.natural[1]);
        handle.position({ x: box.x + nx * box.scale, y: box.y + ny * box.scale });
        if (commit) {
          s.points[vi] = nx;
          s.points[vi + 1] = ny;
          s.points = [...s.points];
          dirty = true;
        } else if (node) {
          const pts = [...s.points];
          pts[vi] = nx;
          pts[vi + 1] = ny;
          node.points(pts);
          docLayer.batchDraw();
        }
      };
      handle.on('dragmove', () => apply(false));
      handle.on('dragend', () => apply(true));
      endHandles.add(handle);
    }
  }

  // Grid-mode panel controls: the selected panel (framed by the transformer)
  // gets a floating arrow bar above it — ← → swap within the row, ↑ ↓ change
  // rows — so panels are moved right where you look instead of via side-list
  // buttons. (Free mode needs no arrows: the panel itself is draggable.)
  // Redrawn on rebuild and on zoom (constant on-screen size).
  function drawPanelMoveControls(boxes) {
    panelCtrls.destroyChildren();
    if (proof.layout === 'free' || tool !== 'select' || !selectedPanelId) return;
    const i = proof.panels.findIndex((p) => p.id === selectedPanelId);
    if (i < 0) return;
    const box = boxes[i];
    const k = stage.scaleX();
    const buttons = [
      { glyph: '←', enabled: canMoveLeft(i), act: () => movePanel(i, -1) },
      { glyph: '→', enabled: canMoveRight(i), act: () => movePanel(i, 1) },
      { glyph: '↑', enabled: (proof.panels[i].row ?? 0) > 0, act: () => movePanelRow(i, -1) },
      { glyph: '↓', enabled: true, act: () => movePanelRow(i, 1) },
    ];
    const s = 30 / k;
    const gap = 6 / k;
    let bx = box.x + box.w / 2 - (buttons.length * s + (buttons.length - 1) * gap) / 2;
    const by = box.y - s - 10 / k; // floats just above the panel
    for (const b of buttons) {
      const g = new Konva.Group({
        x: bx, y: by, opacity: b.enabled ? 1 : 0.35, listening: b.enabled,
      });
      g.add(new Konva.Rect({
        width: s, height: s, cornerRadius: 6 / k,
        fill: '#252525', stroke: '#e8a33d', strokeWidth: 1.5 / k,
      }));
      g.add(new Konva.Text({
        width: s, height: s, text: b.glyph, fontSize: 15 / k, fill: TEXT_MAIN,
        align: 'center', verticalAlign: 'middle',
        fontFamily: 'system-ui, sans-serif', listening: false,
      }));
      // swallow the press so the stage doesn't treat it as an empty-deselect
      g.on('pointerdown', (e) => { e.cancelBubble = true; });
      g.on('click tap', (e) => {
        e.cancelBubble = true;
        b.act();
      });
      g.on('pointerenter', () => { containerEl.style.cursor = 'pointer'; });
      g.on('pointerleave', () => { containerEl.style.cursor = ''; });
      panelCtrls.add(g);
      bx += s + gap;
    }
  }

  // On drop, re-bind a shape to whichever surface its anchor now sits over — a
  // panel or a pasted image — and convert its coordinates into that surface's
  // natural pixel space. Returns the source/destination layout boxes so the
  // caller can remap x/y or points.
  function rebindOnDrop(s, node) {
    const list = surfacesOf();
    const from = list.find((x) => x.id === s.panel);
    if (!from) return { fromBox: null, toBox: null };
    const fromBox = from.box;
    let anchor;
    if (s.kind === 'rect') {
      anchor = { x: node.x() + (s.w ?? 0) / 2, y: node.y() + (s.h ?? 0) / 2 };
    } else if (s.kind === 'ellipse' || s.kind === 'text') {
      anchor = { x: node.x(), y: node.y() };
    } else {
      const pts = s.points.map((v, i) => v + (i % 2 === 0 ? node.x() : node.y()));
      let sx = 0, sy = 0;
      for (let i = 0; i < pts.length; i += 2) { sx += pts[i]; sy += pts[i + 1]; }
      anchor = { x: sx / (pts.length / 2), y: sy / (pts.length / 2) };
    }
    const dx = fromBox.x + anchor.x * fromBox.scale;
    const dy = fromBox.y + anchor.y * fromBox.scale;
    // the list is front→back, so the topmost surface claims the drop
    const to = surfaceHitTest(list, { x: dx, y: dy }) ?? from;
    s.panel = to.id;
    return { fromBox, toBox: to.box };
  }

  // Doc→panel remap of a single x/y origin between two layout boxes.
  // `box` carries `scale` (natural→doc, grows with the panel) and `baseScale`
  // (that mapping at scale 1). Stroke width and arrow heads are normalised by
  // baseScale so they read the same across image resolutions yet still grow
  // proportionally when the panel is scaled up.
  function makeShapeNode(s, box) {
    const panelScale = box.baseScale;
    if (s.kind === 'text') {
      // The glyph itself: always built first so its measured size drives the
      // optional frame/background box. Unboxed, it's also the interactive node.
      const textNode = new Konva.Text({
        x: 0, y: 0, text: s.text || ' ',
        fontSize: s.fontSize ?? 28, fontFamily: 'system-ui, sans-serif',
        fontStyle: 'bold', fill: s.color,
      });
      const boxed = s.frame || s.bg;
      let node; // the draggable/transformable/selectable node (group when boxed)
      if (boxed) {
        const pad = Math.round((s.fontSize ?? 28) * 0.28);
        const w = textNode.width() + pad * 2;
        const h = textNode.height() + pad * 2;
        const frameSW = Math.max(2, Math.round((s.fontSize ?? 28) * 0.07));
        node = new Konva.Group({ id: s.id, x: s.x, y: s.y, rotation: s.rotation ?? 0, draggable: true });
        // invisible full-box hit target — clicking/dragging the padding (not
        // just the glyph or the frame stroke) must still select this element
        node.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: 'transparent', listening: true }));
        if (s.bg) {
          node.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: s.bg, cornerRadius: 4, listening: false }));
        }
        if (s.frame) {
          node.add(new Konva.Rect({
            x: 0, y: 0, width: w, height: h, stroke: s.color, strokeWidth: frameSW,
            cornerRadius: 4, listening: false,
          }));
        }
        textNode.position({ x: pad, y: pad });
        textNode.listening(false);
        node.add(textNode);
      } else {
        textNode.id(s.id);
        textNode.position({ x: s.x, y: s.y });
        textNode.rotation(s.rotation ?? 0);
        textNode.draggable(true);
        node = textNode;
      }
      node.on('pointerdown', (e) => {
        if (tool === 'select') {
          e.cancelBubble = true;
          selectedId = s.id;
          selectedPanelId = null;
          selectedPasteId = null;
          selectedSig = null;
        }
      });
      node.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        startTextEdit(s, textNode);
      });
      node.on('dragstart', () => node.getParent()?.moveToTop());
      node.on('dragend', () => {
        const { fromBox, toBox } = rebindOnDrop(s, node);
        const p = toBox ? remapPanelXY(node.x(), node.y(), fromBox, toBox) : { x: node.x(), y: node.y() };
        s.x = p.x;
        s.y = p.y;
        dirty = true;
      });
      node.on('transformend', () => {
        // corner drag scales the font, the top handle rotates; fold both back in
        s.fontSize = Math.max(6, Math.round((s.fontSize ?? 28) * node.scaleX()));
        s.rotation = node.rotation();
        s.x = node.x();
        s.y = node.y();
        node.scale({ x: 1, y: 1 });
        dirty = true;
      });
      return node;
    }
    const sw = (s.strokeWidth ?? 4) / panelScale;
    const common = {
      id: s.id, stroke: s.color, strokeWidth: sw, rotation: s.rotation ?? 0,
      draggable: true, hitStrokeWidth: Math.max(sw * 3, 14 / panelScale),
    };
    let node;
    if (s.kind === 'rect') {
      node = new Konva.Rect({ x: s.x, y: s.y, width: s.w, height: s.h, cornerRadius: 2, ...common });
    } else if (s.kind === 'ellipse') {
      node = new Konva.Ellipse({ x: s.x, y: s.y, radiusX: s.w / 2, radiusY: s.h / 2, ...common });
    } else if (s.kind === 'curve' || s.kind === 'freehand') {
      node = new Konva.Line({
        points: s.points, tension: s.tension ?? (s.kind === 'freehand' ? 0.25 : 0.5),
        lineCap: 'round', lineJoin: 'round', ...common,
      });
    } else {
      node = new Konva.Arrow({
        points: s.points,
        pointerLength: s.kind === 'arrow' ? 14 / panelScale : 0,
        pointerWidth: s.kind === 'arrow' ? 14 / panelScale : 0,
        fill: s.color,
        ...common,
      });
    }
    node.on('pointerdown', (e) => {
      if (tool === 'select') {
        e.cancelBubble = true;
        selectedId = s.id;
        selectedPanelId = null;
        selectedPasteId = null;
        selectedSig = null;
      }
    });
    node.on('dragstart', () => node.getParent()?.moveToTop());
    node.on('dragend', () => {
      if (s.kind === 'rect' || s.kind === 'ellipse') {
        const { fromBox, toBox } = rebindOnDrop(s, node);
        const p = toBox ? remapPanelXY(node.x(), node.y(), fromBox, toBox) : { x: node.x(), y: node.y() };
        s.x = p.x;
        s.y = p.y;
      } else {
        // points-based shapes: fold the drag offset into every vertex, then
        // remap the whole polyline into the panel it was dropped onto
        const dx = node.x(), dy = node.y();
        const folded = s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        const { fromBox, toBox } = rebindOnDrop(s, node);
        s.points = toBox
          ? folded.map((v, i) => {
              const doc = (i % 2 === 0 ? fromBox.x : fromBox.y) + v * (fromBox?.scale ?? 1);
              return (doc - (i % 2 === 0 ? toBox.x : toBox.y)) / toBox.scale;
            })
          : folded;
        node.position({ x: 0, y: 0 });
      }
      dirty = true;
    });
    node.on('transformend', () => {
      if (s.kind === 'rect') {
        s.x = node.x(); s.y = node.y();
        s.w = Math.abs(node.width() * node.scaleX());
        s.h = Math.abs(node.height() * node.scaleY());
      } else if (s.kind === 'ellipse') {
        s.x = node.x(); s.y = node.y();
        s.w = Math.abs(node.radiusX() * 2 * node.scaleX());
        s.h = Math.abs(node.radiusY() * 2 * node.scaleY());
      }
      s.rotation = node.rotation();
      node.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return node;
  }

  // ---- inline text editing (double-click a label on the canvas) ---------------
  function startTextEdit(s, node) {
    const panelScale = surfacesOf().find((x) => x.id === s.panel)?.box.scale ?? 1;
    const abs = node.getAbsolutePosition(); // container px, stage transform included
    selectedId = s.id;
    textEdit = {
      id: s.id,
      value: s.text ?? '',
      left: abs.x,
      top: abs.y,
      size: (s.fontSize ?? 28) * panelScale * stage.scaleX(),
      color: s.color,
    };
  }

  function commitTextEdit(keep = true) {
    if (!textEdit) return;
    if (keep) {
      const s = proof.shapes.find((x) => x.id === textEdit.id);
      if (s && s.text !== textEdit.value) {
        s.text = textEdit.value;
        dirty = true;
      }
    }
    textEdit = null;
  }

  const focusSelect = (el) => {
    el.focus();
    el.select();
  };

  // ---- shape ops from the side panel -----------------------------------------------------

  // ---- clipboard (copy / paste / duplicate of a single element) ---------------
  let clipboard = null; // detached deep copy of a shape spec (no id)

  function copyShape(id = selectedId) {
    const s = proof.shapes.find((x) => x.id === id);
    if (!s) return;
    clipboard = copyShapeSpec(s);
  }

  // Paste the clipboard as a fresh element, nudged down-right so it doesn't hide
  // the original. Points-based kinds shift every vertex.
  function pasteShape() {
    if (!clipboard) return;
    const target = proof.panels.some((p) => p.id === clipboard.panel)
      ? clipboard.panel
      : proof.panels[0]?.id;
    if (!target) return;
    const s = { ...offsetShape(clipboard, 26), id: newId('s'), panel: target };
    proof.shapes.push(s);
    selectedId = s.id;
    // cascade further pastes so repeated Ctrl+V steps down-right
    clipboard = offsetShape(s, 0);
    dirty = true;
  }

  function duplicateShape(id = selectedId) {
    copyShape(id);
    pasteShape();
  }

  function deleteShape(id) {
    const gone = proof.shapes.find((s) => s.id === id);
    proof.shapes = proof.shapes.filter((s) => s.id !== id);
    // drop the legend note if this was the last element of its color
    if (gone && !proof.shapes.some((s) => s.color === gone.color)) {
      delete proof.notes[gone.color];
    }
    if (selectedId === id) selectedId = null;
    dirty = true;
  }

  // Reorder a shape among same-panel siblings only — order doubles as z-order
  // (rebuild() adds shapes to their panel group in array order), so moving
  // past a shape bound to a different panel would silently no-op visually.
  function moveShape(index, delta) {
    const target = groupNeighborIndex(proof.shapes, index, delta, (s) => s.panel);
    if (target < 0) return;
    const [s] = proof.shapes.splice(index, 1);
    proof.shapes.splice(target, 0, s);
    dirty = true;
  }
  const canMoveShapeUp = (i) => hasGroupNeighbor(proof.shapes, i, -1, (s) => s.panel);
  const canMoveShapeDown = (i) => hasGroupNeighbor(proof.shapes, i, 1, (s) => s.panel);

  const KIND_ICON = { rect: 'square', ellipse: 'circle', arrow: 'arrow', line: 'line', curve: 'curve', freehand: 'freehand', text: 'text' };
  const KIND_LABEL = { rect: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', curve: 'Curve', freehand: 'Freehand', text: 'Text' };

  // Color / stroke controls live-edit the selected shape when there is one, and
  // always remember the pick as the default for the next drawn shape — the last
  // colour/width you touched stays your working colour, whether or not something
  // was selected at the time.
  function setColor(c) {
    if (selectedShape) {
      const oldColor = selectedShape.color;
      selectedShape.color = c;
      // carry the legend note over if this color is otherwise unused
      if (canReassignLegendNote(proof.notes, oldColor, c, proof.shapes, selectedShape)) {
        proof.notes[c] = proof.notes[oldColor];
        delete proof.notes[oldColor];
      }
      dirty = true;
    }
    color = c;
  }

  function setStroke(w) {
    // Font size is a text-only property, so editing it must not overwrite the
    // stroke-width default used for the next drawn shape.
    if (selectedShape?.kind === 'text') {
      selectedShape.fontSize = w;
      dirty = true;
      return;
    }
    if (selectedShape) {
      selectedShape.strokeWidth = w;
      dirty = true;
    }
    strokeW = w;
  }

  // Arrow-key nudge of the selected element, in panel-natural pixels.
  const NUDGE = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  function nudgeSelected(dx, dy) {
    const s = selectedShape;
    if (!s) return;
    if (Array.isArray(s.points)) {
      s.points = s.points.map((v, i) => v + (i % 2 === 0 ? dx : dy));
    } else {
      s.x = (s.x ?? 0) + dx;
      s.y = (s.y ?? 0) + dy;
    }
    dirty = true;
  }

  function onKeydown(e) {
    if (uiState.tool !== 'proof') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (pathDraft && (e.key === 'Enter' || e.key === 'Escape')) {
      finishPath(e.key === 'Enter');
      return;
    }
    // clipboard / undo / save chords
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      // Ctrl+V is deliberately absent: the paste event decides between an image
      // in the system clipboard and a copied annotation (see onPaste).
      if (k === 'c' && selectedId) { e.preventDefault(); copyShape(); }
      else if (k === 'd' && selectedId) { e.preventDefault(); duplicateShape(); }
      else if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); save(); }
      return; // don't fall through to the single-letter tool shortcuts
    }
    if (NUDGE[e.key] && selectedId) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudgeSelected(NUDGE[e.key][0] * step, NUDGE[e.key][1] * step);
      return;
    }
    if (e.key === ' ' && !e.repeat) {
      // hold space to pan, whatever the active tool — even over an element
      e.preventDefault();
      spacePan = true;
      docLayer.listening(false);
      containerEl.style.cursor = 'grab';
      return;
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      deleteShape(selectedId);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPanelId) {
      const idx = proof.panels.findIndex((p) => p.id === selectedPanelId);
      if (idx >= 0) removePanel(idx);
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedPasteId) {
      removePaste(proof.pastes.findIndex((p) => p.id === selectedPasteId));
    } else if (e.key === 'Escape') {
      selectedId = null;
      selectedPanelId = null;
      selectedPasteId = null;
      selectedSig = null;
      tool = 'select';
    } else if (e.key === 'v') tool = 'select';
    else if (e.key === 'r') tool = 'rect';
    else if (e.key === 'e') tool = 'ellipse';
    else if (e.key === 'a') tool = 'arrow';
    else if (e.key === 'l') tool = 'line';
    else if (e.key === 'c') tool = 'curve';
    else if (e.key === 'd') tool = 'freehand';
    else if (e.key === 't') tool = 'text';
    else if (e.key === 'f') fit();
  }

  function onKeyup(e) {
    if (e.key === ' ' && spacePan) {
      spacePan = false;
      panDrag = null;
      docLayer?.listening(true);
      if (containerEl) containerEl.style.cursor = '';
    }
  }

  // ---- persistence -------------------------------------------------------------------------

  function exportPng() {
    const { width, height } = measureDoc();
    const { pixelRatio } = proofExportOptions(width, height);
    const prevScale = stage.scale();
    const prevPos = stage.position();
    const prevSize = { w: stage.width(), h: stage.height() };
    try {
      transformer.nodes([]);
      stage.scale({ x: 1, y: 1 });
      stage.position({ x: 0, y: 0 });
      stage.width(width);
      stage.height(height);
      return docLayer.toDataURL({ x: 0, y: 0, width, height, pixelRatio });
    } finally {
      stage.scale(prevScale);
      stage.position(prevPos);
      stage.width(prevSize.w);
      stage.height(prevSize.h);
      rebuild();
    }
  }

  // Copy the composed PNG straight to the clipboard — for peer review in a
  // chat before publishing, without hunting the file in the case folder.
  let copying = $state(false);
  async function copyPng() {
    if (!proof.panels.length || copying) return;
    copying = true;
    try {
      const blob = await (await fetch(exportPng())).blob();
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      toast('Proof image copied. Paste it anywhere', 'ok');
    } catch (e) {
      toast(`Could not copy image: ${e.message}`, 'danger');
    } finally {
      copying = false;
    }
  }

  // Every proof already saved in this case, read off the filed entities: the
  // slugs (filename without `proofs/…​.json`) to catch a filename collision, and
  // the names so a fresh proof can take one that reads apart from them.
  const savedProofNames = () => savedSlugs(proofEntities, 'proof');
  const savedProofTitles = () => savedTitles(proofEntities, 'proof');

  // Default name for a fresh proof, numbered past those already in the case so
  // the top-of-screen name reads apart ("Proof 2"). Called on reset.
  const freshTitle = () => nextName('proof', savedProofTitles());

  let overwritePrompt = $state(null); // { slug, andPost } when a save hits a named proof

  async function save({ andPost = false } = {}) {
    if (!proof.panels.length || saving) return;
    // The name in the header is the filename. A bound proof writes back over
    // itself, and renaming it moves the file — the backend refuses a rename onto
    // a name another proof holds. An unbound proof landing on a saved name is
    // the one case that can go either way, so it asks first.
    if (!savedName && savedProofNames().has(slugify(proof.title, 'proof'))) {
      overwritePrompt = { slug: slugify(proof.title, 'proof'), andPost };
      return;
    }
    return performSave(andPost);
  }

  async function performSave(andPost = false) {
    if (!proof.panels.length || saving) return;
    saving = true;
    try {
      const c = await ensureCase();
      const dataUrl = exportPng();
      // Pasted images the case does not hold yet ride along with the spec; the
      // ones already written are named by their content, so they need no resend.
      const assets = [...new Set(proof.pastes.map((p) => p.asset))]
        .map((name) => ({ name, entry: pasteAssets.get(name) }))
        .filter(({ entry }) => entry?.pending && entry.data)
        .map(({ name, entry }) => ({ name, data: entry.data }));
      const result = await api.post(`/api/cases/${c.id}/proofs`, {
        rename_from: savedName,
        title: proof.title,
        spec: toSpec(proof),
        png_base64: dataUrl.split(',')[1],
        assets,
      });
      for (const { name } of assets) {
        const entry = pasteAssets.get(name);
        if (entry) entry.pending = false;
      }
      savedName = result.name;
      dirty = false;
      await reloadCase();
      toast(`Proof saved: ${result.png}`, 'ok');
      if (andPost) {
        uiState.postProof = {
          title: proof.title,
          coordsText: displayedCoords,
          source: displayedSource,
          attribution: attributionLine(proof.panels),
          png: result.png,
        };
        uiState.tool = 'post';
      }
    } catch (e) {
      toast(`Save failed: ${e.message}`, 'danger', 6000);
    } finally {
      saving = false;
    }
  }

  /** Open the list fresh: search and folder view reset. Deleting from the list
   *  refreshes through openProofList instead, which keeps them. */
  function openProofDialog() {
    proofQuery = '';
    proofBrowserOpen = false;
    proofBrowsePath = '';
    proofBrowseSelection = null;
    return openProofList();
  }

  async function openProofList() {
    const proofs = await api.get(`/api/cases/${caseState.current.id}/proofs`);
    // A saved proof is filed like any other entity, so its folder lives on the
    // catalog side; the proofs route only knows the files.
    try {
      const entities = await fetchAllEntities(caseState.current.id, { types: ['proof'] });
      const folders = new Map(
        entities.map((entity) => [entity.attrs?.spec ?? '', entity.attrs?.folder ?? ''])
      );
      openList = proofs.map((entry) => ({ ...entry, folder: folders.get(entry.spec_path) ?? '' }));
    } catch {
      openList = proofs;
    }
  }

  function matchesProofQuery(entry, query) {
    return matchesTerms([entry.title, entry.name, entry.folder].filter(Boolean).join('\n'), query);
  }

  function toggleProofBrowser() {
    if (proofBrowserOpen) {
      proofBrowserOpen = false;
      return;
    }
    proofQuery = '';
    proofBrowsePath = '';
    proofBrowseSelection = null;
    proofBrowserOpen = true;
  }

  function openProofFolder(path) {
    proofBrowsePath = path;
    proofBrowseSelection = null;
  }

  function selectProofBrowser(entry, confirm = false) {
    proofBrowseSelection = entry.name;
    if (confirm) openProof(entry);
  }

  function confirmProofBrowser() {
    const entry = proofBrowserEntries.find((item) => item.name === proofBrowseSelection);
    if (entry) openProof(entry);
  }

  let deleteEntry = $state(null); // open-list entry pending deletion
  async function deleteSavedProof() {
    const entry = deleteEntry;
    deleteEntry = null;
    try {
      await api.del(`/api/cases/${caseState.current.id}/proofs/${entry.name}`);
      await Promise.all([openProofList(), reloadCase()]);
      toast(`Deleted "${entry.title}"`, 'info');
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  async function openProof(entry) {
    const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${entry.name}`);
    const style = normalizeProofStyle(spec);
    resetDoc();
    proofStarted = true;
    // Bind the opened proof's name up front, before the panel images load: they
    // stream in one by one and enable the Save button as they arrive, so a Save
    // during the load has to write back over this proof, not file a new one.
    savedName = entry.name;
    proof.title = spec.title;
    proof.coordsText = spec.coordsText ?? '';
    proof.source = spec.source ?? '';
    proof.captionSize = style.captionSize;
    proof.legendSize = style.legendSize;
    proof.footerSize = style.footerSize;
    proof.footer = style.footer;
    proof.footerEnabled = style.footerEnabled;
    proof.footerColor = style.footerColor;
    proof.footerAlign = style.footerAlign;
    proof.captionsEnabled = style.captionsEnabled;
    proof.bg = style.bg;
    proof.space = style.space;
    proof.layout = style.layout;
    proof.panelDirection = style.panelDirection;
    proof.signature = style.signature;
    proof.signatureText = style.signatureText;
    proof.palette = style.palette;
    color = proof.palette[0];
    for (const p of spec.panels) {
      try {
        const img = await loadImage(`/files/${caseState.current.id}/${p.src}`);
        imgCache.set(p.src, img);
        proof.panels.push({ ...p, id: p.id ?? newId('p'), row: p.row ?? 0, img });
      } catch {
        toast(`Missing panel image: ${p.src}`, 'warn');
      }
    }
    // Pasted images come from the proof's own assets folder — nothing in the
    // case points at them, so they are read by the name the spec carries.
    for (const p of spec.pastes ?? []) {
      try {
        const img = await loadImage(
          `/files/${caseState.current.id}/proofs/${entry.name}.assets/${p.asset}`
        );
        pasteAssets.set(p.asset, { img, data: null, pending: false });
        proof.pastes.push({ ...p, id: p.id ?? newId('x'), img });
      } catch {
        toast('An overlay of this proof is missing', 'warn');
      }
    }
    const validSurfaces = new Set([...proof.panels, ...proof.pastes].map((s) => s.id));
    proof.shapes = (spec.shapes ?? []).filter((s) => validSurfaces.has(s.panel));
    // legend text lives in `notes` (per color); migrate old per-shape comments
    proof.notes = spec.notes ?? notesFromShapes(proof.shapes);
    proof.legendOrder = spec.legendOrder ?? [];
    proof.templateId = typeof spec.templateId === 'string' ? spec.templateId : null;
    const template = templatesState.proof.find((t) => t.id === proof.templateId);
    if (template) {
      // The style is already part of the saved proof. Restore only the picker
      // association, not the template's current values.
      appliedTemplate = { id: template.id, name: template.name, prevStyle: templateFromProof(proof) };
    }
    openList = null;
    dirty = false;
    anchorHistory();
    requestAnimationFrame(fit);
  }

  const selectedShape = $derived(proof.shapes.find((s) => s.id === selectedId));
  const activeColor = $derived(selectedShape?.color ?? color);
  const featureList = $derived(orderedFeatureColors(proof.shapes, proof.legendOrder));

  // Swap a legend entry with its neighbour, persisting the whole resulting
  // order — this also promotes any color that was only implicitly ordered
  // (first-use) into an explicit, saved position.
  function moveLegendColor(i, delta) {
    const j = i + delta;
    if (j < 0 || j >= featureList.length) return;
    const order = [...featureList];
    [order[i], order[j]] = [order[j], order[i]];
    proof.legendOrder = order;
    dirty = true;
  }

  // Coordinates + source shown above the panels: a manual override wins, else
  // the value auto-derived from the panels (reactive — deleting the first
  // satellite panel falls back to the next, adding media fills the source).
  const displayedCoords = $derived(
    proof.coordsText.trim() || formatCoords(autoCoords(proof.panels), prefs.coordFormat)
  );
  const displayedSource = $derived(proof.source.trim() || autoSource(proof.panels));
</script>

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} onpaste={onPaste} />

<div class="tool">
  <div class="tool-header">
    <h2>Geo Proof</h2>
    {#if proofStarted}
      <input
        class="input title-input"
        bind:value={proof.title}
        oninput={() => (dirty = true)}
      />
      {#if dirty}<span class="badge">unsaved</span>{/if}
    {/if}
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn btn-sm" onclick={openProofDialog}><Icon name="folderOpen" size={14} /> Open proof</button>
    {/if}
    {#if proofStarted}
      <button class="btn btn-sm" onclick={() => (discardConfirm = true)} title="Clear this proof">
        <Icon name="reset" size={14} /> Discard
      </button>
    {/if}
    <button class="btn btn-sm" onclick={openNewProofDialog}><Icon name="plus" size={14} /> New proof</button>
    <button
      class="btn btn-sm"
      onclick={copyPng}
      disabled={!proofHasContent || copying}
      title="Copy the composed PNG to the clipboard"
    >
      <Icon name="copy" size={14} /> {copying ? 'Copying…' : 'Copy PNG'}
    </button>
    <button class="btn btn-ok btn-sm" onclick={() => save()} disabled={!proofHasContent || saving}>
      <Icon name="save" size={14} /> {saving ? 'Saving…' : 'Save proof'}
    </button>
    <button class="btn btn-info btn-sm" onclick={() => save({ andPost: true })} disabled={!proofHasContent || saving}>
      <Icon name="post" size={14} /> To Post
    </button>
  </div>

  <div class="body">
    <!-- The drawing tools act on a proof; until one is open or created there is
         nothing to draw on, so the rail stays out of the way. -->
    {#if proofStarted}
    <ProofToolbar
      {canUndo}
      {canRedo}
      {undo}
      {redo}
      drawTools={DRAW_TOOLS}
      bind:tool
      palette={proof.palette}
      {activeColor}
      {selectedShape}
      {strokeW}
      {setColor}
      {setStroke}
      {fit}
      layout={proof.layout}
      {setLayoutMode}
      bind:guide
      tweetGuides={TWEET_GUIDES}
      panelCount={proof.panels.length}
      {applyMagic}
    />
    {/if}

    <ProofCanvas
      bind:containerEl
      {tool}
      {textEdit}
      {focusSelect}
      {commitTextEdit}
      {proofHasContent}
      {proofStarted}
      {openPicker}
      {openNewProofDialog}
    />

    <!-- Image picked off the disk for a paste: it goes into the proof, never
         into the case, so it does not travel through the media ingest. -->
    <input
      type="file"
      hidden
      accept="image/png,image/jpeg,image/webp"
      bind:this={imageInputEl}
      onchange={onImageFile}
    />

    <!-- right: proof settings, panels & annotations -->
    {#if proofStarted}
      <aside class="side">
        <div class="side-scroll">
        <!-- House style stays independent from content. A new proof can keep a
             selected template while its canvas remains empty until panels land. -->
        <div class="meta-field">
          <div class="meta-head">
            <Icon name="layers" size={13} />
            <span>House style</span>
            {#if templatesState.proof.length}
              <button
                class="tpl-settings-link"
                type="button"
                title="Manage proof styles in Settings"
                onclick={openTemplateSettings}
              >
                Settings templates
              </button>
            {/if}
          </div>
          {#if templatesState.proof.length}
            <select
              class="input meta-input"
              value={appliedTemplate?.id ?? ''}
              title="Choose a saved house style"
              onchange={applyFromSelect}
            >
              <option value="">No template</option>
              {#each templatesState.proof as t (t.id)}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          {:else}
            <p class="tpl-none">
              No templates yet.
              <button
                class="tpl-inline-link"
                type="button"
                title="Open Settings → Templates to create your first house style"
                onclick={openTemplateSettings}
              >
                Create one in Settings → Templates.
              </button>
            </p>
          {/if}
        </div>

        <!-- Proof context: coordinates + source, auto-filled from the panels,
             overridable. A ! flags a value the analyst still needs to supply. -->
        <div class="meta-field">
          <div class="meta-head">
            <Icon name="crosshair" size={13} />
            <span>Coordinates</span>
            {#if !displayedCoords}
              <span class="meta-warn" title="Add a satellite panel or type the coordinates">
                <Icon name="alert" size={13} />
              </span>
            {/if}
            {#if proof.coordsText.trim()}
              <button class="meta-reset" title="Reset to the coordinates from the imagery" onclick={() => { proof.coordsText = ''; dirty = true; }}>
                <Icon name="reset" size={12} />
              </button>
            {/if}
          </div>
          <input
            class="input meta-input"
            class:warn={!displayedCoords}
            placeholder="lat, lon"
            value={displayedCoords}
            oninput={(e) => { proof.coordsText = e.target.value; dirty = true; }}
          />
        </div>
        <div class="meta-field">
          <div class="meta-head">
            <Icon name="link" size={13} />
            <span>Source</span>
            {#if !displayedSource}
              <span class="meta-warn" title="Missing source link">
                <Icon name="alert" size={13} />
              </span>
            {/if}
            {#if proof.source.trim()}
              <button class="meta-reset" title="Reset to the source traced from the media" onclick={() => { proof.source = ''; dirty = true; }}>
                <Icon name="reset" size={12} />
              </button>
            {/if}
          </div>
          <input
            class="input meta-input"
            class:warn={!displayedSource}
            placeholder="https://…"
            value={displayedSource}
            oninput={(e) => { proof.source = e.target.value; dirty = true; }}
          />
        </div>

        <ProofLayersPanel
          {proof}
          {collapsed}
          {gonePanels}
          bind:selectedPanelId
          bind:selectedPasteId
          bind:selectedId
          {activeColor}
          caseId={caseState.current?.id}
          scaleMin={SCALE_MIN}
          scaleMax={SCALE_MAX}
          scaleStep={SCALE_STEP}
          frameWidthMax={FRAME_WIDTH_MAX}
          frameColor={FRAME_COLOR}
          {openPicker}
          {movePanelZ}
          {scalePanel}
          {removePanel}
          {movePasteZ}
          {removePaste}
          {setFrame}
          {pickImageFile}
          {featureList}
          {moveLegendColor}
          {setColor}
          {canMoveShapeUp}
          {canMoveShapeDown}
          {moveShape}
          kindIcon={KIND_ICON}
          kindLabel={KIND_LABEL}
          {duplicateShape}
          {deleteShape}
          markDirty={() => (dirty = true)}
        />

        <!-- Advanced: text sizes, editable footer, signature (the trickier knobs) -->
        <button class="adv-toggle" onclick={() => (advancedOpen = !advancedOpen)} style="margin-top: 14px">
          <Icon name={advancedOpen ? 'chevronDown' : 'chevronRight'} size={13} />
          Advanced: text, footer &amp; signature
        </button>
        {#if advancedOpen}
          <div class="adv-body">
            <label class="sig-check">
              <input
                type="checkbox"
                checked={proof.captionsEnabled !== false}
                onchange={(e) => {
                  proof.captionsEnabled = e.currentTarget.checked;
                  dirty = true;
                }}
              />
              <span>Caption new panels</span>
            </label>
            <div class="adv-hint">Off: added panels start blank. You can still type a caption on any panel.</div>
            <div class="size-row">
              <span>Caption size</span>
              <input class="size-slider" type="range" min="10" max="40" step="1"
                bind:value={proof.captionSize} oninput={() => (dirty = true)} />
              <span class="size-val">{proof.captionSize}</span>
            </div>
            <div class="size-row">
              <span>Legend size</span>
              <input class="size-slider" type="range" min="11" max="40" step="1"
                bind:value={proof.legendSize} oninput={() => (dirty = true)} />
              <span class="size-val">{proof.legendSize}</span>
            </div>
            <label class="sig-check">
              <input
                type="checkbox"
                checked={proof.footerEnabled !== false}
                onchange={(e) => {
                  proof.footerEnabled = e.currentTarget.checked;
                  dirty = true;
                }}
              />
              <span>Show footer</span>
            </label>
            {#if proof.footerEnabled !== false}
              <div class="size-row">
                <span>Footer size</span>
                <input class="size-slider" type="range" min="10" max="32" step="1"
                  bind:value={proof.footerSize} oninput={() => (dirty = true)} />
                <span class="size-val">{proof.footerSize}</span>
              </div>
              <label class="adv-label" for="footer-text">Footer text</label>
              <textarea
                id="footer-text"
                class="input footer-input"
                rows="2"
                placeholder={attributionLine(proof.panels)}
                bind:value={proof.footer}
                oninput={() => (dirty = true)}
              ></textarea>
              <div class="size-row">
                <span>Footer alignment</span>
                <select class="input" bind:value={proof.footerAlign}
                  onchange={() => (dirty = true)}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
              <div class="adv-hint">Leave empty to keep the automatic imagery / source attribution.</div>
            {:else}
              <div class="adv-hint">The band under the panels is gone. Drop all margins for panels-only output.</div>
            {/if}

            <label class="sig-check">
              <input
                type="checkbox"
                disabled={!sigImg}
                checked={!!proof.signature && !!sigImg}
                onchange={(e) => {
                  proof.signature = e.currentTarget.checked ? newSignature() : null;
                  dirty = true;
                }}
              />
              <span>Signature</span>
            </label>
            {#if !sigImg}
              <div class="adv-hint">Add a logo in Settings → Preferences to sign your proofs.</div>
            {:else if proof.signature}
              <div class="sig-anchors">
                {#each SIG_ANCHORS as a (a.id)}
                  <button
                    class="sig-anchor"
                    class:active={proof.signature.anchor === a.id}
                    title={a.label}
                    onclick={() => {
                      // a new corner starts fresh: the old nudge was measured
                      // from the old corner, so keeping it would fling the logo
                      proof.signature = {
                        ...proof.signature,
                        anchor: a.id,
                        dx: 0,
                        dy: 0,
                        xRatio: undefined,
                        yRatio: undefined,
                      };
                      dirty = true;
                    }}
                  >{a.label}</button>
                {/each}
              </div>
              <div class="size-row">
                <span>Size</span>
                <input class="size-slider" type="range" min="0.03" max="0.4" step="0.01"
                  value={proof.signature.scale}
                  oninput={(e) => {
                    proof.signature = { ...proof.signature, scale: Number(e.currentTarget.value) };
                    dirty = true;
                  }} />
                <span class="size-val">{Math.round(proof.signature.scale * 100)}%</span>
              </div>
              <div class="size-row">
                <span>Opacity</span>
                <input class="size-slider" type="range" min="0.1" max="1" step="0.05"
                  value={proof.signature.opacity}
                  oninput={(e) => {
                    proof.signature = { ...proof.signature, opacity: Number(e.currentTarget.value) };
                    dirty = true;
                  }} />
                <span class="size-val">{Math.round(proof.signature.opacity * 100)}%</span>
              </div>
              <div class="adv-hint">Drag the logo on the canvas to nudge it off the corner.</div>
            {/if}

            <label class="sig-check">
              <input
                type="checkbox"
                disabled={!prefs.signatureHandle?.trim()}
                checked={!!proof.signatureText && !!prefs.signatureHandle?.trim()}
                onchange={(e) => {
                  proof.signatureText = e.currentTarget.checked ? newSignatureText() : null;
                  dirty = true;
                }}
              />
              <span>Add account handle</span>
            </label>
            {#if !prefs.signatureHandle?.trim()}
              <div class="adv-hint">Add your account handle in Settings → Preferences to use it on proofs.</div>
            {:else if proof.signatureText}
              <div class="adv-hint">Drag the account handle on the canvas to place it.</div>
            {/if}
          </div>
        {/if}
        </div>
      </aside>
    {/if}
  </div>
</div>

{#if newProofOpen}
  <NewProofDialog
    bind:templateId={newProofTemplateId}
    bind:panelPaths={newProofPanelPaths}
    bind:query={newProofQuery}
    bind:category={newProofCategory}
    templates={templatesState.proof}
    items={pickerItems}
    filteredItems={filteredNewProofItems}
    loading={newProofLoading}
    creating={creatingProof}
    caseId={caseState.current?.id}
    togglePanel={toggleNewProofPanel}
    requestCreation={requestNewProofCreation}
    close={() => (newProofOpen = false)}
  />
{/if}

{#if replaceWithNewConfirm}
  <ConfirmDialog
    title="Create a new proof?"
    message="The current proof has unsaved changes."
    detail="Creating a new proof discards those changes."
    confirmLabel="Create proof"
    tone="danger"
    icon="plus"
    onconfirm={() => { replaceWithNewConfirm = false; createNewProof(); }}
    oncancel={() => (replaceWithNewConfirm = false)}
  />
{/if}

{#if discardConfirm}
  <ConfirmDialog
    title="Discard this proof?"
    message="This clears the current document."
    detail={savedName ? 'This does not delete the saved proof, only the unsaved changes here.' : 'Anything not saved yet will be lost.'}
    confirmLabel="Discard"
    tone="danger"
    icon="reset"
    onconfirm={discardProof}
    oncancel={() => (discardConfirm = false)}
  />
{/if}

{#if overwritePrompt}
  <ConfirmDialog
    title="Overwrite this proof?"
    message={`“${savedTitle(proofEntities, 'proof', overwritePrompt.slug)}” is already saved in this case.`}
    detail="Saving replaces its PNG and editable spec. Rename this proof to keep both."
    confirmLabel="Overwrite"
    tone="danger"
    icon="check"
    onconfirm={() => {
      const p = overwritePrompt;
      overwritePrompt = null;
      performSave(p.andPost);
    }}
    oncancel={() => (overwritePrompt = null)}
  />
{/if}

{#if deleteEntry}
  <ConfirmDialog
    title="Delete this proof?"
    message={`“${deleteEntry.title}” will be removed from the case.`}
    detail="Deletes the PNG and editable proof and cannot be undone."
    confirmLabel="Delete"
    tone="danger"
    icon="trash"
    onconfirm={deleteSavedProof}
    oncancel={() => (deleteEntry = null)}
  />
{/if}

{#if picker}
  <Modal title="Add a panel" onclose={() => (picker = false)} width="720px">
    {#if !pickerItems.length}
      <div class="empty">
        <p>No images in this case yet. Import media or capture satellite imagery first.</p>
      </div>
    {:else}
      <div class="picker-stack">
        {#if panelBrowserOpen || pickerItems.length > PICKER_SEARCH_MIN}
          <div class="picker-search">
            <SearchInput bind:value={panelQuery} placeholder="Search titles…" width="100%" />
            <button
              class="btn btn-ghost btn-sm browse-btn"
              title={panelBrowserOpen ? 'Show every image' : 'Browse folders'}
              onclick={togglePanelBrowser}
            >…</button>
          </div>
        {/if}
        <PanelCategories items={pickerItems} category={panelCategory} onpick={setPanelCategory} />
        {#if panelBrowserOpen}
          <FolderBrowser
            entries={panelBrowserEntries}
            path={panelBrowsePath}
            rootLabel="Case images"
            selectedId={panelBrowseSelection}
            matches={(item) => filterProofPanelItems([item], panelQuery, 'all').length > 0}
            emptyText="This folder has no matching images."
            icon={(item) => (item.kind === 'satellite' ? 'satellite' : 'image')}
            onnavigate={openPanelFolder}
            onselect={(item) => selectPanelBrowser(item)}
            onconfirm={(item) => selectPanelBrowser(item, true)}
          />
          <div class="picker-actions">
            <button class="btn btn-primary btn-sm" disabled={!panelBrowseSelection} onclick={confirmPanelBrowser}>Add selected</button>
          </div>
        {:else if !visiblePanelItems.length}
          <p class="picker-hint">No image matches this search.</p>
        {:else}
          <div class="pick-grid">
            {#each visiblePanelItems as item (item.src)}
              <button class="pick card" onclick={() => addPanelFromPicker(item)}>
                {#if item.thumb}
                  <img src={`/files/${caseState.current.id}/${item.thumb}`} alt="" loading="lazy" decoding="async" />
                {:else if item.thumbPending}
                  <span class="pick-placeholder"><Icon name="clock" size={20} /></span>
                {:else}
                  <span class="pick-placeholder">
                    <Icon name={item.kind === 'satellite' ? 'satellite' : 'image'} size={20} />
                  </span>
                {/if}
                <span class="pick-label">
                  <Icon name={item.kind === 'satellite' ? 'satellite' : 'image'} size={12} />
                  {item.label}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}

{#if openList}
  <Modal title="Open a saved proof" onclose={() => (openList = null)} width="560px">
    {#if !openList.length}
      <div class="empty"><p>No saved proofs in this case yet.</p></div>
    {:else}
      <div class="picker-stack">
        {#if proofBrowserOpen || openList.length > PICKER_SEARCH_MIN}
          <div class="picker-search">
            <SearchInput bind:value={proofQuery} placeholder="Search proofs…" width="100%" />
            <button
              class="btn btn-ghost btn-sm browse-btn"
              title={proofBrowserOpen ? 'Show every proof' : 'Browse folders'}
              onclick={toggleProofBrowser}
            >…</button>
          </div>
        {/if}
        {#if proofBrowserOpen}
          <FolderBrowser
            entries={proofBrowserEntries}
            path={proofBrowsePath}
            rootLabel="Proofs"
            selectedId={proofBrowseSelection}
            matches={(entry) => matchesProofQuery(entry, proofQuery)}
            emptyText="This folder has no matching proofs."
            icon={() => 'proof'}
            label={(entry) => entry.title}
            onnavigate={openProofFolder}
            onselect={(entry) => selectProofBrowser(entry)}
            onconfirm={(entry) => selectProofBrowser(entry, true)}
          />
          <div class="picker-actions">
            <button class="btn btn-primary btn-sm" disabled={!proofBrowseSelection} onclick={confirmProofBrowser}>Open selected</button>
          </div>
        {:else if !visibleProofs.length}
          <p class="picker-hint">No proof matches this search.</p>
        {:else}
          <div class="open-list">
            {#each visibleProofs as entry (entry.name)}
              <div class="open-row-wrap">
                <button class="open-row" onclick={() => openProof(entry)}>
                  {#if entry.thumb || entry.png}
                    <!-- the thumbnail of the export, or the export itself when
                         it could not be rendered; decoded off the main thread -->
                    <img src={`/files/${caseState.current.id}/${entry.thumb ?? entry.png}`} alt="" loading="lazy" decoding="async" />
                  {/if}
                  <div class="open-meta">
                    <span class="open-title">{entry.title}</span>
                    <span class="open-sub">{entry.panels} panels · {entry.shapes} annotations · {entry.updated_at?.slice(0, 10)}</span>
                  </div>
                </button>
                <button class="btn btn-ghost btn-sm open-del" title="Delete this saved proof" onclick={() => (deleteEntry = entry)}>
                  <Icon name="trash" size={13} />
                </button>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}
  </Modal>
{/if}

<style>
  .tool-header {
    align-items: baseline;
    gap: 10px;
    padding: 14px 16px 12px;
    flex-shrink: 0;
  }
  .tool-header h2 {
    font-weight: 700;
  }
  .spacer { flex: 1; }
  .tpl-none {
    margin: 0 0 6px;
    font-size: var(--fs-xs);
    color: var(--text-3);
    line-height: 1.4;
  }
  .body {
    flex: 1;
    display: flex;
    min-height: 0;
  }
  .side {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    min-height: 0;
  }
  .side-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 12px;
  }
  .meta-field { margin-bottom: 10px; }
  .meta-head {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 5px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
  }
  .meta-warn { color: var(--warn, #e8a33d); display: inline-flex; }
  .meta-reset {
    margin-left: auto;
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: var(--r-sm);
  }
  .meta-reset:hover { color: var(--text-1); background: var(--bg-2); }
  .tpl-settings-link {
    margin-left: auto;
    display: inline-flex;
    align-items: center;
    color: var(--text-3);
    font-size: var(--fs-xs);
    font-weight: 600;
    text-transform: none;
    letter-spacing: 0;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-settings-link:hover { color: var(--text-2); }
  .tpl-inline-link {
    color: var(--text-3);
    font: inherit;
    text-decoration: underline;
    text-decoration-style: dotted;
    text-underline-offset: 2px;
  }
  .tpl-inline-link:hover { color: var(--text-2); }
  .meta-input { width: 100%; font-size: var(--fs-xs); padding: 5px 8px; }
  .meta-input.warn { border-color: color-mix(in srgb, var(--warn, #e8a33d) 55%, transparent); }
  .adv-toggle {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    padding: 6px 2px;
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
  }
  .adv-toggle:hover { color: var(--text-1); }
  .adv-body { padding: 4px 2px 2px; }
  .size-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .size-row span:first-child { min-width: 78px; }
  .size-slider { flex: 1; accent-color: var(--accent); }
  .size-val { min-width: 18px; text-align: right; color: var(--text-2); }
  .adv-label {
    display: block;
    font-size: var(--fs-xs);
    color: var(--text-3);
    margin: 8px 0 4px;
  }
  .footer-input {
    width: 100%;
    font-size: var(--fs-xs);
    resize: vertical;
    font-family: inherit;
  }
  .adv-hint { font-size: 11px; color: var(--text-3); margin-top: 5px; }
  .sig-check {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  .sig-check input:disabled { cursor: not-allowed; }
  .sig-check:has(input:disabled) { color: var(--text-3); cursor: not-allowed; }
  .sig-anchors {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 4px;
    margin-top: 7px;
  }
  .sig-anchor {
    padding: 5px 6px;
    font-size: 11px;
    color: var(--text-2);
    background: var(--bg-2);
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .sig-anchor:hover { color: var(--text-1); }
  .sig-anchor.active {
    color: var(--accent);
    border-color: var(--accent);
  }
  .picker-stack {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .picker-search {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .picker-search :global(.search-box) {
    flex: 1;
  }
  .browse-btn {
    min-width: 30px;
    font-size: var(--fs-lg);
    line-height: 1;
  }
  .picker-hint {
    color: var(--text-3);
    font-size: var(--fs-sm);
    padding: 8px 2px;
  }
  .picker-actions {
    display: flex;
    justify-content: flex-end;
  }
  .pick-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
    gap: 10px;
  }
  .pick {
    overflow: hidden;
    text-align: left;
    transition: border-color 0.15s var(--ease);
  }
  .pick:hover { border-color: var(--accent); }
  .pick img {
    width: 100%;
    aspect-ratio: 16 / 11;
    object-fit: cover;
    background: var(--bg-2);
  }
  .pick-placeholder {
    width: 100%;
    aspect-ratio: 16 / 11;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--bg-2);
    color: var(--text-3);
  }
  .pick-label {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 6px 8px;
    font-size: var(--fs-xs);
    color: var(--text-2);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .open-list { display: flex; flex-direction: column; gap: 8px; }
  .open-row-wrap { display: flex; align-items: center; gap: 4px; }
  .open-row-wrap .open-row { flex: 1; min-width: 0; }
  .open-del { color: var(--danger); flex-shrink: 0; }
  .open-row {
    display: flex;
    gap: 12px;
    align-items: center;
    padding: 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-md);
    background: var(--bg-2);
    text-align: left;
  }
  .open-row:hover { border-color: var(--accent); }
  .open-row img {
    width: 110px;
    aspect-ratio: 16 / 10;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-3);
  }
  .open-meta { display: flex; flex-direction: column; gap: 2px; }
  .open-title { font-weight: 600; font-size: var(--fs-sm); }
  .open-sub { font-size: var(--fs-xs); color: var(--text-3); }
</style>
