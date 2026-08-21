<script>
  import { onMount, untrack } from 'svelte';
  import { fileUrl } from '../lib/fileUrl.js';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { lookupEntity, fetchAllEntities } from '../lib/catalog.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { isSatelliteMedia } from '../lib/mediaFilter.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  import { caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords } from '../lib/state.svelte.js';
  import { templatesState } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';
  import ProofToolbar from './proof/ProofToolbar.svelte';
  import ProofCanvas from './proof/ProofCanvas.svelte';
  import ProofLayersPanel from './proof/ProofLayersPanel.svelte';
  import NewProofDialog from './proof/NewProofDialog.svelte';
  import ImportProofDialog from './proof/ImportProofDialog.svelte';
  import PanelCategories from './proof/PanelCategories.svelte';
  import { bindPanelPointerLifecycle, createCanvasRenderGate,
  discardDraft,
} from './proof/canvasLifecycle.js';
  import { closeStrandedGesture } from '../lib/konvaGesture.js';
  import {
    ANNO_COLORS, PAD, GAP, ROW_GAP, PANEL_H, TWEET_GUIDES,
    CAPTION_SIZE, LEGEND_SIZE, FOOTER_SIZE,
    BG, TEXT_MAIN, normSpace, textColors,
    layoutPanels, panelsBottom, freeNormalizeDelta, legendLineHeight, footerBand,
    attributionLine, docSize, offsetShape, autoLayoutRows,
    autoCoords, formatCoords, autoSourceUrls, proofSource, statedSources,
    specPoints, footerLines, coordsPostLines, proofCoordsLines, MAX_POINTS,
    normalizeMaterial, resolveSourceUrls,
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
    canFill,
    fillPaint,
    movedBy,
    nextPanelRow,
    notesAfterRemoval,
    nudgeShape,
    PANEL_SCALE_MAX,
    PANEL_SCALE_MIN,
    pointsWithTransform,
    scaleFromNode,
    textBoxPad,
    viewCentrePoint,
  } from '../lib/proofEdits.js';
  import {
    ICON_BOX, ICON_SIZE_MIN, PROOF_ICONS,
    glyphInk, iconByName, iconOrigin, iconSizeFor, isSolidIcon,
  } from '../lib/proofIcons.js';
  import {
    assetName, base64Of, PASTE_TYPES, MAX_PASTES, MAX_PASTE_BYTES,
  } from '../lib/pasteAsset.js';
  import {
    nextName, savedSlugs, savedTitles, savedTitle, slugify, specAttr, specPath,
  } from '../lib/naming.js';
  import { createHistory } from '../lib/history.js';
  import { pollWhile } from '../lib/poll.js';

  const SCALE_STEP = 0.05;

  const DRAW_TOOLS = [
    { id: 'select', icon: 'cursor', label: 'Select / move', shortcut: 'v' },
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
    // What the proof concludes on, one row per point, the first one the conclusion.
    // Always at least one row: an empty one reads as the coordinates the panels
    // give it, which is what the field has always shown.
    points: [{ coords: '', label: '', pov: false }],
    sources: null, // null → traced from the panels; a list → what the analyst states
    // Case files the proof rests on without composing them, brought in from a stated
    // source address. They join the chain on save, and the point with it.
    material: [],
    footerCoords: false, // whether the plate prints the proof's points
    footerText: true, // whether the plate prints its credit line
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
  // The document as it stands on disk, so an undo that walks all the way back
  // to it can say the proof is saved again. null until a save or an open has
  // put something there to match.
  let savedSnapshot = null;
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
    lookupEntity(id, specAttr('proof'), specPath('proof', name)).then((bound) => {
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
        if (!live) return;
        presentPaths = new Set([...media, ...sat].map((it) => it.path));
        caseMedia = media;
      })
      .catch(() => { if (live) { presentPaths = new Set(); caseMedia = []; } });
    return () => { live = false; };
  });

  /** The case's own media, kept for one question: whether a stated address is already
   *  in the case. Answered by tracing each file back the way a panel's source line is
   *  traced, so a frame cut from a downloaded clip counts as that clip's address. */
  let caseMedia = $state([]);
  const heldAddresses = $derived.by(() => {
    const byPath = new Map(caseMedia.map((one) => [one.path, one]));
    const found = new Set();
    for (const one of caseMedia) for (const url of resolveSourceUrls(one, byPath)) found.add(url);
    return found;
  });

  // Panels whose media was deleted: the image already drawn stays on the canvas,
  // but the panel is flagged so a re-save is not silently building on a ghost.
  const gonePanels = $derived(
    caseState.current ? proof.panels.filter((p) => !presentPaths.has(p.src)) : []
  );
  let tool = $state('select');
  let color = $state(ANNO_COLORS[0]);
  let strokeW = $state(4);
  // Fill opacity for the closed kinds, 0 to 1. Nothing is filled until the
  // analyst asks: a box drawn over the evidence must not hide it by default.
  let fillOpacity = $state(0);
  let iconName = $state(PROOF_ICONS[0].name); // symbol the stamp tool places
  let guide = $state(null); // null | '16:9' | '4:5' — tweet centre-crop overlay
  // The picked annotations. A press replaces the set, shift adds to it, and a
  // marquee dragged over the page takes everything it touches. Panels, overlays
  // and the signature stay single: each is one object, not a family.
  let selectedIds = $state([]);
  let selectedPanelId = $state(null); // free-layout only: panel picked for move/resize
  let selectedPasteId = $state(null); // pasted image picked for move/resize/frame
  let selectedSig = $state(null); // null | 'logo' | 'text' — signature picked for resize
  let picker = $state(false);
  let pickerItems = $state([]);
  let newProofOpen = $state(false);
  // Importing a published proof is a third way into the same tool, beside
  // composing one and opening a saved one. It writes a proof like any other, so
  // the only thing this screen owns is the door — and that door is in the New
  // proof dialog rather than the toolbar, which has no room left for a button.
  let importOpen = $state(false);
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
    // Cleared before the guard, not after it: an undo sets `histBusy` and then
    // returns here, so a timer armed in the 350 ms before it would survive and
    // push the pre-undo document back onto the stack.
    clearTimeout(histTimer);
    if (histBusy) return;
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
    proof.points = editablePoints(spec);
    proof.footerCoords = spec.footerCoords === true;
    proof.footerText = spec.footerText !== false;
    proof.sources = statedSources(spec.sources ?? spec.source ?? null);
    proof.material = normalizeMaterial(spec.material);
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
      loadImage(fileUrl(caseState.current?.id, p.src))
        .then((img) => {
          imgCache.set(p.src, img);
          p.img = img;
        })
        .catch(() => {});
    }
    selectedIds = [];
    selectedPanelId = null;
    selectedPasteId = null;
    selectedSig = null;
    const template = templatesState.proof.find((t) => t.id === proof.templateId);
    appliedTemplate = template
      ? { id: template.id, name: template.name, prevStyle: templateFromProof(proof) }
      : null;
    // Undoing back to the saved document is not an edit. Measured after the
    // restore rather than off the snapshot string, since the values above come
    // back normalised and a raw spec need not match its own normal form.
    dirty = docSnapshot() !== savedSnapshot;
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
  let dragMoved = false; // did the press that is ending turn into a drag?
  let marquee = null; // {start, add, base, node} — rectangle picking over the page
  let marqueeEnded = false; // did the press that is ending draw a marquee?
  let spacePan = false; // hold-space panning (manual, so it wins over shape drags)
  let panDrag = null; // {sx, sy, ox, oy} — space/middle-drag pan in progress
  let gestureSeq = 0; // bumped by every press, so a deferred settle can tell whose
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
    // a deferred rebuild is never left waiting after an interrupted drag, and
    // so a gesture the browser stopped reporting is ended rather than left
    // running against the pointer.
    const closeStranded = () => {
      if (stage) closeStrandedGesture({ transformer, stage, isDragging: () => Konva.isDragging() });
    };
    const beginPointer = () => {
      closeStranded(); // a new press proves the last gesture is over, however it ended
      gestureSeq += 1;
      canvasRenderGate?.beginPointer();
    };
    const settlePointer = () => {
      canvasRenderGate?.endPointer();
      // The pan is the one gesture that cannot wait: it follows the live
      // pointer, so a move arriving before the frame below would slide the view
      // after the button was let go. Ended twice on a normal release, which
      // costs nothing — whichever handler gets there first does it.
      if (panDrag) endPan();
      // A frame later for the rest, so a gesture that ended normally has
      // already closed itself and only a stranded one is left to end. This
      // listener runs in the capture phase, ahead of the handlers that close
      // them.
      const seq = gestureSeq;
      requestAnimationFrame(() => {
        closeStranded();
        // A press that landed inside the frame we waited opened a new gesture:
        // what is in hand now is not what this release left behind, and
        // settling it would commit a stroke still being drawn.
        if (seq === gestureSeq) settleStrandedGesture();
      });
    };
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

  // Picking up a drawing tool puts the document out of reach: nothing on the
  // canvas is hit-tested or handled, so a press that starts inside an existing
  // element draws a new one instead of dragging the old. Drawing finds its
  // surface geometrically (see surfaceAt), never through Konva's hit graph.
  $effect(() => {
    tool; // the tool alone: the document has its own rebuild below
    untrack(() => {
      if (!stage) return;
      syncCanvasListening();
      if (proofHasContent) refreshCanvasUi();
    });
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
      // the plate prints these when asked, and printing them changes its height:
      // both have to reach the rebuild, or the picture lags a line behind
      proof.footerCoords, proof.footerText, proof.points,
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
    selectedIds;
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
    footerLines: footerLines(proof, prefs.coordFormat).length,
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
    proof.points = [blankPoint()];
    proof.sources = null;
    proof.material = [];
    proof.captionSize = CAPTION_SIZE;
    proof.legendSize = LEGEND_SIZE;
    proof.footerSize = FOOTER_SIZE;
    proof.footer = '';
    proof.footerEnabled = true;
    proof.footerCoords = false;
    proof.footerText = true;
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
    savedSnapshot = null;
    proofStarted = false;
    selectedIds = [];
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
  /**
   * Pick an annotation, or add it to the ones already picked.
   *
   * Shift is the additive key everywhere: on the canvas, and on the rows in the
   * side column. Picking an annotation drops the panel, overlay or signature
   * that was picked, since those are transformed on their own terms.
   */
  function pickShape(id, additive = false) {
    if (!additive) selectedIds = [id];
    else if (selectedIds.includes(id)) selectedIds = selectedIds.filter((x) => x !== id);
    else selectedIds = [...selectedIds, id];
    selectedPanelId = null;
    selectedPasteId = null;
    selectedSig = null;
  }

  /**
   * Press and click on one annotation's node.
   *
   * A press on an element that is already part of the family leaves the family
   * alone, so the whole of it can be dragged from any member. Collapsing to the
   * one pressed waits for the click, which only lands if the press did not turn
   * into a drag.
   */
  function bindShapePick(node, s) {
    node.on('pointerdown', (e) => {
      if (tool !== 'select') return;
      e.cancelBubble = true;
      dragMoved = false;
      if (e.evt.shiftKey || !selectedIds.includes(s.id)) pickShape(s.id, e.evt.shiftKey);
    });
    node.on('click tap', (e) => {
      if (tool !== 'select' || dragMoved || e.evt.shiftKey) return;
      if (selectedIds.length > 1) pickShape(s.id);
    });
  }

  function selectSig(which) {
    selectedSig = which;
    selectedIds = [];
    selectedPanelId = null;
    selectedPasteId = null;
  }

  function selectPaste(id) {
    if (tool !== 'select') return;
    selectedPasteId = id;
    selectedIds = [];
    selectedPanelId = null;
    selectedSig = null;
  }

  function selectPanel(id) {
    if (tool !== 'select' || marqueeEnded) return;
    selectedPanelId = id;
    selectedPasteId = null;
    selectedIds = [];
    selectedSig = null;
  }

  /**
   * Picking from the rows in the side column.
   *
   * On the canvas a press with a drawing tool in hand means "draw here", so the
   * pick handlers above refuse it. A row cannot mean anything else, so instead
   * of refusing it takes the hand back to Select — where the pick has handles,
   * answers Delete and can be recoloured. Lighting a row nothing answers to was
   * a selection visible in one column and absent from the other.
   */
  function pickShapeRow(id, additive = false) {
    tool = 'select';
    pickShape(id, additive);
  }

  /** Clicking the lit row again lets go, which is how the thumbnails read. */
  function pickPanelRow(id) {
    tool = 'select';
    marqueeEnded = false;
    selectedPanelId = selectedPanelId === id ? null : id;
    selectedPasteId = null;
    selectedIds = [];
    selectedSig = null;
  }

  function pickPasteRow(id) {
    tool = 'select';
    selectedPasteId = selectedPasteId === id ? null : id;
    selectedPanelId = null;
    selectedIds = [];
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
      const img = await loadImage(fileUrl(caseState.current.id, item.src));
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
    const next = nextPanelRow(proof.panels, index, delta);
    if (next === null) return;
    proof.panels[index].row = next;
    normalizeRows();
    selectedIds = [];
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
    const next = clampPanelScale(cur, delta, PANEL_SCALE_MIN, PANEL_SCALE_MAX);
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
      panel.scale = scaleFromNode(node.scaleX(), panel.natural[1]);
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
    const next = movedBy(proof.panels, index, delta);
    if (!next) return;
    proof.panels = next;
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
    selectedIds = [];
    dirty = true;
    requestAnimationFrame(fit);
  }

  function removePanel(index) {
    const panel = proof.panels[index];
    proof.shapes = proof.shapes.filter((s) => s.panel !== panel.id);
    proof.panels.splice(index, 1);
    normalizeRows();
    selectedIds = [];
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
    return viewCentrePoint(
      { width: containerEl.clientWidth, height: containerEl.clientHeight },
      { x: stage.x(), y: stage.y(), scaleX: stage.scaleX(), scaleY: stage.scaleY() },
    );
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
   * One place decides what Ctrl+V means, and the rule is which copy came last.
   *
   * Two clipboards answer one chord: the system's, which may hold a screenshot from
   * an hour ago, and this composer's, which holds the annotation just copied. Only
   * one of them is visible to this page, so freshness cannot be compared directly —
   * what can be is whether the analyst left. A copy made here without leaving the
   * window is necessarily the more recent of the two, so it wins; going somewhere
   * else and coming back is the only way an outside copy could have happened, and
   * that hands the chord back to the system clipboard. Without this, Ctrl+C on a
   * rectangle followed by Ctrl+V pasted whatever image was in the clipboard.
   */
  function onPaste(e) {
    if (uiState.tool !== 'proof' || isTextTarget(e.target)) return;
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (clipboard && (shapeCopyFresh || !item)) {
      e.preventDefault();
      pasteShape();
    } else if (item) {
      e.preventDefault();
      addPastedImage(item.getAsFile());
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
    selectedIds = [];
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

  /**
   * Who may answer the pointer: only Select, and only when space is not held.
   *
   * Konva fills a shape's hit canvas whether or not the shape has a fill, so an
   * outlined box is hit across its whole inside. Left listening while a drawing
   * tool is active, a stroke started inside an ellipse dragged that ellipse
   * instead — and the drag ate the gesture, so the new element died under the
   * minimum size. Both layers go quiet together: the handles on `uiLayer` sit
   * over the same pixels the analyst is drawing on.
   */
  function syncCanvasListening() {
    const live = tool === 'select' && !spacePan;
    docLayer?.listening(live);
    uiLayer?.listening(live);
  }

  function docPoint() {
    const p = stage.getPointerPosition();
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  }

  /** The rectangle between two document points, however it was dragged. */
  function marqueeBox(a, b) {
    return {
      x: Math.min(a.x, b.x), y: Math.min(a.y, b.y),
      width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y),
    };
  }

  /**
   * The annotations a marquee catches: every one it touches, not only the ones
   * it swallows whole, which is the forgiving rule and the one Slides uses.
   *
   * Measured off the drawn nodes rather than the stored geometry, so a rotated
   * text, a stroke's width and a panel's scale are all already accounted for.
   */
  function shapesTouching(box) {
    const caught = [];
    for (const s of proof.shapes) {
      const node = docLayer.findOne(`#${s.id}`);
      if (!node) continue;
      const r = node.getClientRect({ relativeTo: docLayer });
      const misses = r.x > box.x + box.width || r.x + r.width < box.x
        || r.y > box.y + box.height || r.y + r.height < box.y;
      if (!misses) caught.push(s.id);
    }
    return caught;
  }

  // Annotations are drawn on whatever surface is under the pointer — a panel or
  // a pasted image. Pasted images are in front, so they claim the point first.
  function surfaceAt(doc) {
    return surfaceHitTest(surfacesOf(), doc);
  }

  /** Take hold of the view. The cursor says so, since the tool's own crosshair
   *  would otherwise promise a stroke while the page slides. */
  function startPan() {
    const p = stage.getPointerPosition();
    panDrag = { sx: p.x, sy: p.y, ox: stage.x(), oy: stage.y() };
    if (containerEl) containerEl.style.cursor = 'grabbing';
  }

  function endPan() {
    panDrag = null;
    if (containerEl) containerEl.style.cursor = spacePan ? 'grab' : '';
  }

  function onPointerDown(e) {
    // space-drag / middle-drag pans regardless of the active tool
    if (spacePan || e.evt.button === 1) {
      e.evt.preventDefault();
      startPan();
      return;
    }
    // Only the primary button acts. A right-drag used to draw a whole
    // annotation under the context menu the browser was opening over it, and in
    // Select it cleared the selection and opened a marquee.
    if ((e.evt.button ?? 0) > 0) return;
    if (tool === 'select') {
      dragMoved = false;
      marqueeEnded = false;
      const add = e.evt.shiftKey;
      // Where a drag can mean nothing else, it means picking. On the page around
      // the panels, and across a panel the grid pins in place — an overlay or a
      // free-layout panel is dragged instead, and the room outside the page
      // still pans, which is the gesture that was there before the marquee.
      const onPage = e.target.name() === 'bg';
      const parentId = e.target.getParent()?.id() ?? '';
      const onPinnedPanel = e.target.name() === 'panel-hit'
        && proof.layout !== 'free'
        && proof.panels.some((p) => `pg-${p.id}` === parentId);
      const onEmpty = e.target === stage || onPage;
      stage.draggable(e.target === stage);
      // The rectangle about to be dragged replaces what was picked, so let go of
      // it at the press: handles left standing over a marquee read as a second
      // selection rather than the one being replaced.
      if ((onEmpty || onPinnedPanel) && !add) {
        selectedIds = [];
        selectedPanelId = null;
        selectedPasteId = null;
        selectedSig = null;
      }
      if (onPage || onPinnedPanel) {
        marquee = { start: docPoint(), add, base: [...selectedIds], node: null };
      }
      return;
    }
    stage.draggable(false);
    const hit = surfaceAt(docPoint());
    // Nothing to draw on under the pointer. The room around the page pans in
    // Select, and it is the same room: a drag that cannot mean an annotation
    // means the view, rather than nothing at all.
    if (!hit) {
      startPan();
      return;
    }
    // `panel` here is the surface the annotation binds to: the shape's `panel`
    // field holds a panel id or a pasted image's id.
    const panel = hit.item;
    const group = docLayer.findOne(`#pg-${panel.id}`);
    if (!group) return;
    // Text is placed with a single click and typed on the spot: placing a label
    // and saying what it says are one act, so the editor opens over it rather
    // than leaving the word "Text" on the panel to be found and double-clicked.
    // The tool goes back to Select because the next act is the editing.
    if (tool === 'text') {
      const s = {
        id: newId('s'), panel: panel.id, kind: 'text', color,
        x: hit.nx, y: hit.ny, text: 'Text', fontSize: 28,
      };
      proof.shapes.push(s);
      selectedIds = [s.id];
      tool = 'select';
      dirty = true;
      // A frame later, because the press that placed the label has a default
      // action still to come: the browser moves focus off whatever is focused
      // when a click lands on something that cannot hold it, and an editor
      // opened inside the pointerdown was blurred — and so committed and
      // closed — before the analyst could type into it.
      requestAnimationFrame(() => startTextEdit(s));
      return;
    }
    // A symbol is stamped with one click. Unlike text the tool stays in hand
    // afterwards, because marking six vehicles is one act, not six.
    if (tool === 'icon') {
      const entry = iconByName(iconName);
      if (!entry) return;
      const s = {
        id: newId('s'), panel: panel.id, kind: 'icon', name: entry.name, color,
        x: hit.nx, y: hit.ny, size: iconSizeFor(hit.box.baseScale),
        ...(isSolidIcon(entry.name) ? {} : { strokeWidth: strokeW }),
        ...(fillOpacity > 0 ? { fillOpacity } : {}),
      };
      proof.shapes.push(s);
      selectedIds = [s.id];
      dirty = true;
      return;
    }
    // curve: each click drops a vertex; double-click / Enter finishes
    if (tool === 'curve') {
      // A vertex dropped on another surface ends the curve where it was and
      // opens the next one there. Ignoring the click made the canvas look dead
      // whenever a curve strayed a few pixels past its panel.
      if (pathDraft && pathDraft.panel.id !== panel.id) finishPath(true);
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
    // the draft is drawn with the fill it will be committed with, so the analyst
    // sees what the box hides while dragging it, not after
    const paint = canFill(tool) ? fillPaint(color, fillOpacity) : null;
    let node;
    if (tool === 'rect') {
      node = new Konva.Rect({
        x: hit.nx, y: hit.ny, width: 1, height: 1, cornerRadius: 2, fill: paint, ...common,
      });
    } else if (tool === 'ellipse') {
      node = new Konva.Ellipse({ x: hit.nx, y: hit.ny, radiusX: 1, radiusY: 1, fill: paint, ...common });
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
    if (marquee) {
      dragMoved = true;
      const box = marqueeBox(marquee.start, docPoint());
      if (!marquee.node) {
        marquee.node = new Konva.Rect({
          fill: 'rgba(232, 163, 61, 0.12)', stroke: '#e8a33d',
          strokeWidth: 1 / stage.scaleX(), dash: [4 / stage.scaleX(), 3 / stage.scaleX()],
          listening: false,
        });
        uiLayer.add(marquee.node);
      }
      marquee.node.setAttrs(box);
      uiLayer.batchDraw();
      return;
    }
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

  /**
   * Apply the rectangle dragged over the page, then take it down.
   *
   * The box is read off the node rather than recomputed from the pointer: the
   * node holds what was drawn, which is what the analyst was looking at — and
   * it is still the right answer when the release landed somewhere the canvas
   * never heard about it.
   */
  function applyMarquee() {
    if (!marquee) return;
    const node = marquee.node;
    const box = node
      ? { x: node.x(), y: node.y(), width: node.width(), height: node.height() }
      : null;
    node?.destroy();
    uiLayer.batchDraw();
    const { add, base } = marquee;
    marquee = null;
    // A rectangle nobody dragged is a click on the page, which has already
    // cleared the selection. Below a couple of pixels it is the same thing.
    if (!box || (box.width <= 2 && box.height <= 2)) return;
    // The press that opened this rectangle may have been on a panel, and Konva
    // still calls that a click. Say the rectangle happened, so the panel
    // underneath does not take the selection back.
    marqueeEnded = true;
    const caught = shapesTouching(box);
    selectedIds = add ? [...new Set([...base, ...caught])] : caught;
  }

  /** Fold the draft in hand into an annotation, or drop it for being too small. */
  function commitDrawing() {
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
        strokeWidth: strokeW,
        // only the kinds that can hold one carry the field, and only once asked
        ...(canFill(kind) && fillOpacity > 0 ? { fillOpacity } : {}),
        ...shape,
      };
      proof.shapes.push(s);
      selectedIds = [s.id];
      dirty = true;
    }
  }

  function onPointerUp() {
    if (marquee) {
      applyMarquee();
      return;
    }
    // The window hears the release first and has ended a pan already (see
    // settlePointer). This stands for the release it does not hear.
    if (panDrag) {
      endPan();
      return;
    }
    if (tool === 'select') {
      stage.draggable(false);
      // A tool can change under an unreleased pointer, so Select may be holding
      // someone else's draft. Settle it below rather than returning on it.
      if (!drawing) return;
    }
    commitDrawing();
  }

  /**
   * End a gesture the composer runs itself whose release it never heard.
   *
   * Konva listens for pointerup on its container and nowhere else, so letting go
   * over the side column — a hand's width from the canvas edge, and where the
   * pointer lands whenever a stroke is drawn near the right of a panel — never
   * reached the handlers above. What was left kept following a bare pointer: a
   * draft that stretched with no button held, a marquee nothing destroyed and no
   * selection to show for it. The release happened, so it lands here exactly as
   * it would have there — which is what `closeStrandedGesture` already does for
   * the gestures Konva owns. (The pan is ended earlier, in `settlePointer`.)
   *
   * Runs a frame after the window heard the release, so a gesture that ended on
   * the canvas has already settled itself and there is nothing here to find.
   */
  function settleStrandedGesture() {
    if (!stage) return;
    if (marquee) applyMarquee();
    if (drawing) commitDrawing();
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
      selectedIds = [s.id];
      // The tool stays in hand, like the box, the line and the arrow it belongs
      // beside: three curves in a row is one act, and reaching for `c` between
      // each of them was the only place a shape tool put the pen down.
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
          panel.scale = scaleFromNode(group.scaleX(), panel.natural[1]);
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
    const printed = proof.footerEnabled !== false ? footerLines(proof, prefs.coordFormat) : [];
    if (proof.panels.length && printed.length) {
      const footerSize = proof.footerSize ?? 13;
      // The coordinates the proof prints sit above its credit line, each on the
      // line `footerLines` measured them at — one source for the height and for
      // the drawing, or a proof that grew a line would overflow its own picture.
      const lines = printed;
      const band = footerBand(footerSize);
      lines.forEach((line, i) => {
        docLayer.add(new Konva.Text({
          x: pad,
          y: height - pad - band * (lines.length - i) + Math.round((band - footerSize) / 2),
          width: width - pad * 2,
          text: line,
          align: proof.footerAlign === 'right' ? 'right' : 'left',
          fontSize: footerSize, fill: proof.footerColor || tc.faint,
          fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
        }));
      });
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
    const selectedNodes = selectedIds
      .map((id) => docLayer.findOne(`#${id}`))
      .filter(Boolean);
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const panelNode = !selectedNodes.length && selectedPanelId
      ? docLayer.findOne(`#pg-${selectedPanelId}`)
      : null;
    // Panels are scale-clamped *during* the gesture: letting the transform run
    // free and clamping on release made the panel visibly snap back whenever
    // the drag overshot the 25–250% range (worst at the bounds, where a resize
    // in the blocked direction just reverted). Shapes stay unconstrained.
    // the logo or the @handle, picked for a corner-resize (aspect locked).
    // a pasted image resizes from its corners with its aspect locked, within the
    // same kind of scale bounds a panel has
    const pasteNode = !selectedNodes.length && !panelNode && selectedPasteId
      ? docLayer.findOne(`#pg-${selectedPasteId}`)
      : null;
    const sigNode = !selectedNodes.length && !panelNode && !pasteNode && selectedSig
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
      return impliedScale < PANEL_SCALE_MIN || impliedScale > PANEL_SCALE_MAX ? oldBox : newBox;
    });
    // Handles belong to Select. A drawing tool ignores what is selected, so
    // showing anchors it will not answer would be a promise the canvas breaks;
    // the selection itself is kept, and comes back with the hand.
    const handles = tool === 'select';
    // Several annotations at once get the border and nothing else: dragging any
    // one of them drags the rest (Konva moves every node the transformer holds),
    // while resizing and rotating a family stays out of this first pass.
    transformer.nodes(
      !handles
        ? []
        : selectedNodes.length
          ? selectedNodes
          : panelNode ? [panelNode] : pasteNode ? [pasteNode] : sigNode ? [sigNode] : []
    );
    const selKind = selectedShape?.kind;
    transformer.keepRatio(!!sigNode || !!pasteNode || selKind === 'icon');
    transformer.rotateEnabled(
      selKind === 'text' || selKind === 'rect' || selKind === 'ellipse' || selKind === 'icon'
        || selKind === 'freehand'
    );
    // A symbol gets corners only: the side handles are what would let it be
    // stretched, and a squashed symbol is a different symbol. A freehand stroke
    // is the one kind with neither vertex handles (too many points to show) nor
    // a shape to speak of, so it takes the full set: without them a selected
    // stroke showed a dashed frame and nothing to pull, which reads as a broken
    // selection rather than a stroke that can only be moved.
    transformer.enabledAnchors(
      selKind === 'rect' || selKind === 'ellipse' || selKind === 'freehand'
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
        : selKind === 'text' || selKind === 'icon' || panelNode || pasteNode || sigNode
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : []
    );
    if (handles) {
      drawEndHandles(surfacesOf());
      drawPanelMoveControls(boxes);
    } else {
      endHandles.destroyChildren();
      panelCtrls.destroyChildren();
    }
    drawGuide(width, height); // the tweet crop is a view, not a handle: it stays
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
    } else if (s.kind === 'ellipse' || s.kind === 'text' || s.kind === 'icon') {
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
        const pad = textBoxPad(s.fontSize);
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
      bindShapePick(node, s);
      node.on('dblclick dbltap', (e) => {
        e.cancelBubble = true;
        startTextEdit(s);
      });
      node.on('dragstart', () => {
        dragMoved = true;
        node.getParent()?.moveToTop();
      });
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
    if (s.kind === 'icon') return makeIconNode(s, panelScale);
    const sw = (s.strokeWidth ?? 4) / panelScale;
    const common = {
      id: s.id, stroke: s.color, strokeWidth: sw, rotation: s.rotation ?? 0,
      draggable: true, hitStrokeWidth: Math.max(sw * 3, 14 / panelScale),
    };
    const paint = canFill(s.kind) ? fillPaint(s.color, s.fillOpacity) : null;
    let node;
    if (s.kind === 'rect') {
      node = new Konva.Rect({
        x: s.x, y: s.y, width: s.w, height: s.h, cornerRadius: 2, fill: paint, ...common,
      });
    } else if (s.kind === 'ellipse') {
      node = new Konva.Ellipse({
        x: s.x, y: s.y, radiusX: s.w / 2, radiusY: s.h / 2, fill: paint, ...common,
      });
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
    bindShapePick(node, s);
    node.on('dragstart', () => {
      dragMoved = true;
      node.getParent()?.moveToTop();
    });
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
      } else if (s.kind === 'freehand') {
        // The whole transform goes into the samples — the scale, the turn and
        // the move the anchors implied — and the node goes back to identity.
        // A stroke has no origin to keep a rotation against.
        s.points = pointsWithTransform(s.points, node.getTransform().getMatrix());
        node.position({ x: 0, y: 0 });
        node.rotation(0);
      }
      s.rotation = node.rotation();
      node.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return node;
  }

  /**
   * A stamped symbol.
   *
   * The glyph is drawn in its own 24-unit box and scaled to `size`, so one
   * number governs it and stretching is not expressible. The group sits on the
   * anchor point the shape stores — the pin's tip, everything else's centre —
   * which is what keeps a pin on its pixel while it is resized or turned.
   */
  function makeIconNode(s, panelScale) {
    const entry = iconByName(s.name);
    const size = s.size ?? iconSizeFor(panelScale);
    const origin = iconOrigin(s.name, size);
    const group = new Konva.Group({
      id: s.id, x: s.x, y: s.y, rotation: s.rotation ?? 0, draggable: true,
    });
    // A stroked glyph is mostly holes, so a press has to land on the box rather
    // than on a 2px line. Invisible to the eye, not to the hit canvas.
    group.add(new Konva.Rect({
      x: origin.x, y: origin.y, width: size, height: size, fill: '#000', opacity: 0,
    }));
    const disc = s.fillOpacity ?? 0;
    if (disc > 0) {
      group.add(new Konva.Circle({
        x: origin.x + size / 2, y: origin.y + size / 2, radius: size / 2,
        fill: fillPaint(s.color, disc),
        // The ring stays at full opacity so a sheer disc keeps an edge; without
        // it a badge at 30% has no silhouette left to read against the imagery.
        stroke: s.color, strokeWidth: Math.max(size * 0.035, 0.5), listening: false,
      }));
    }
    if (entry) {
      const k = size / ICON_BOX;
      const ink = glyphInk(s.color, disc);
      group.add(new Konva.Path({
        data: entry.path, x: origin.x, y: origin.y, scaleX: k, scaleY: k, listening: false,
        ...(isSolidIcon(s.name)
          ? { fill: ink, fillRule: 'evenodd' }
          : {
              stroke: ink,
              // the glyph is drawn scaled, so the width is divided back out:
              // a bigger symbol is a bigger drawing, not a fatter outline
              strokeWidth: (s.strokeWidth ?? 4) / panelScale / k,
              lineCap: 'round', lineJoin: 'round',
            }),
      }));
    }
    bindShapePick(group, s);
    group.on('dragstart', () => {
      dragMoved = true;
      group.getParent()?.moveToTop();
    });
    group.on('dragend', () => {
      const { fromBox, toBox } = rebindOnDrop(s, group);
      const p = toBox
        ? remapPanelXY(group.x(), group.y(), fromBox, toBox)
        : { x: group.x(), y: group.y() };
      s.x = p.x;
      s.y = p.y;
      dirty = true;
    });
    group.on('transformend', () => {
      // Uniform by construction: the transformer keeps the ratio and offers
      // corners only, so either axis answers for the new side.
      s.size = Math.max(ICON_SIZE_MIN / panelScale, Math.abs(size * group.scaleX()));
      s.x = group.x();
      s.y = group.y();
      s.rotation = group.rotation();
      group.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return group;
  }

  // ---- inline text editing (placed, or double-clicked on the canvas) ---------
  /**
   * Open the editor over a label.
   *
   * Positioned from the surface's layout box rather than from a Konva node: a
   * label placed a moment ago has no node yet — the document rebuild is held
   * back until the gesture settles — and the editor has to open on the click
   * that placed it rather than a frame later. The box carries the same
   * transform the node would have been read through.
   */
  function startTextEdit(s) {
    const box = surfacesOf().find((x) => x.id === s.panel)?.box;
    if (!box) return;
    // A boxed label insets its glyph by the padding the frame uses, so the
    // editor opens over the words instead of over the corner.
    const inset = s.frame || s.bg ? textBoxPad(s.fontSize) : 0;
    selectedIds = [s.id];
    textEdit = {
      id: s.id,
      value: s.text ?? '',
      left: stage.x() + (box.x + (s.x + inset) * box.scale) * stage.scaleX(),
      top: stage.y() + (box.y + (s.y + inset) * box.scale) * stage.scaleY(),
      size: (s.fontSize ?? 28) * box.scale * stage.scaleX(),
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
  /** Whether that copy is the last one the analyst made without leaving the window.
   *  What lets Ctrl+V tell a shape just copied here from an older screenshot sitting
   *  in the system clipboard (see `onPaste`). */
  let shapeCopyFresh = false;

  function copyShape(id = selectedId) {
    const s = proof.shapes.find((x) => x.id === id);
    if (!s) return;
    clipboard = copyShapeSpec(s);
    shapeCopyFresh = true;
  }

  // The composer only ever hears about its own copies, so losing focus is the one
  // signal that the system clipboard may have moved on since.
  $effect(() => {
    const release = () => (shapeCopyFresh = false);
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  });

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
    selectedIds = [s.id];
    // cascade further pastes so repeated Ctrl+V steps down-right
    clipboard = offsetShape(s, 0);
    dirty = true;
  }

  function duplicateShape(id = selectedId) {
    copyShape(id);
    pasteShape();
  }

  /** Delete every picked annotation, and drop the legend notes left with nothing. */
  function deleteSelected() {
    const going = new Set(selectedIds);
    const gone = proof.shapes.filter((s) => going.has(s.id));
    if (!gone.length) return;
    proof.shapes = proof.shapes.filter((s) => !going.has(s.id));
    for (const s of gone) proof.notes = notesAfterRemoval(proof.notes, proof.shapes, s);
    selectedIds = [];
    dirty = true;
  }

  function deleteShape(id) {
    const gone = proof.shapes.find((s) => s.id === id);
    proof.shapes = proof.shapes.filter((s) => s.id !== id);
    proof.notes = notesAfterRemoval(proof.notes, proof.shapes, gone);
    selectedIds = selectedIds.filter((x) => x !== id);
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

  const KIND_ICON = { rect: 'square', ellipse: 'circle', arrow: 'arrow', line: 'line', curve: 'curve', freehand: 'freehand', text: 'text', icon: 'pin' };
  const KIND_LABEL = { rect: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', curve: 'Curve', freehand: 'Freehand', text: 'Text', icon: 'Symbol' };

  // Colour / stroke / fill live-edit everything in hand and always remember the
  // pick as the default for the next drawn one — the last value you touched
  // stays your working value. "In hand" means Select: with a drawing tool the
  // controls set defaults only, so picking a new colour between two strokes no
  // longer repaints the stroke that came before it (`editableShapes`).
  function setColor(c) {
    if (editableShapes.length) {
      const before = [...new Set(editableShapes.map((s) => s.color))];
      for (const s of editableShapes) s.color = c;
      // A legend note is written against a colour. Carry it over for each colour
      // the recolouring has just emptied, once no shape wears it any more.
      for (const old of before) {
        if (old === c) continue;
        if (canReassignLegendNote(proof.notes, old, c, proof.shapes, null)) {
          proof.notes[c] = proof.notes[old];
          delete proof.notes[old];
        }
      }
      dirty = true;
    }
    color = c;
  }

  function setStroke(w) {
    // Font size is a text-only property, so editing it must not overwrite the
    // stroke-width default used for the next drawn shape.
    if (editableShape?.kind === 'text') {
      editableShape.fontSize = w;
      dirty = true;
      return;
    }
    for (const s of editableShapes) {
      if (s.kind === 'text') continue; // a font size is not a stroke width
      if (s.kind === 'icon' && isSolidIcon(s.name)) continue; // a silhouette has no outline
      s.strokeWidth = w;
      dirty = true;
    }
    strokeW = w;
  }

  /** Fill opacity, 0 (none) to 1. Only the closed kinds take one. */
  function setFill(value) {
    const opacity = Math.min(1, Math.max(0, value));
    for (const s of editableShapes) {
      if (!canFill(s.kind)) continue;
      s.fillOpacity = opacity;
      dirty = true;
    }
    fillOpacity = opacity;
  }

  // Arrow-key nudge of the selected element, in panel-natural pixels.
  const NUDGE = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  function nudgeSelected(dx, dy) {
    if (!editableShapes.length) return;
    for (const s of editableShapes) Object.assign(s, nudgeShape(s, dx, dy));
    dirty = true;
  }

  function onKeydown(e) {
    if (uiState.tool !== 'proof') return;
    if (e.key === 'Escape' && exportMenuOpen) {
      exportMenuOpen = false;
      return;
    }
    // A dialog takes the keyboard with it. A one-letter tool key must not change
    // the tool on the canvas behind it, and its Escape closes the dialog — that
    // is not also a reason to put the pen down underneath.
    if (modalOpen) return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (pathDraft && (e.key === 'Enter' || e.key === 'Escape')) {
      finishPath(e.key === 'Enter');
      return;
    }
    // Escape mid-drag abandons the shape being drawn, and the tool stays in
    // hand: cancelling a stroke is no reason to put the pen down. Without this
    // the draft outlives the keypress and the pointer keeps stretching a shape
    // that nothing can drop.
    if (e.key === 'Escape' && drawing) {
      drawing = discardDraft(drawing);
      docLayer.batchDraw();
      return;
    }
    // clipboard / undo / save chords
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      // Ctrl+V is deliberately absent: the paste event decides between an image
      // in the system clipboard and a copied annotation (see onPaste).
      // Copying and duplicating stay open to a drawing tool: they read the last
      // element rather than changing it, and what they add lands in plain sight.
      if (k === 'c' && selectedId) { e.preventDefault(); copyShape(); }
      else if (k === 'd' && selectedId) { e.preventDefault(); duplicateShape(); }
      else if (k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if (k === 'y') { e.preventDefault(); redo(); }
      else if (k === 's') { e.preventDefault(); save(); }
      return; // don't fall through to the single-letter tool shortcuts
    }
    if (NUDGE[e.key] && editableShapes.length) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 1;
      nudgeSelected(NUDGE[e.key][0] * step, NUDGE[e.key][1] * step);
      return;
    }
    if (e.key === ' ' && !e.repeat) {
      // hold space to pan, whatever the active tool — even over an element
      e.preventDefault();
      spacePan = true;
      syncCanvasListening();
      containerEl.style.cursor = 'grab';
      return;
    }
    // Deleting is a Select act like the others: with a drawing tool in hand the
    // selection is out of reach, and a key must not erase what is not shown.
    const erase = (e.key === 'Delete' || e.key === 'Backspace') && tool === 'select';
    if (erase && editableShapes.length) {
      deleteSelected();
    } else if (erase && selectedPanelId) {
      const idx = proof.panels.findIndex((p) => p.id === selectedPanelId);
      if (idx >= 0) removePanel(idx);
    } else if (erase && selectedPasteId) {
      removePaste(proof.pastes.findIndex((p) => p.id === selectedPasteId));
    } else if (e.key === 'Escape') {
      // Escape unwinds one level per press: the draft in hand first (above),
      // then what is picked, and only with nothing left to drop does it put the
      // pen down. One key, one meaning: drop the most local thing still
      // standing. Before this it kept the pen while cancelling a stroke and laid
      // it down when there was no stroke to cancel, so which of the two opposite
      // things it meant turned on being three pixels from where a drag started.
      if (visiblePick) {
        selectedIds = [];
        selectedPanelId = null;
        selectedPasteId = null;
        selectedSig = null;
      } else {
        tool = 'select';
      }
    } else if (e.key === 'v') tool = 'select';
    else if (e.key === 'r') tool = 'rect';
    else if (e.key === 'e') tool = 'ellipse';
    else if (e.key === 'a') tool = 'arrow';
    else if (e.key === 'l') tool = 'line';
    else if (e.key === 'c') tool = 'curve';
    else if (e.key === 'd') tool = 'freehand';
    else if (e.key === 't') tool = 'text';
    else if (e.key === 's') tool = 'icon';
    else if (e.key === 'f') fit();
  }

  function onKeyup(e) {
    if (e.key === ' ' && spacePan) {
      spacePan = false;
      panDrag = null;
      syncCanvasListening();
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

  // Copy the saved PNG out to the proofs export folder — the same picture, in
  // the place finished work is filed. Unsaved pixels are saved first, so what
  // lands there is never a proof ago.
  let exporting = $state(false);
  let exportDir = $state('');
  let exportPicker = $state(false);
  let exportAfterPick = $state(false);
  let exportMenuOpen = $state(false);
  async function exportProof() {
    if (!proofHasContent || exporting || saving) return;
    exporting = true;
    try {
      if (dirty || !savedName) await save();
      // A failed save leaves the proof dirty; a title collision opens the
      // overwrite prompt without binding a name. In either case there is no
      // confirmed PNG to copy yet.
      if (dirty || !savedName) return;
      const cid = caseState.current.id;
      const result = await api.post(`/api/cases/${cid}/proofs/${savedName}/export`);
      exportDir = result.folder;
      toast(`${result.file} written to ${destinationLabel(result.folder)}`, 'ok', 5200, {
        label: 'Show',
        onClick: () =>
          api
            .post(`/api/cases/${cid}/proofs/export/reveal`)
            .catch((error) => toast(error.message, 'warn')),
      });
    } catch (e) {
      toast(`Export failed: ${e.message}`, 'danger', 6000);
    } finally {
      exporting = false;
    }
  }

  async function toggleExportMenu() {
    exportMenuOpen = !exportMenuOpen;
    if (!exportMenuOpen) return;
    try {
      exportDir = (await readDestinations()).proofs;
    } catch {
      // The remembered label can stay on its default when Settings is unavailable.
    }
  }

  async function openExportPicker() {
    exportMenuOpen = false;
    exportAfterPick = true;
    try {
      exportDir = (await readDestinations()).proofs;
    } catch {
      // The picker still has its case-folder default if Settings cannot load.
    }
    exportPicker = true;
  }

  async function useExportFolder(path) {
    exportDir = path;
    if (!exportAfterPick) return;
    exportAfterPick = false;
    await exportProof();
  }

  async function exportProofPng() {
    exportMenuOpen = false;
    await exportProof();
  }

  async function revealProofExports() {
    exportMenuOpen = false;
    const cid = caseState.current?.id;
    if (!cid) return;
    try {
      await api.post(`/api/cases/${cid}/proofs/export/reveal`);
    } catch (error) {
      toast(error.message, 'warn');
    }
  }

  // Every proof already saved in this case, read off the filed entities: the
  // slugs (filename without `proofs/.meta/…​.json`) to catch a filename collision, and
  // the names so a fresh proof can take one that reads apart from them.
  const savedProofNames = () => savedSlugs(proofEntities, 'proof');
  const savedProofTitles = () => savedTitles(proofEntities, 'proof');

  // Default name for a fresh proof, numbered past those already in the case so
  // the top-of-screen name reads apart ("Proof 2"). Called on reset.
  const freshTitle = () => nextName('proof', savedProofTitles());

  let overwritePrompt = $state(null); // { slug, andPost } when a save hits a named proof
  // { name, lat, lon } — the point a save carried, where the setting says to ask
  // first. Only ever set for a point the case does not already hold.
  let placeOffer = $state(null);
  let placeSaving = $state(false);
  // [{ id, label }] — points this save moved the proof off that nothing else in
  // the case holds. Asked about after the question above, never beside it.
  let orphanOffer = $state(null);
  let orphanDeleting = $state(false);

  /** Say yes to the points: they are filed exactly as the automatic path files
   *  them, and from the spec rather than from what this tab still holds. */
  async function acceptPlaceOffer() {
    if (!placeOffer || placeSaving) return;
    placeSaving = true;
    const offer = placeOffer;
    try {
      const filed = await api.post(
        `/api/cases/${caseState.current.id}/proofs/${encodeURIComponent(offer.name)}/place`,
      );
      placeOffer = null;
      await reloadCase();
      toast(placedLabel(filed), 'ok', 2600);
    } catch (e) {
      toast(`Could not save the point: ${e.message}`, 'danger', 6000);
    } finally {
      placeSaving = false;
    }
  }

  /** The points the question is about, one per line, named when the analyst
   *  named them — the map is where they will be read, so it names coordinates
   *  rather than the file. */
  function offeredPoints(points) {
    return points
      .map((one) => {
        const where = formatCoords({ lat: one.lat, lon: one.lon }, prefs.coordFormat);
        return one.label ? `${one.label} — ${where}` : where;
      })
      .join('\n') + '\n\nnot saved in this case yet.';
  }

  /** What a save says about the places it wrote. One is named; several are counted,
   *  because a toast listing five labels is a paragraph nobody reads. */
  function placedLabel(filed) {
    const places = filed ?? [];
    if (places.length === 1) return `Saved the point as a place: ${places[0].label}`;
    return `Saved ${places.length} points as places`;
  }

  /** Say yes to dropping the point the proof moved off. Deleted like any entity,
   *  so it lands in the trash and comes back from there. */
  async function deleteOrphanPlaces() {
    if (!orphanOffer || orphanDeleting) return;
    orphanDeleting = true;
    const going = orphanOffer;
    try {
      for (const place of going) {
        await api.del(`/api/cases/${caseState.current.id}/entities/${place.id}`);
      }
      orphanOffer = null;
      await reloadCase();
      toast(
        going.length === 1 ? `Deleted the old place: ${going[0].label}` : `Deleted ${going.length} old places`,
        'ok',
        2600
      );
    } catch (e) {
      toast(`Could not delete the old place: ${e.message}`, 'danger', 6000);
    } finally {
      orphanDeleting = false;
    }
  }

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
      proof.title = result.title;
      dirty = false;
      savedSnapshot = docSnapshot();
      await reloadCase();
      toast(`Proof saved: ${result.png}`, 'ok');
      // The points this proof carries. Filed already, or a question — the server
      // answers with nothing at all when the case already holds them, so
      // re-saving never asks twice.
      if (result.place?.filed?.length) toast(placedLabel(result.place.filed), 'ok', 2600);
      if (result.place?.asking?.length) {
        placeOffer = { name: result.name, points: result.place.asking };
      }
      // Corrected coordinates take the old point back. The place stays on the map
      // until the analyst says otherwise, so it is a question, not a cleanup.
      orphanOffer = result.orphans?.length ? result.orphans : null;
      if (andPost) {
        uiState.postProof = {
          title: result.title,
          // every point, one per line: the post cites the first and carries the rest
          coordsText: coordsPostLines(proofCoordsLines(proof, prefs.coordFormat)).join('\n'),
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
      const caseId = caseState.current.id;
      const result = await api.del(`/api/cases/${caseId}/proofs/${entry.name}`);
      await Promise.all([openProofList(), reloadCase()]);
      deletedToast(caseId, result, entry.title);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  // Bumped by every open, so panels still streaming in for a proof the analyst
  // has moved on from stop writing into the document that replaced it. The open
  // list stays up while a proof loads, so clicking a second one is one gesture
  // away — and the merged result overwrote the second proof on Save.
  let openRun = 0;

  async function openProof(entry) {
    const run = ++openRun;
    const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${entry.name}`);
    if (run !== openRun) return;
    const style = normalizeProofStyle(spec);
    resetDoc();
    proofStarted = true;
    // Bind the opened proof's name up front, before the panel images load: they
    // stream in one by one and enable the Save button as they arrive, so a Save
    // during the load has to write back over this proof, not file a new one.
    savedName = entry.name;
    proof.title = spec.title;
    proof.points = editablePoints(spec);
    proof.footerCoords = spec.footerCoords === true;
    proof.footerText = spec.footerText !== false;
    proof.sources = statedSources(spec.sources ?? spec.source ?? null);
    proof.material = normalizeMaterial(spec.material);
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
        const img = await loadImage(fileUrl(caseState.current.id, p.src));
        if (run !== openRun) return;
        imgCache.set(p.src, img);
        proof.panels.push({ ...p, id: p.id ?? newId('p'), row: p.row ?? 0, img });
      } catch {
        if (run !== openRun) return;
        toast(`Missing panel image: ${p.src}`, 'warn');
      }
    }
    // Pasted images come from the proof's own assets folder — nothing in the
    // case points at them, so they are read by the name the spec carries.
    for (const p of spec.pastes ?? []) {
      try {
        const img = await loadImage(
          fileUrl(caseState.current.id, `proofs/${entry.name}.assets/${p.asset}`)
        );
        if (run !== openRun) return;
        pasteAssets.set(p.asset, { img, data: null, pending: false });
        proof.pastes.push({ ...p, id: p.id ?? newId('x'), img });
      } catch {
        if (run !== openRun) return;
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
    savedSnapshot = docSnapshot();
    anchorHistory();
    requestAnimationFrame(fit);
  }

  const selectedShapes = $derived(proof.shapes.filter((s) => selectedIds.includes(s.id)));
  // The one annotation, when exactly one is picked. Everything keyed to a single
  // kind reads this: the transformer's anchors, the endpoint handles, the size
  // slider's range. A family of five has no kind of its own.
  const selectedId = $derived(selectedIds.length === 1 ? selectedIds[0] : null);
  const selectedShape = $derived(selectedShapes.length === 1 ? selectedShapes[0] : null);
  // The selection as the controls and the keyboard see it: only Select edits
  // what is already drawn. A drawing tool leaves the selection standing but out
  // of reach, so nothing is silently recoloured, moved or deleted behind a
  // gesture meant for the next element.
  const editableShapes = $derived(tool === 'select' ? selectedShapes : []);
  // Whether a pick is showing at all: the canvas handles and the lit rows in the
  // side column answer to this together, so the two columns never disagree about
  // what is selected.
  const selectionLive = $derived(tool === 'select');
  // What the analyst can see picked. A selection held for the hand's return is
  // not something Escape has to clear before it can put the pen down.
  const visiblePick = $derived(
    selectionLive
      && (selectedIds.length > 0 || !!selectedPanelId || !!selectedPasteId || !!selectedSig)
  );
  // Every dialog that can sit over the composer. A modal owns the keyboard while
  // it is up, and this is what keeps the canvas shortcuts out from under it.
  const modalOpen = $derived(
    picker || newProofOpen || importOpen || openList !== null || discardConfirm
      || replaceWithNewConfirm || exportPicker || overwritePrompt !== null
      || placeOffer !== null || orphanOffer !== null || deleteEntry !== null
      || sourcePick !== null
  );
  const editableShape = $derived(editableShapes.length === 1 ? editableShapes[0] : null);
  const fillableSelection = $derived(editableShapes.some((s) => canFill(s.kind)));
  // A solid symbol is a silhouette: there is no outline to widen, so the
  // control stays away rather than sitting there doing nothing.
  const solidIconOnly = $derived(
    editableShapes.length
      ? editableShapes.every((s) => s.kind === 'icon' && isSolidIcon(s.name))
      : tool === 'icon' && isSolidIcon(iconName),
  );
  const activeColor = $derived(editableShape?.color ?? color);
  const activeFill = $derived(
    canFill(editableShape?.kind) ? (editableShape.fillOpacity ?? 0) : fillOpacity
  );
  const featureList = $derived(orderedFeatureColors(proof.shapes, proof.legendOrder));

  // Swap a legend entry with its neighbour, persisting the whole resulting
  // ---- the points the proof concludes on -----------------------------------
  //
  // One row per point, the first one the conclusion. A proof with a single point
  // is the common case and looks exactly as it always did: one field, no cross,
  // no arrow, nothing to move.

  function blankPoint() {
    return { coords: '', label: '', pov: false };
  }

  /** The spec's points as editable rows, always at least one. */
  function editablePoints(spec) {
    const stated = specPoints(spec).map((one) => ({ ...one }));
    return stated.length ? stated : [blankPoint()];
  }

  /** Add a row. The first one is materialised from the panels first: an empty
   *  field means "whatever the imagery says", and that answer has to become the
   *  conclusion in writing before a second point can sit under it. */
  function addPoint() {
    if (proof.points.length >= MAX_POINTS) return;
    if (!proof.points[0].coords.trim()) proof.points[0].coords = displayedCoords;
    proof.points = [...proof.points, blankPoint()];
    dirty = true;
  }

  function removePoint(i) {
    proof.points = proof.points.filter((_, at) => at !== i);
    if (!proof.points.length) proof.points = [blankPoint()];
    dirty = true;
  }

  /** Move a row up. This is how the conclusion is chosen — POV never reorders
   *  anything, or checking it would take a coordinate out of a tweet in silence. */
  function raisePoint(i) {
    if (i <= 0) return;
    const order = [...proof.points];
    [order[i - 1], order[i]] = [order[i], order[i - 1]];
    proof.points = order;
    dirty = true;
  }

  /** A camera stood in one place, so lighting one point puts the others out. */
  function togglePov(i) {
    const on = !proof.points[i].pov;
    proof.points = proof.points.map((one, at) => ({ ...one, pov: on && at === i }));
    dirty = true;
  }

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
    proof.points[0]?.coords.trim() || formatCoords(autoCoords(proof.panels), prefs.coordFormat)
  );
  const displayedSource = $derived(proofSource(proof));
  const autoSources = $derived(autoSourceUrls(proof.panels));
  /** What the Source boxes show: the analyst's own list once there is one — **empty
   *  included**, since emptying every box is them saying the proof has no public source
   *  — else the addresses traced from the panels, else one box to type the first into.
   *  There is always a box: a field with no box is a field nobody can use. */
  const sourceRows = $derived.by(() => {
    const rows = proof.sources ?? autoSources;
    return rows.length ? rows : [''];
  });

  /** Editing a traced row is what turns the whole list into the proof's own: the traced
   *  ones come along, so stating a fourth address never means retyping three the panels
   *  already knew. */
  function editSource(at, value) {
    proof.sources = sourceRows.map((row, i) => (i === at ? value : row));
    dirty = true;
  }

  function addSource() {
    proof.sources = [...sourceRows, ''];
    dirty = true;
  }

  //: One http(s) address and nothing else, which is what one box holds.
  const ONE_ADDRESS = /^https?:\/\/\S+$/i;

  /** An address the proof states that the case holds nothing from.
   *
   *  Only the ones stated here: an address traced *off* a panel is, by construction,
   *  already in the case, so offering to fetch it would be offering to fetch a file
   *  sitting two rows above. */
  function missingSource(url) {
    const address = url.trim();
    return (
      proof.sources !== null && ONE_ADDRESS.test(address) && !heldAddresses.has(address)
    );
  }

  /** Bring what a stated address holds into the case, and let the proof rest on it.
   *
   *  A geolocation read from a thread rests on files the case has never seen — the clip
   *  under the photos, the second angle — and until now the only way in was to leave the
   *  composer, download them in Media and come back. What lands is filed as ordinary
   *  media and recorded as this proof's `material`, which is what puts it in the chain
   *  and, through the chain, on the point.
   */
  let sourceJob = $state(null); // { url, progress } while one address is being fetched
  let sourcePick = $state(null); // { url, items } when the address holds several files

  async function fetchSource(url, indexes = null) {
    const c = caseState.current;
    const address = url.trim();
    if (!c || !address || sourceJob) return;
    sourceJob = { url: address, progress: {} };
    try {
      // Everything it holds, one call each: the analyst named this address as material,
      // so what hangs off it is material — the same answer the sheet road gives.
      const landed = [];
      for (const index of indexes ?? [null]) {
        const path = await runSourceJob(c.id, address, index);
        if (path === 'multi') return; // the picker took over; nothing downloaded yet
        if (path) landed.push(path);
      }
      await refreshCaseMedia(c.id);
      toast(
        landed.length > 1
          ? `${landed.length} files added to the case`
          : 'Added to the case',
        'ok',
        1800,
      );
    } catch (e) {
      toast(`${address} could not be downloaded: ${e.message}`, 'danger', 6000);
    } finally {
      sourceJob = null;
    }
  }

  async function runSourceJob(caseId, url, index) {
    const { job_id } = await api.post(`/api/cases/${caseId}/media/download`, {
      url, index, title: null, use_cookies: false,
    });
    for (;;) {
      const status = await api.get(`/api/jobs/${job_id}`);
      sourceJob = { url, progress: status.progress ?? {} };
      if (status.status === 'running') {
        await new Promise((resolve) => setTimeout(resolve, 700));
        continue;
      }
      if (status.status !== 'done') throw new Error(status.error || 'the download failed');
      const result = status.result ?? {};
      if (result.multi) {
        // Ticked by default: the address was stated as material, so what it carries is.
        // Except what the extractor cannot vouch for — past the first attachment it
        // cannot say whether a clip is the post's own or the one it quotes.
        sourcePick = {
          url,
          items: (result.items ?? []).map((one) => ({ ...one, picked: one.own !== false })),
        };
        return 'multi';
      }
      if (result.needs_auth) {
        throw new Error('this link asks for a login. Download it from Media, then come back');
      }
      const path = result.item?.path ?? result.entity?.attrs?.path;
      if (path) {
        // Paired with the address that brought it, so taking that source off the proof
        // takes this file out of its chain too.
        proof.material = [
          ...proof.material.filter((one) => one.path !== path),
          { path, url },
        ];
        dirty = true;
      }
      return path ?? null;
    }
  }

  /** What a file landing in the case has to update.
   *
   *  The composer's own two readings, and the app's: a media downloaded here is a case
   *  entity like any other, so Board, Graph and the catalog have to hear about it. They
   *  read the case handed round in state, and without this the file was on disk and
   *  invisible everywhere else until a reload.
   */
  async function refreshCaseMedia(caseId) {
    caseMedia = await api.get(`/api/cases/${caseId}/media`).catch(() => caseMedia);
    presentPaths = new Set([...caseMedia.map((one) => one.path), ...presentPaths]);
    await reloadCase();
  }

  function takeSourcePick() {
    const picked = sourcePick.items.filter((one) => one.picked).map((one) => one.index);
    const { url } = sourcePick;
    sourcePick = null;
    if (picked.length) fetchSource(url, picked);
  }

  function dropSource(at) {
    proof.sources = sourceRows.filter((_, i) => i !== at);
    dirty = true;
  }

  /** Hand the list back to the panels. The only way back from an emptied one, which is
   *  why the arrow shows the moment the proof states anything of its own. */
  function resetSources() {
    proof.sources = null;
    dirty = true;
  }
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
    <div class="export-split">
      <button
        class="btn btn-sm export-main"
        onclick={copyPng}
        disabled={!proofHasContent || copying}
        title="Copy the proof PNG"
      >
        <Icon name="copy" size={14} /> {copying ? 'Copying…' : 'Copy'}
      </button>
      <button
        class="btn btn-sm export-toggle"
        onclick={toggleExportMenu}
        aria-label="More export options"
        aria-haspopup="menu"
        aria-expanded={exportMenuOpen}
      >
        <Icon name="chevronDown" size={13} />
      </button>
      {#if exportMenuOpen}
        <button class="export-backdrop" onclick={() => (exportMenuOpen = false)} aria-label="Close export menu"></button>
        <div class="export-menu card" role="menu">
          <button class="export-option" role="menuitem" onclick={exportProofPng} disabled={!proofHasContent || exporting || saving}>
            <Icon name="download" size={14} />
            <span>{exporting ? 'Exporting…' : 'Export PNG'}</span>
          </button>
          <button class="export-option" role="menuitem" onclick={openExportPicker} disabled={!proofHasContent || exporting || saving}>
            <Icon name="folder" size={14} />
            <span>Export to another folder…</span>
          </button>
          <button class="export-option" role="menuitem" onclick={revealProofExports} disabled={!caseState.current}>
            <Icon name="folderOpen" size={14} />
            <span>Show export folder</span>
          </button>
          <div class="export-destination" title={exportDir || "The case's exports folder"}>
            Destination: {destinationLabel(exportDir)}
          </div>
        </div>
      {/if}
    </div>
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
      {activeFill}
      selectedShape={editableShape}
      selectedCount={editableShapes.length}
      {fillableSelection}
      showStroke={!solidIconOnly}
      {iconName}
      setIconName={(name) => { iconName = name; tool = 'icon'; }}
      {strokeW}
      {setColor}
      {setStroke}
      {setFill}
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
            {#if proof.points.some((one) => one.coords.trim())}
              <button class="meta-reset" title="Reset to the coordinates from the imagery" onclick={() => { proof.points = [blankPoint()]; dirty = true; }}>
                <Icon name="reset" size={12} />
              </button>
            {/if}
            {#if proof.points.length < MAX_POINTS}
              <button
                class="meta-add"
                class:alone={!proof.points.some((one) => one.coords.trim())}
                title="Add a point"
                onclick={addPoint}
              >
                <Icon name="plus" size={12} />
              </button>
            {/if}
          </div>
          <!-- One row per point the proof concludes on, the first one the
               conclusion. A single-point proof shows the field it always did. -->
          {#each proof.points as point, i (i)}
            <div class="point-row">
              <input
                class="input meta-input"
                class:warn={i === 0 && !displayedCoords}
                placeholder="lat, lon"
                value={i === 0 ? displayedCoords : point.coords}
                oninput={(e) => { proof.points[i].coords = e.target.value; dirty = true; }}
              />
              <input
                class="input point-label"
                placeholder="label"
                value={point.label}
                oninput={(e) => { proof.points[i].label = e.target.value; dirty = true; }}
              />
              <!-- What the point means. Nothing in the composition can answer it:
                   a rooftop shot is recorded somewhere it never shows, and a
                   distant skyline is shown from kilometres away. -->
              <button
                class="point-pov"
                class:on={point.pov}
                title="Point of view"
                onclick={() => togglePov(i)}
              >
                <Icon name="eye" size={13} />
              </button>
              {#if i > 0}
                <button class="point-move" title="Make this the proof's conclusion" onclick={() => raisePoint(i)}>
                  <Icon name="chevronUp" size={13} />
                </button>
                <button class="point-drop" title="Remove this point" onclick={() => removePoint(i)}>
                  <Icon name="x" size={13} />
                </button>
              {/if}
            </div>
          {/each}
          {#if proof.points.length > 1}
            <div class="point-hint">Order decides the conclusion.</div>
          {/if}
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
            {#if proof.sources !== null}
              <button class="meta-reset" title="Reset to the sources traced from the media" onclick={resetSources}>
                <Icon name="reset" size={12} />
              </button>
            {/if}
            <button
              class="meta-add"
              class:alone={proof.sources === null}
              title="Add a source"
              onclick={addSource}
            >
              <Icon name="plus" size={12} />
            </button>
          </div>
          <!-- One row per address. A proof read from a thread rests on the post that
               published it, the photos beside it and the clip under those, and each of
               them is a link of its own. -->
          {#each sourceRows as row, at (at)}
            <div class="meta-row">
              <input
                class="input meta-input"
                class:warn={!displayedSource}
                placeholder="https://…"
                value={row}
                oninput={(e) => editSource(at, e.target.value)}
              />
              {#if missingSource(row)}
                <!-- The case holds nothing from this address. Offering to fetch it here
                     is the difference between a proof that names its material and one
                     that holds it. -->
                <button
                  class="meta-fetch"
                  title="The case has nothing from this address. Download it"
                  disabled={!!sourceJob}
                  onclick={() => fetchSource(row)}
                >
                  <Icon name={sourceJob?.url === row.trim() ? 'clock' : 'download'} size={12} />
                </button>
              {/if}
              {#if sourceRows.length > 1}
                <button class="meta-drop" title="Remove this source" onclick={() => dropSource(at)}>
                  <Icon name="x" size={12} />
                </button>
              {/if}
            </div>
          {/each}
        </div>

        <ProofLayersPanel
          {proof}
          {collapsed}
          {gonePanels}
          {selectedPanelId}
          {selectedPasteId}
          {selectedIds}
          {selectionLive}
          selectShape={pickShapeRow}
          selectPanelRow={pickPanelRow}
          selectPasteRow={pickPasteRow}
          {activeColor}
          caseId={caseState.current?.id}
          scaleMin={PANEL_SCALE_MIN}
          scaleMax={PANEL_SCALE_MAX}
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
              <!-- The footer lines that change the picture's height, so they
                   wait to be asked for. -->
              <label class="sig-check">
                <input
                  type="checkbox"
                  checked={proof.footerCoords === true}
                  onchange={(e) => { proof.footerCoords = e.currentTarget.checked; dirty = true; }}
                />
                <span>Show coordinates</span>
              </label>
              <label class="sig-check">
                <input
                  type="checkbox"
                  checked={proof.footerText !== false}
                  onchange={(e) => { proof.footerText = e.currentTarget.checked; dirty = true; }}
                />
                <span>Show text</span>
              </label>
              {#if proof.footerText !== false}
                <label class="adv-label" for="footer-text">Footer text</label>
                <textarea
                  id="footer-text"
                  class="input footer-input"
                  rows="2"
                  placeholder={attributionLine(proof.panels)}
                  bind:value={proof.footer}
                  oninput={() => (dirty = true)}
                ></textarea>
              {/if}
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
              <div class="adv-hint">Add a logo in Settings → Publishing to sign your proofs.</div>
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
              <div class="adv-hint">Add your account handle in Settings → Publishing to use it on proofs.</div>
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
    startImport={() => { newProofOpen = false; importOpen = true; }}
    close={() => (newProofOpen = false)}
  />
{/if}

{#if importOpen && caseState.current}
  <ImportProofDialog
    caseId={caseState.current.id}
    onclose={() => (importOpen = false)}
    oncreated={async (created) => {
      await reloadCase();
      openProof({ name: created.proof.name });
    }}
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

{#if exportPicker}
  <ExportFolderPicker
    kind="proofs"
    current={exportDir}
    confirmLabel="Export here"
    onclose={() => {
      exportPicker = false;
      exportAfterPick = false;
    }}
    onchosen={useExportFolder}
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

<!-- The point this proof concludes on, offered once. The map is where it will be
     read, so the question names the coordinates rather than the file. -->
{#if placeOffer}
  <ConfirmDialog
    title={placeOffer.points.length === 1 ? 'Save this point as a place?' : 'Save these points as places?'}
    message={offeredPoints(placeOffer.points)}
    detail={placeOffer.points.some((one) => one.pov)
      ? 'They join the map, and the footage this proof composes will say it was recorded at the marked one.'
      : 'They join the map, and this proof and the files it composes will say they show them.'}
    confirmLabel={placeOffer.points.length === 1 ? 'Save the point' : 'Save the points'}
    tone="default"
    icon="pin"
    busy={placeSaving}
    onconfirm={acceptPlaceOffer}
    oncancel={() => (placeOffer = null)}
  />
<!-- The point the proof moved off, once the question above is answered: one save
     can raise both, and two dialogs at once is a save nobody can read. -->
{:else if orphanOffer}
  <ConfirmDialog
    title={orphanOffer.length === 1 ? 'Delete the old place?' : 'Delete the old places?'}
    message={orphanOffer.length === 1
      ? `This proof no longer points at “${orphanOffer[0].label}”.`
      : `This proof no longer points at ${orphanOffer.length} saved places.`}
    detail="Nothing else in the case points there."
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    icon="trash"
    busy={orphanDeleting}
    onconfirm={deleteOrphanPlaces}
    oncancel={() => (orphanOffer = null)}
  />
{/if}

{#if deleteEntry}
  <ConfirmDialog
    title="Delete this proof?"
    message={`“${deleteEntry.title}” will be removed from the case.`}
    detail="Moves the PNG and editable proof to the case trash."
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
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
                  <img src={fileUrl(caseState.current.id, item.thumb)} alt="" loading="lazy" decoding="async" />
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

<!-- A stated address holding several files. Ticked by default: it was named as the
     proof's material, so what hangs off it is material. -->
{#if sourcePick}
  <Modal title="What to bring in" onclose={() => (sourcePick = null)} width="520px">
    <p class="picker-hint">
      This address has {sourcePick.items.length} attachments. Ticked ones join the case
      and the proof rests on them.
      {#if sourcePick.items.some((one) => one.own === false)}
        The video extractor also reports what a post quotes, so only the first is ticked.
      {/if}
    </p>
    <ul class="src-pick">
      {#each sourcePick.items as item (item.index)}
        <li>
          <label class="src-pick-row">
            <input type="checkbox" bind:checked={item.picked} />
            <span class="src-pick-title">{item.title}</span>
            <span class="badge">{item.kind}</span>
          </label>
        </li>
      {/each}
    </ul>
    <div class="picker-actions">
      <button class="btn btn-sm" onclick={() => (sourcePick = null)}>Cancel</button>
      <button
        class="btn btn-primary btn-sm"
        disabled={!sourcePick.items.some((one) => one.picked)}
        onclick={takeSourcePick}
      >Bring them in</button>
    </div>
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
                    <img src={fileUrl(caseState.current.id, entry.thumb ?? entry.png)} alt="" loading="lazy" decoding="async" />
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
  .export-split {
    position: relative;
    display: flex;
    align-items: stretch;
  }
  .export-main {
    border-radius: var(--r-sm) 0 0 var(--r-sm);
  }
  .export-toggle {
    min-width: 27px;
    margin-left: -1px;
    padding-inline: 5px;
    border-radius: 0 var(--r-sm) var(--r-sm) 0;
  }
  .export-backdrop {
    position: fixed;
    inset: 0;
    z-index: 90;
    cursor: default;
  }
  .export-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    z-index: 100;
    min-width: 230px;
    padding: 5px;
    box-shadow: var(--shadow-2);
  }
  .export-option {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 9px;
    border-radius: var(--r-sm);
    color: var(--text-1);
    font-size: var(--fs-sm);
    text-align: left;
  }
  .export-option:hover:not(:disabled) {
    background: var(--bg-2);
  }
  .export-option:disabled {
    color: var(--text-3);
  }
  .export-destination {
    margin-top: 4px;
    padding: 6px 9px 3px;
    border-top: 1px solid var(--border);
    overflow: hidden;
    color: var(--text-3);
    font-size: var(--fs-xs);
    text-overflow: ellipsis;
    white-space: nowrap;
  }
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
  .meta-add {
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: var(--r-sm);
  }
  .meta-add.alone { margin-left: auto; } /* no reset button to sit beside */
  .meta-add:hover { color: var(--text-1); background: var(--bg-2); }
  .meta-row { display: flex; align-items: center; gap: 4px; }
  .meta-row + .meta-row { margin-top: 4px; }
  .meta-row .meta-input { flex: 1; min-width: 0; }
  .meta-drop {
    display: inline-flex;
    color: var(--text-3);
    padding: 2px;
    border-radius: var(--r-sm);
  }
  .meta-drop:hover { color: var(--danger, #e05c5c); background: var(--bg-2); }
  .meta-fetch {
    display: inline-flex;
    color: var(--warn, #e8a33d);
    padding: 2px;
    border-radius: var(--r-sm);
  }
  .meta-fetch:hover:not(:disabled) { color: var(--text-1); background: var(--bg-2); }
  .meta-fetch:disabled { opacity: 0.5; }
  .src-pick { list-style: none; margin: 10px 0; padding: 0; display: grid; gap: 4px; }
  .src-pick-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    cursor: pointer;
  }
  .src-pick-row:hover { background: var(--bg-2); }
  .src-pick-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
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
  /* One point per row. A proof with a single point shows a coordinate field, a
     label and the marker — no cross, no arrow, nothing to move. */
  .point-row { display: flex; align-items: center; gap: 4px; }
  .point-row + .point-row { margin-top: 4px; }
  .point-row .meta-input { flex: 1; min-width: 0; }
  .point-label { width: 84px; flex: none; font-size: var(--fs-xs); padding: 5px 8px; }
  .point-pov, .point-move, .point-drop {
    display: inline-flex;
    color: var(--text-3);
    padding: 2px;
    border-radius: var(--r-sm);
  }
  .point-pov:hover, .point-move:hover { color: var(--text-1); background: var(--bg-2); }
  .point-pov.on { color: var(--accent, #6ea8fe); background: var(--bg-2); }
  .point-drop:hover { color: var(--danger, #e05c5c); background: var(--bg-2); }
  .point-hint { margin-top: 5px; font-size: var(--fs-xs); color: var(--text-3); }
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
