<script module>
  /**
   * Keep selection out of pointerdown. Selecting rebuilds the Konva document,
   * so doing it before pointerup destroys the gesture target and can strand
   * Firefox's drag state. A click/tap or dragend is already a settled gesture.
   */
  export function bindPanelPointerLifecycle(group, { onPress, onSelect, onDragEnd }) {
    const isPanelTarget = (event) =>
      event?.target === group || event?.target?.name?.() === 'panel-hit';
    group.on('pointerdown', (event) => {
      if (isPanelTarget(event)) onPress(event);
    });
    group.on('click tap', (event) => {
      if (isPanelTarget(event)) onSelect(event);
    });
    if (onDragEnd) {
      group.on('dragend', (event) => {
        // Konva drag events bubble. A shape dragged inside this panel must keep
        // the shape selected and must never commit the parent panel's position.
        if (event?.target !== group) return;
        onSelect(event);
        onDragEnd(event);
      });
    }
  }

  /**
   * Coalesce document rebuilds and keep them out of an active pointer gesture.
   * Replacing Konva nodes between pointerdown and pointerup can leave Firefox
   * dispatching the rest of the gesture to a node that no longer exists.
   */
  export function createCanvasRenderGate(schedule, cancel, { rebuild, refreshUi }) {
    let pointerActive = false;
    let rebuildPending = false;
    let uiPending = false;
    let frame = null;

    function arm() {
      if (pointerActive || (!rebuildPending && !uiPending) || frame !== null) return;
      frame = schedule(() => {
        frame = null;
        if (pointerActive || (!rebuildPending && !uiPending)) return;
        const needsRebuild = rebuildPending;
        const needsUi = uiPending;
        rebuildPending = false;
        uiPending = false;
        if (needsRebuild) rebuild();
        else if (needsUi) refreshUi();
      });
    }

    return {
      beginPointer() {
        pointerActive = true;
      },
      endPointer() {
        pointerActive = false;
        arm();
      },
      requestRebuild() {
        rebuildPending = true;
        arm();
      },
      requestUi() {
        uiPending = true;
        arm();
      },
      destroy() {
        if (frame !== null) cancel(frame);
        frame = null;
        rebuildPending = false;
        uiPending = false;
        pointerActive = false;
      },
    };
  }
</script>

<script>
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords } from '../lib/state.svelte.js';
  import { templatesState } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
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
    copyShapeSpec, dedupeBySrc, isSatelliteCapture, satPanelInput, mediaPanelInput,
    SIG_ANCHORS, SIG_SCALE, newSignature, signatureBox, signatureOffset, signaturePairPositions,
    remapPanelXY, panelHitTest, groupNeighborIndex, hasGroupNeighbor,
    denseRowValues, clampPanelScale, trimClosingDuplicate, freehandShape,
    canReassignLegendNote,
    savedProofSlugs, savedProofTitles as libSavedProofTitles, savedProofTitle as libSavedProofTitle,
    DEFAULT_PROOF_TITLE, proofSlug, uniqueProofTitle, proofTitleFromCase,
    filterProofPanelItems, hasProofCanvasContent, proofExportOptions,
  } from '../lib/composer.js';
  import { createHistory } from '../lib/history.js';

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

  // ---- document state -------------------------------------------------------
  // `notes` holds the legend text per color (annotations are written by color,
  // not per element); `shapes` are the drawn geometry bound to a panel.
  const proof = $state({
    title: DEFAULT_PROOF_TITLE, panels: [], shapes: [], notes: {}, legendOrder: [],
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

  // The analyst's logo (Settings → Signature): one app-wide PNG, loaded once per
  // session and shared by every proof. `null` = none saved, which is what keeps
  // the signature control disabled rather than stamping a broken image.
  let sigImg = $state(null);

  async function loadSignature() {
    try {
      sigImg = await loadImage('/api/settings/signature.png');
    } catch {
      sigImg = null; // none saved — the control stays disabled
    }
  }
  let advancedOpen = $state(false);
  let collapsed = $state({ panels: false, annotations: false, elements: false });
  let savedName = $state(null);
  // Whether the analyst edited the title on this document (vs the auto-assigned
  // default). An untouched default renumbers on a name clash; a title they typed
  // asks before overwriting an existing proof. Reset on open/discard.
  let titleTouched = $state(false);
  let dirty = $state(false);
  // A named proof can exist before it has content. This distinguishes the
  // initial composer shell from a template-only proof the user just created.
  let proofStarted = $state(false);

  // Kept in step with deletes made anywhere else in the app. If the saved proof
  // this canvas came from is gone, the binding has to go with it — otherwise the
  // next Save writes a deleted proof back into the case under its old name.
  // The canvas itself is left alone: the work on screen is still the analyst's.
  $effect(() => {
    caseState.rev;
    const entities = caseState.current?.entities ?? [];
    if (savedName && !entities.some((e) => e.attrs?.spec === `proofs/${savedName}.json`)) {
      savedName = null;
      dirty = true;
      toast('The saved proof was deleted — saving now files a new one', 'warn');
    }
  });
  // Panels whose media was deleted: the image already drawn stays on the canvas,
  // but the panel is flagged so a re-save is not silently building on a ghost.
  const gonePanels = $derived(
    caseState.current
      ? proof.panels.filter(
          (p) => !(caseState.current.entities ?? []).some((e) => e.attrs?.path === p.src)
        )
      : []
  );
  let tool = $state('select');
  let color = $state(ANNO_COLORS[0]);
  let strokeW = $state(4);
  let guide = $state(null); // null | '16:9' | '4:5' — tweet centre-crop overlay
  let selectedId = $state(null);
  let selectedPanelId = $state(null); // free-layout only: panel picked for move/resize
  let selectedSig = $state(null); // null | 'logo' | 'text' — signature picked for resize
  let picker = $state(false);
  let pickerItems = $state([]);
  let newProofOpen = $state(false);
  let newProofName = $state('');
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
  let openList = $state(null); // list of saved proofs, null = closed
  let saving = $state(false);
  let proofFor = $state(undefined);
  let discardConfirm = $state(false);

  // ---- undo / redo -------------------------------------------------------------
  // Snapshot-based history over the serializable document (toSpec). Mutations
  // are captured by a debounced effect, so a slider drag collapses into one
  // entry; panel images are re-attached from a cache on restore.
  const history = createHistory();
  const imgCache = new Map(); // src → HTMLImageElement, survives undo/redo
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
    proof.title = spec.title ?? DEFAULT_PROOF_TITLE;
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
  let containerEl;
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
      proof.panels.map((p) => [p.src, p.caption, p.row, p.scale, p.x, p.y]),
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

  // Layout boxes + document measure for the active layout mode.
  const boxesOf = () => layoutPanels(proof.panels, proof.captionSize, proof.layout, proof.space);
  const measureDoc = () =>
    docSize(proof.panels, proof.shapes, proof.notes, textOpts(), proof.legendOrder, proof.layout, proof.space);

  function resetDoc() {
    proof.title = freshTitle();
    proof.panels = [];
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
    titleTouched = false;
    proofStarted = false;
    selectedId = null;
    selectedPanelId = null;
    selectedSig = null;
    appliedTemplate = null;
    dirty = false;
    imgCache.clear();
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
  }

  function selectPanel(id) {
    if (tool !== 'select') return;
    selectedPanelId = id;
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
    // A satellite capture *is* a media image, so it shows up in both lists. List
    // it once, via its richer satellite entry (coordinates/attribution), and drop
    // it from the media half. dedupeBySrc is a belt-and-braces guard so a stray
    // overlap can never throw the keyed picker's `each_key_duplicate`.
    return dedupeBySrc([
      ...sats.map((s) => ({
        ...satPanelInput(s, prefs.coordFormat),
        label: `${fmtCoords(s.lat, s.lon)} · z${s.zoom}`,
        thumb: s.path,
        kind: 'satellite',
      })),
      ...media
        .filter((m) => m.kind === 'image' && !isSatelliteCapture(m))
        .map((m) => ({
          ...mediaPanelInput(m, media),
          label: m.filename,
          thumb: m.thumbnail ?? m.path,
          kind: 'media',
        })),
    ]);
  }

  async function openNewProofDialog() {
    newProofName = proofTitleFromCase(caseState.current?.name, savedProofTitles());
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
    if (!newProofName.trim() || creatingProof) return;
    if (proofStarted && dirty) {
      replaceWithNewConfirm = true;
      return;
    }
    createNewProof();
  }

  async function createNewProof() {
    if (!newProofName.trim() || creatingProof) return;
    creatingProof = true;
    const title = newProofName.trim();
    const template = templatesState.proof.find((t) => t.id === newProofTemplateId);
    const selectedItems = newProofPanelPaths
      .map((path) => pickerItems.find((item) => item.src === path))
      .filter(Boolean);
    try {
      resetDoc();
      proofStarted = true;
      proof.title = title;
      titleTouched = true;
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
    pickerItems = await fetchPanelItems();
    picker = true;
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

  function panelAt(doc) {
    return panelHitTest(boxesOf(), doc);
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
        selectedSig = null;
      }
      return;
    }
    stage.draggable(false);
    const hit = panelAt(docPoint());
    if (!hit) return;
    const panel = proof.panels[hit.index];
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
    const sigNode = !selectedNode && !panelNode && selectedSig
      ? docLayer.findOne(selectedSig === 'logo' ? '#sig-logo' : '#sig-text')
      : null;
    const boundPanel = panelNode ? proof.panels.find((p) => p.id === selectedPanelId) : null;
    transformer.boundBoxFunc((oldBox, newBox) => {
      if (!boundPanel) return newBox;
      const impliedScale =
        (newBox.width / stage.scaleX()) * (boundPanel.natural[1] / (boundPanel.natural[0] * PANEL_H));
      return impliedScale < SCALE_MIN || impliedScale > SCALE_MAX ? oldBox : newBox;
    });
    transformer.keepRatio(!!sigNode);
    transformer.nodes(
      selectedNode ? [selectedNode] : panelNode ? [panelNode] : sigNode ? [sigNode] : []
    );
    const selKind = selectedShape?.kind;
    transformer.rotateEnabled(selKind === 'text' || selKind === 'rect' || selKind === 'ellipse');
    transformer.enabledAnchors(
      selKind === 'rect' || selKind === 'ellipse'
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
        : selKind === 'text' || panelNode || sigNode
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : []
    );
    drawEndHandles(boxes);
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
  function drawEndHandles(boxes) {
    endHandles.destroyChildren();
    const s = selectedShape;
    if (tool !== 'select' || !s || !POINT_KINDS.has(s.kind)) return;
    const idx = proof.panels.findIndex((p) => p.id === s.panel);
    if (idx < 0) return;
    const box = boxes[idx];
    const panel = proof.panels[idx];
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

  // On drop, re-bind a shape to whichever panel its anchor now sits over and
  // convert its coordinates into that panel's natural pixel space. Returns the
  // source/destination layout boxes so the caller can remap x/y or points.
  function rebindOnDrop(s, node) {
    const boxes = boxesOf();
    const fromIdx = proof.panels.findIndex((p) => p.id === s.panel);
    if (fromIdx < 0) return { fromBox: null, toBox: null };
    const fromBox = boxes[fromIdx];
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
    let toIdx = fromIdx;
    // array order is front→back — the topmost panel claims the drop
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (dx >= b.x && dx <= b.x + b.w && dy >= b.y && dy <= b.y + b.h) { toIdx = i; break; }
    }
    s.panel = proof.panels[toIdx].id;
    return { fromBox, toBox: boxes[toIdx] };
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
    const boxes = boxesOf();
    const idx = proof.panels.findIndex((p) => p.id === s.panel);
    const panelScale = idx >= 0 ? boxes[idx].scale : 1;
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

  // Color / stroke controls act on the selected shape when there is one
  // (live edit), otherwise they set the defaults for the next drawn shape.
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
    } else {
      color = c;
    }
  }

  function setStroke(w) {
    if (selectedShape?.kind === 'text') {
      selectedShape.fontSize = w;
      dirty = true;
    } else if (selectedShape) {
      selectedShape.strokeWidth = w;
      dirty = true;
    } else {
      strokeW = w;
    }
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
      if (k === 'c' && selectedId) { e.preventDefault(); copyShape(); }
      else if (k === 'v' && clipboard) { e.preventDefault(); pasteShape(); }
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
    } else if (e.key === 'Escape') {
      selectedId = null;
      selectedPanelId = null;
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
  // the titles so a fresh proof can take a title that reads apart from them.
  const savedProofNames = () => savedProofSlugs(caseState.current?.entities);
  const savedProofTitles = () => libSavedProofTitles(caseState.current?.entities);

  // Title of a saved proof by its slug, for the overwrite prompt.
  function savedProofTitle(name) {
    return libSavedProofTitle(caseState.current?.entities, name);
  }

  // Default title for a fresh proof, numbered past any already in the case so
  // the top-of-screen name reads apart ("Untitled proof 2"). Called on reset.
  const freshTitle = () => uniqueProofTitle(DEFAULT_PROOF_TITLE, savedProofTitles());

  let overwritePrompt = $state(null); // { name, andPost } when a first save hits a named proof

  async function save({ andPost = false } = {}) {
    if (!proof.panels.length || saving) return;
    // A proof already bound to a saved name (opened, or saved once) writes back
    // over itself — no collision to resolve. On a first save the title is the
    // name: an untouched default title keeps itself unique/numbered (no prompt),
    // a title the analyst typed that lands on an existing proof asks before it
    // overwrites the one already under that name.
    if (!savedName) {
      if (!titleTouched) {
        proof.title = freshTitle();
      } else if (savedProofNames().has(proofSlug(proof.title))) {
        overwritePrompt = { name: proofSlug(proof.title), andPost };
        return;
      }
    }
    return performSave(savedName, andPost);
  }

  async function performSave(name, andPost = false) {
    if (!proof.panels.length || saving) return;
    saving = true;
    try {
      const c = await ensureCase();
      const dataUrl = exportPng();
      const result = await api.post(`/api/cases/${c.id}/proofs`, {
        name,
        title: proof.title,
        spec: toSpec(proof),
        png_base64: dataUrl.split(',')[1],
      });
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

  async function openProofList() {
    openList = await api.get(`/api/cases/${caseState.current.id}/proofs`);
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
    const validPanels = new Set(proof.panels.map((p) => p.id));
    proof.shapes = (spec.shapes ?? []).filter((s) => validPanels.has(s.panel));
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

<svelte:window onkeydown={onKeydown} onkeyup={onKeyup} />

<div class="tool">
  <div class="tool-header">
    <h2>Proof Composer</h2>
    {#if proofStarted}
      <input
        class="input title-input"
        bind:value={proof.title}
        oninput={() => { dirty = true; titleTouched = true; }}
      />
      {#if dirty}<span class="badge">unsaved</span>{/if}
    {/if}
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn" onclick={openProofList}><Icon name="folderOpen" size={15} /> Open</button>
    {/if}
    {#if proofStarted}
      <button class="btn" onclick={() => (discardConfirm = true)} title="Clear this proof">
        <Icon name="reset" size={15} /> Discard
      </button>
    {/if}
    <button class="btn" onclick={openNewProofDialog}><Icon name="plus" size={15} /> New proof</button>
    <button
      class="btn"
      onclick={copyPng}
      disabled={!proofHasContent || copying}
      title="Copy the composed PNG to the clipboard"
    >
      <Icon name="copy" size={15} /> {copying ? 'Copying…' : 'Copy PNG'}
    </button>
    <button class="btn btn-primary" onclick={() => save()} disabled={!proofHasContent || saving}>
      <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save'}
    </button>
    <button class="btn" onclick={() => save({ andPost: true })} disabled={!proofHasContent || saving}>
      <Icon name="post" size={15} /> To Post
    </button>
  </div>

  <div class="body">
    <!-- left: drawing toolbar -->
    <div class="toolbar">
      <button class="tb-btn" title="Undo (Ctrl+Z)" disabled={!canUndo} onclick={undo}>
        <Icon name="undo" size={18} />
      </button>
      <button class="tb-btn" title="Redo (Ctrl+Shift+Z / Ctrl+Y)" disabled={!canRedo} onclick={redo}>
        <Icon name="redo" size={18} />
      </button>
      <div class="tb-sep"></div>
      {#each DRAW_TOOLS as t (t.id)}
        <button
          class="tb-btn"
          class:active={tool === t.id}
          title="{t.label} ({t.shortcut})"
          onclick={() => (tool = t.id)}
        >
          <Icon name={t.icon} size={18} />
        </button>
      {/each}
      <div class="tb-sep"></div>
      {#each proof.palette as c (c)}
        <button
          class="color-btn"
          class:active={activeColor === c}
          style:background={c}
          title="Same color = same feature"
          onclick={() => setColor(c)}
          aria-label={`color ${c}`}
        ></button>
      {/each}
      <label
        class="color-btn color-pick"
        class:active={!proof.palette.includes(activeColor)}
        style:background={activeColor}
        title="Custom color"
      >
        <Icon name="plus" size={12} />
        <input
          type="color"
          value={activeColor}
          oninput={(e) => setColor(e.target.value)}
          aria-label="custom color"
        />
      </label>
      <div class="tb-sep"></div>
      <input
        class="stroke-slider"
        type="range"
        min={selectedShape?.kind === 'text' ? 8 : 1}
        max={selectedShape?.kind === 'text' ? 120 : 24}
        step="1"
        value={selectedShape?.kind === 'text'
          ? (selectedShape.fontSize ?? 28)
          : (selectedShape?.strokeWidth ?? strokeW)}
        oninput={(e) => setStroke(+e.target.value)}
        title={selectedShape?.kind === 'text' ? 'Font size' : selectedShape ? 'Stroke width (selected)' : 'Stroke width'}
      />
      <div class="tb-sep"></div>
      <button class="tb-btn" title="Fit view (f)" onclick={fit}><Icon name="eye" size={18} /></button>
      <div class="tb-sep"></div>
      <button
        class="tb-btn"
        class:active={proof.layout !== 'free'}
        title="Grid layout: panels flow in rows"
        onclick={() => setLayoutMode('grid')}
      >
        <Icon name="grid" size={18} />
      </button>
      <button
        class="tb-btn"
        class:active={proof.layout === 'free'}
        title="Free layout: drag panels anywhere"
        onclick={() => setLayoutMode('free')}
      >
        <Icon name="layers" size={18} />
      </button>
      <div class="tb-sep"></div>
      {#each Object.keys(TWEET_GUIDES) as g (g)}
        <button
          class="tb-btn tb-guide"
          class:active={guide === g}
          title={`Preview the ${g} tweet crop — everything outside is cut off`}
          onclick={() => (guide = guide === g ? null : g)}
        >{g}</button>
      {/each}
      <button
        class="tb-btn tb-magic"
        title={`Auto-fit for a tweet — re-pack panels toward ${guide ?? '16:9'} and reset panel sizes`}
        disabled={!proof.panels.length}
        onclick={applyMagic}
      >
        <Icon name="wand" size={18} />
      </button>
    </div>

    <!-- canvas -->
    <div class="canvas-wrap" class:drawing={tool !== 'select'}>
      <div class="konva" bind:this={containerEl}></div>
      {#if textEdit}
        <input
          class="text-edit"
          style:left={`${textEdit.left}px`}
          style:top={`${textEdit.top}px`}
          style:font-size={`${textEdit.size}px`}
          style:color={textEdit.color}
          bind:value={textEdit.value}
          use:focusSelect
          onblur={() => commitTextEdit(true)}
          onkeydown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') commitTextEdit(true);
            else if (e.key === 'Escape') commitTextEdit(false);
          }}
        />
      {/if}
      {#if !proofHasContent}
        <div class="empty overlay-empty">
          <div class="empty-icon"><Icon name="proof" size={42} /></div>
          {#if proofStarted}
            <h3>No panels yet</h3>
            <p>Add panels when you are ready.</p>
            <button class="btn" onclick={openPicker}>
              <Icon name="plus" size={15} /> Add panel
            </button>
          {:else}
            <h3>Compose a proof</h3>
            <p>Create a proof to choose its template and starting panels.</p>
            <button class="btn" onclick={openNewProofDialog}>
              <Icon name="plus" size={15} /> New proof
            </button>
          {/if}
        </div>
      {/if}
    </div>

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
                title="Open Settings → Templates to create, edit or delete house styles"
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
              <span class="meta-warn" title="No satellite panel yet — add one or type the coordinates">
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

        <div class="side-title-row" style="margin-top: 14px">
          <button class="side-title collapsible" onclick={() => (collapsed.panels = !collapsed.panels)}>
            <span><Icon name={collapsed.panels ? 'chevronRight' : 'chevronDown'} size={13} /> Panels <span class="count">{proof.panels.length}</span></span>
          </button>
          <button
            class="btn btn-ghost btn-sm side-add"
            title="Add a panel"
            onclick={openPicker}
          >
            <Icon name="plus" size={13} />
          </button>
        </div>
        {#if !collapsed.panels}
        {#if gonePanels.length}
          <!-- A panel's media was deleted from the case. The proof keeps it: the
               pixels are already composed into the export (ONTOLOGY §3). Only
               reopening this proof later would come up empty. -->
          <div class="gone-note">
            <Icon name="alert" size={12} />
            <span>
              {gonePanels.length} panel{gonePanels.length > 1 ? 's' : ''} whose media was deleted.
              The proof still exports; reopening it later will show them blank.
            </span>
          </div>
        {/if}
        {#each proof.panels as panel, i (panel.id)}
          <div class="panel-row card" class:selected={selectedPanelId === panel.id} class:gone={gonePanels.includes(panel)}>
            <button
              class="panel-thumb"
              title="Select this panel on the canvas"
              onclick={() => (selectedPanelId = selectedPanelId === panel.id ? null : panel.id)}
            >
              <img src={`/files/${caseState.current?.id}/${panel.src}`} alt="" />
              {#if proof.layout === 'free'}
                <span class="row-badge" title="Stacking order — Z1 is the foreground">Z{i + 1}</span>
              {:else}
                <span class="row-badge" title="Row (top→bottom)">R{(panel.row ?? 0) + 1}</span>
              {/if}
            </button>
            <input
              class="input cap-input"
              placeholder="Caption…"
              bind:value={panel.caption}
              onchange={() => (dirty = true)}
            />
            <!-- one compact row: z-order (free only) · size · delete — moving a
                 grid panel happens on the canvas (select it, use the arrows) -->
            <div class="panel-actions">
              {#if proof.layout === 'free'}
                <button class="btn btn-ghost btn-sm" disabled={i === 0} title="Bring forward (toward Z1)" onclick={() => movePanelZ(i, -1)}>
                  <Icon name="chevronUp" size={13} />
                </button>
                <button class="btn btn-ghost btn-sm" disabled={i === proof.panels.length - 1} title="Send backward" onclick={() => movePanelZ(i, 1)}>
                  <Icon name="chevronDown" size={13} />
                </button>
              {/if}
              <div class="panel-scale" title="Panel size — elements scale with it">
                <button
                  class="btn btn-ghost btn-sm"
                  disabled={(panel.scale ?? 1) <= SCALE_MIN}
                  title="Shrink panel"
                  onclick={() => scalePanel(i, -SCALE_STEP)}
                >−</button>
                <span class="scale-val">{Math.round((panel.scale ?? 1) * 100)}%</span>
                <button
                  class="btn btn-ghost btn-sm"
                  disabled={(panel.scale ?? 1) >= SCALE_MAX}
                  title="Enlarge panel"
                  onclick={() => scalePanel(i, SCALE_STEP)}
                >+</button>
              </div>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto" title="Remove panel" onclick={() => removePanel(i)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        {/each}
        {/if}

        <!-- Annotations: one legend note per color (feature), not per element -->
        <button class="side-title collapsible" style="margin-top: 14px" onclick={() => (collapsed.annotations = !collapsed.annotations)}>
          <span><Icon name={collapsed.annotations ? 'chevronRight' : 'chevronDown'} size={13} /> Annotations <span class="count">{featureList.length}</span></span>
        </button>
        {#if !collapsed.annotations}
        {#if !featureList.length}
          <div class="none">Draw on a panel. Same color = same feature.</div>
        {/if}
        {#each featureList as c, i (c)}
          <div class="anno-row" class:active={activeColor === c}>
            <div class="reorder">
              <button class="btn btn-ghost reorder-btn" disabled={i === 0} title="Move up" onclick={() => moveLegendColor(i, -1)}>
                <Icon name="chevronUp" size={11} />
              </button>
              <button class="btn btn-ghost reorder-btn" disabled={i === featureList.length - 1} title="Move down" onclick={() => moveLegendColor(i, 1)}>
                <Icon name="chevronDown" size={11} />
              </button>
            </div>
            <button
              class="chip-num"
              style:background={c}
              title="Select this color"
              onclick={() => setColor(c)}
            >{i + 1}</button>
            <input
              class="input comment-input"
              placeholder={`Feature ${i + 1} legend…`}
              bind:value={proof.notes[c]}
              onchange={() => (dirty = true)}
            />
          </div>
        {/each}
        {/if}

        <!-- Elements: every drawn shape, for quick select / delete -->
        <button class="side-title collapsible" style="margin-top: 14px" onclick={() => (collapsed.elements = !collapsed.elements)}>
          <span><Icon name={collapsed.elements ? 'chevronRight' : 'chevronDown'} size={13} /> Elements <span class="count">{proof.shapes.length}</span></span>
        </button>
        {#if !collapsed.elements}
        {#each proof.shapes as s, i (s.id)}
          <div
            class="shape-row"
            class:selected={selectedId === s.id}
            onclick={() => (selectedId = s.id)}
            role="button"
            tabindex="0"
            onkeydown={(e) => e.key === 'Enter' && (selectedId = s.id)}
          >
            <div class="reorder">
              <button class="btn btn-ghost reorder-btn" disabled={!canMoveShapeUp(i)} title="Move up (z-order within its panel)" onclick={(e) => { e.stopPropagation(); moveShape(i, -1); }}>
                <Icon name="chevronUp" size={11} />
              </button>
              <button class="btn btn-ghost reorder-btn" disabled={!canMoveShapeDown(i)} title="Move down (z-order within its panel)" onclick={(e) => { e.stopPropagation(); moveShape(i, 1); }}>
                <Icon name="chevronDown" size={11} />
              </button>
            </div>
            <span class="chip" style:background={s.color}></span>
            <Icon name={KIND_ICON[s.kind]} size={13} />
            {#if s.kind === 'text'}
              <input
                class="input comment-input"
                placeholder="Text…"
                bind:value={s.text}
                onchange={() => (dirty = true)}
                onclick={(e) => e.stopPropagation()}
              />
              <button
                class="btn btn-ghost btn-sm"
                class:active={s.frame}
                title="Frame (border in the text's color)"
                onclick={(e) => { e.stopPropagation(); s.frame = !s.frame; dirty = true; }}
              >
                <Icon name="square" size={13} />
              </button>
              <label
                class="color-btn color-pick bg-pick"
                class:active={!!s.bg}
                style:background={s.bg || 'transparent'}
                title="Background color"
                onclick={(e) => e.stopPropagation()}
              >
                <Icon name="plus" size={11} />
                <input
                  type="color"
                  value={s.bg || '#000000'}
                  oninput={(e) => { s.bg = e.target.value; dirty = true; }}
                  aria-label="text background color"
                />
              </label>
              {#if s.bg}
                <button class="btn btn-ghost btn-sm" title="Remove background" onclick={(e) => { e.stopPropagation(); s.bg = null; dirty = true; }}>
                  <Icon name="x" size={11} />
                </button>
              {/if}
            {:else}
              <span class="el-label">{KIND_LABEL[s.kind]} <span class="el-id">#{i + 1}</span></span>
            {/if}
            <button class="btn btn-ghost btn-sm" title="Duplicate (Ctrl+D)" onclick={(e) => { e.stopPropagation(); duplicateShape(s.id); }}>
              <Icon name="copy" size={13} />
            </button>
            <button class="btn btn-ghost btn-sm" title="Delete" onclick={(e) => { e.stopPropagation(); deleteShape(s.id); }}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        {/each}
        {/if}

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
  <Modal
    title="Create proof"
    onclose={() => { if (!creatingProof) newProofOpen = false; }}
    width="780px"
  >
    <form class="new-proof-form" onsubmit={(e) => { e.preventDefault(); requestNewProofCreation(); }}>
      <label class="new-proof-field">
        <span>Name</span>
        <input
          class="input"
          bind:value={newProofName}
          maxlength="200"
          placeholder="Proof name"
        />
      </label>

      <label class="new-proof-field">
        <span>Template</span>
        <select class="input" bind:value={newProofTemplateId}>
          <option value="">No template</option>
          {#each templatesState.proof as t (t.id)}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
        <small>Sets the look without choosing content.</small>
      </label>

      <fieldset class="new-proof-panels">
        <legend>
          <span>Panels</span>
          <span class="selected-count">
            {newProofPanelPaths.length} panel{newProofPanelPaths.length === 1 ? '' : 's'} selected
          </span>
        </legend>

        <div class="panel-picker-bar">
          <div class="panel-search">
            <Icon name="search" size={13} />
            <input placeholder="Search panels…" bind:value={newProofQuery} />
            {#if newProofQuery}
              <button type="button" onclick={() => (newProofQuery = '')} aria-label="Clear search">
                <Icon name="x" size={12} />
              </button>
            {/if}
          </div>
          <div class="panel-categories" aria-label="Panel categories">
            <button
              type="button"
              class:active={newProofCategory === 'all'}
              onclick={() => (newProofCategory = 'all')}
            >All <span>{pickerItems.length}</span></button>
            <button
              type="button"
              class:active={newProofCategory === 'satellite'}
              onclick={() => (newProofCategory = 'satellite')}
            >Satellite captures <span>{pickerItems.filter((item) => item.kind === 'satellite').length}</span></button>
            <button
              type="button"
              class:active={newProofCategory === 'media'}
              onclick={() => (newProofCategory = 'media')}
            >Other images <span>{pickerItems.filter((item) => item.kind === 'media').length}</span></button>
          </div>
        </div>

        {#if newProofLoading}
          <div class="picker-empty">Loading case images…</div>
        {:else if !pickerItems.length}
          <div class="picker-empty">No case images yet, but you can add panels later.</div>
        {:else if !filteredNewProofItems.length}
          <div class="picker-empty">No panels match this search.</div>
        {:else}
          <div class="pick-grid new-proof-grid">
            {#each filteredNewProofItems as item (item.src)}
              <button
                type="button"
                class="pick card selectable-pick"
                class:selected={newProofPanelPaths.includes(item.src)}
                aria-pressed={newProofPanelPaths.includes(item.src)}
                onclick={() => toggleNewProofPanel(item.src)}
              >
                <span class="pick-image">
                  <img src={`/files/${caseState.current?.id}/${item.thumb}`} alt="" loading="lazy" />
                  {#if newProofPanelPaths.includes(item.src)}
                    <span class="pick-selected"><Icon name="check" size={13} /></span>
                  {/if}
                </span>
                <span class="pick-label" title={item.label}>
                  <Icon name={item.kind === 'satellite' ? 'satellite' : 'image'} size={12} />
                  {item.label}
                </span>
              </button>
            {/each}
          </div>
        {/if}
      </fieldset>

      <div class="new-proof-actions">
        <button type="button" class="btn" disabled={creatingProof} onclick={() => (newProofOpen = false)}>
          Cancel
        </button>
        <button type="submit" class="btn btn-primary" disabled={!newProofName.trim() || creatingProof}>
          <Icon name="plus" size={15} /> {creatingProof ? 'Creating…' : 'Create proof'}
        </button>
      </div>
    </form>
  </Modal>
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
    message={`“${savedProofTitle(overwritePrompt.name)}” is already saved in this case.`}
    detail="Saving replaces its PNG and editable spec. Rename this proof to keep both."
    confirmLabel="Overwrite"
    tone="danger"
    icon="check"
    onconfirm={() => {
      const p = overwritePrompt;
      overwritePrompt = null;
      performSave(p.name, p.andPost);
    }}
    oncancel={() => (overwritePrompt = null)}
  />
{/if}

{#if deleteEntry}
  <ConfirmDialog
    title="Delete this proof?"
    message={`“${deleteEntry.title}” will be removed from the case.`}
    detail="This permanently deletes the exported PNG and its editable spec. It cannot be undone."
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
      <div class="pick-grid">
        {#each pickerItems as item (item.src)}
          <button
            class="pick card"
            onclick={() => {
              addPanel(item);
              picker = false;
            }}
          >
            <img src={`/files/${caseState.current.id}/${item.thumb}`} alt="" loading="lazy" />
            <span class="pick-label">
              <Icon name={item.kind === 'satellite' ? 'satellite' : 'image'} size={12} />
              {item.label}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </Modal>
{/if}

{#if openList}
  <Modal title="Open a saved proof" onclose={() => (openList = null)} width="560px">
    {#if !openList.length}
      <div class="empty"><p>No saved proofs in this case yet.</p></div>
    {:else}
      <div class="open-list">
        {#each openList as entry (entry.name)}
          <div class="open-row-wrap">
            <button class="open-row" onclick={() => openProof(entry)}>
              {#if entry.png}
                <img src={`/files/${caseState.current.id}/${entry.png}`} alt="" loading="lazy" />
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
  </Modal>
{/if}

<style>
  .spacer { flex: 1; }
  .title-input {
    width: min(320px, 26vw);
    font-weight: 600;
  }
  .new-proof-form {
    display: flex;
    flex-direction: column;
    gap: 15px;
  }
  .new-proof-field {
    display: grid;
    grid-template-columns: 110px minmax(0, 1fr);
    align-items: center;
    gap: 5px 12px;
    font-size: var(--fs-xs);
    font-weight: 600;
  }
  .new-proof-field small {
    grid-column: 2;
    color: var(--text-3);
    font-weight: 400;
  }
  .new-proof-panels {
    min-width: 0;
    padding: 0;
    border: 0;
  }
  .new-proof-panels legend {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 7px;
    font-size: var(--fs-xs);
    font-weight: 700;
    color: var(--text-2);
  }
  .selected-count { color: var(--text-3); font-weight: 500; }
  .panel-picker-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 7px;
    margin-bottom: 10px;
    min-width: 0;
  }
  .panel-search {
    min-width: 170px;
    flex: 1;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-3);
  }
  .panel-search:focus-within { border-color: var(--accent); }
  .panel-search input {
    width: 100%;
    min-width: 0;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--text-1);
    font: inherit;
  }
  .panel-search button { display: flex; color: var(--text-3); }
  .panel-categories { display: flex; gap: 5px; overflow-x: auto; max-width: 100%; }
  .panel-categories button {
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 5px 8px;
    border: 1px solid var(--border);
    border-radius: var(--r-sm);
    background: var(--bg-2);
    color: var(--text-2);
    font-size: var(--fs-xs);
    white-space: nowrap;
  }
  .panel-categories button:hover { border-color: var(--border-strong); color: var(--text-1); }
  .panel-categories button.active { border-color: var(--accent); color: var(--text-1); }
  .panel-categories span { color: var(--text-3); }
  .new-proof-grid {
    max-height: min(42vh, 390px);
    overflow-y: auto;
    padding: 1px;
  }
  .selectable-pick { position: relative; }
  .selectable-pick.selected { border-color: var(--accent); }
  .pick-image { position: relative; display: block; }
  .pick-selected {
    position: absolute;
    top: 6px;
    right: 6px;
    width: 22px;
    height: 22px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: var(--accent);
    color: var(--accent-text);
  }
  .picker-empty {
    min-height: 120px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    border: 1px dashed var(--border);
    border-radius: var(--r-md);
    color: var(--text-3);
    font-size: var(--fs-sm);
  }
  .new-proof-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    padding-top: 2px;
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
  .toolbar {
    width: 52px;
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 12px 0;
    border-right: 1px solid var(--border);
    background: var(--bg-1);
  }
  .tb-btn {
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--r-sm);
    color: var(--text-3);
  }
  .tb-btn:hover { color: var(--text-1); background: var(--bg-2); }
  .tb-btn.active { color: var(--text-1); background: var(--bg-3); }
  .tb-guide { font-size: 11px; font-weight: 700; }
  .tb-magic:not(:disabled) { color: var(--accent); }
  .tb-magic:not(:disabled):hover { background: var(--accent-soft); }
  .tb-magic:disabled { opacity: 0.4; cursor: default; }
  .tb-sep {
    width: 26px;
    height: 1px;
    background: var(--border);
    margin: 4px 0;
  }
  .color-btn {
    width: 22px;
    height: 22px;
    border-radius: 50%;
    border: 2px solid transparent;
    transition: border-color 0.12s var(--ease);
    flex-shrink: 0;
  }
  .color-btn:hover {
    border-color: var(--text-3);
  }
  .color-btn.active {
    border-color: var(--text-1);
    box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text-3);
  }
  .color-pick {
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--accent-text);
    cursor: pointer;
    position: relative;
    overflow: hidden;
  }
  .color-pick input {
    position: absolute;
    inset: 0;
    opacity: 0;
    cursor: pointer;
  }
  .stroke-slider {
    width: 80px;
    transform: rotate(-90deg);
    margin: 34px 0;
    accent-color: var(--accent);
  }
  .canvas-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
    background:
      radial-gradient(circle at 1px 1px, rgba(148, 163, 196, 0.07) 1px, transparent 0) 0 0 / 22px 22px,
      var(--bg-0);
  }
  .canvas-wrap.drawing { cursor: crosshair; }
  .konva { position: absolute; inset: 0; }
  .tb-btn:disabled { opacity: 0.35; cursor: default; }
  .tb-btn:disabled:hover { color: var(--text-3); background: none; }
  .text-edit {
    position: absolute;
    transform: translateY(-2px);
    min-width: 60px;
    padding: 0 2px;
    font-family: system-ui, sans-serif;
    font-weight: 700;
    background: rgba(14, 14, 14, 0.85);
    border: 1px dashed var(--accent);
    border-radius: 2px;
    outline: none;
  }
  .overlay-empty {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  .overlay-empty .btn { pointer-events: auto; }
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
  .side-title {
    font-size: var(--fs-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-2);
    margin-bottom: 8px;
    display: flex;
    justify-content: space-between;
  }
  .side-title.collapsible {
    width: 100%;
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    text-align: left;
    font: inherit;
    color: inherit;
  }
  .side-title.collapsible span {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .side-title-row { display: flex; align-items: center; gap: 4px; }
  .side-title-row .side-title { margin-bottom: 0; }
  .side-add { margin-left: auto; color: var(--text-3); }
  .count { color: var(--text-3); }
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
  .gone-note {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin-bottom: 8px;
    padding: 7px 9px;
    border-radius: var(--r-sm);
    font-size: var(--fs-xs);
    line-height: 1.4;
    color: color-mix(in srgb, var(--danger, #e5484d) 80%, var(--text-2));
    background: color-mix(in srgb, var(--danger, #e5484d) 10%, transparent);
  }
  .gone-note :global(svg) { flex-shrink: 0; margin-top: 2px; }
  .panel-row.gone {
    border-color: color-mix(in srgb, var(--danger, #e5484d) 40%, transparent);
  }
  .panel-row {
    padding: 8px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .panel-thumb {
    position: relative;
    display: block;
    width: 100%;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
  }
  .panel-row.selected { border-color: var(--accent); }
  .panel-row img {
    width: 100%;
    max-height: 90px;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-2);
    display: block;
  }
  .row-badge {
    position: absolute;
    top: 5px;
    left: 5px;
    padding: 1px 6px;
    border-radius: var(--r-sm);
    font-size: 10px;
    font-weight: 700;
    color: var(--text-1);
    background: rgba(14, 14, 14, 0.72);
  }
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
  .cap-input { font-size: var(--fs-xs); padding: 5px 8px; }
  .panel-actions { display: flex; align-items: center; gap: 2px; }
  .panel-scale {
    display: flex;
    align-items: center;
    gap: 4px;
    margin: 0 auto; /* centres the size control between z-order and delete */
  }
  .scale-val {
    min-width: 42px;
    text-align: center;
    font-size: var(--fs-xs);
    font-weight: 600;
    color: var(--text-2);
    font-variant-numeric: tabular-nums;
  }
  .none {
    font-size: var(--fs-xs);
    color: var(--text-3);
    padding: 2px 2px 8px;
  }
  .anno-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 3px 4px;
    border-radius: var(--r-sm);
    margin-bottom: 4px;
    border: 1px solid transparent;
  }
  .anno-row.active { border-color: var(--accent); background: var(--accent-soft); }
  .reorder {
    display: flex;
    flex-direction: column;
    gap: 1px;
    flex-shrink: 0;
  }
  .reorder-btn {
    padding: 0 2px;
    line-height: 1;
    color: var(--text-3);
  }
  .reorder-btn:disabled { opacity: 0.25; cursor: default; }
  .bg-pick {
    width: 20px;
    height: 20px;
    flex-shrink: 0;
    border: 1px dashed var(--border);
  }
  .bg-pick.active { border-style: solid; }
  .bg-pick:not(.active) { color: var(--text-3); }
  .chip-num {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: var(--accent-text);
    display: flex;
    align-items: center;
    justify-content: center;
    border: 2px solid transparent;
    cursor: pointer;
  }
  .chip-num:hover { border-color: var(--text-1); }
  .el-label {
    flex: 1;
    font-size: var(--fs-xs);
    color: var(--text-2);
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .el-id { color: var(--text-3); }
  .shape-row {
    display: flex;
    align-items: center;
    gap: 7px;
    padding: 5px 6px;
    border-radius: var(--r-sm);
    margin-bottom: 3px;
    border: 1px solid transparent;
    color: var(--text-3);
    cursor: pointer;
  }
  .shape-row:hover { background: var(--bg-2); }
  .shape-row.selected { border-color: var(--accent); background: var(--accent-soft); }
  .chip {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .comment-input {
    flex: 1;
    font-size: var(--fs-xs);
    padding: 4px 8px;
    background: transparent;
    border-color: transparent;
    min-width: 0;
  }
  .comment-input:hover, .comment-input:focus { background: var(--bg-2); border-color: var(--border); }
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
