<script>
  import { onDestroy, onMount, untrack } from 'svelte';
  import { offerNote, offerPuts, withdrawNote } from '../lib/noteHere.svelte.js';
  import PutInNote from '../components/PutInNote.svelte';
  import { proofOffer } from './proof/proofNote.js';
  import { holdsUnsaved, onBackForward, settlePlace } from '../lib/backButton.js';
  import { fileUrl } from '../lib/fileUrl.js';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { lookupEntity, fetchAllEntities } from '../lib/catalog.js';
  import { matchesTerms } from '../lib/folderBrowse.js';
  import { isSatelliteMedia, sortItems } from '../lib/mediaFilter.js';
  import { deletedToast, RESTORABLE } from '../lib/trash.js';
  // Reading a typed pair back into a point: the one parser the app has, and the
  // one a coordinate row is written in (decimal, hemispheres, or DMS).
  import { parseLatLon } from '../lib/sheetRoles.js';
  import ProofPointMenu from './proof/ProofPointMenu.svelte';
  import LayerPlaces from './satellite/LayerPlaces.svelte';
  import { createProofLayers, orderedTargets, placesOf } from './proof/proofLayers.svelte.js';
  import { addedLayers } from '../lib/map/addedLayersState.svelte.js';
  import { personalLayers } from '../lib/map/personalLayers.svelte.js';
  import { zoneAt } from '../lib/localZone.js';
  import { kinSentence } from '../lib/proposalReview.js';
  import { caseState, uiState, ensureCase, reloadCase, toast, prefs, fmtCoords } from '../lib/state.svelte.js';
  import { templatesState } from '../lib/state.svelte.js';
  import { myLogoUrl } from '../lib/myLogo.js';
  import Icon from '../components/Icon.svelte';
  import BackButton from '../components/BackButton.svelte';
  import Modal from '../components/Modal.svelte';
  import DateField from '../components/DateField.svelte';
  import ClockField from '../components/ClockField.svelte';
  import SearchInput from '../components/SearchInput.svelte';
  import FolderBrowser from '../components/FolderBrowser.svelte';
  import ConfirmDialog from '../components/ConfirmDialog.svelte';
  import FloatingMenu from '../components/FloatingMenu.svelte';
  import ExportFolderPicker from '../components/ExportFolderPicker.svelte';
  import { destinationLabel, readDestinations } from '../lib/exportDest.js';
  import ProofToolbar from './proof/ProofToolbar.svelte';
  import ProofCanvas from './proof/ProofCanvas.svelte';
  import ProofLayersPanel from './proof/ProofLayersPanel.svelte';
  import ProofContextMenu from './proof/ProofContextMenu.svelte';
  import '../lib/proofFontFaces.js';
  import { PROOF_FONTS, DEFAULT_PROOF_FONT, fontStack, loadProofFont } from '../lib/proofFonts.js';
  import NewProofDialog from './proof/NewProofDialog.svelte';
  import ProofHome from './proof/ProofHome.svelte';
  import ImportProofDialog from './proof/ImportProofDialog.svelte';
  import PointMapDialog from './proof/PointMapDialog.svelte';
  import PanelCategories from './proof/PanelCategories.svelte';
  import SceneBlock from './proof/SceneBlock.svelte';
  import ProofSideTabs from './proof/ProofSideTabs.svelte';
  import { needsWords, proofNeeds, shownTab, sideTabs } from './proof/sideTabs.js';
  import { ProofScene } from './proof/proofScene.svelte.js';
  import { frameOrigin, panelFrames, readHandoff, readStatedScene, sceneBadges, sceneColor, videoName } from '../lib/proofScene.js';
  import { PROOF_SCENE_HELP } from '../lib/proofSceneHelp.js';
  import { buildFrameOps, frameSaveName, sliderFilters, sourceStem } from '../lib/inspect.js';
  import { preciseClock } from '../lib/inspectPlayer.js';
  import { bindPanelPointerLifecycle, createCanvasRenderGate,
  discardDraft,
} from './proof/canvasLifecycle.js';
  import { closeStrandedGesture } from '../lib/konvaGesture.js';
  import { creditLines } from '../lib/creditLines.js';
  import {
    ANNO_COLORS, PAD, GAP, ROW_GAP, PANEL_H, TWEET_GUIDES,
    CAPTION_SIZE, LEGEND_SIZE, FOOTER_SIZE,
    BG, TEXT_MAIN, normSpace, textColors,
    layoutPanels, panelsBottom, panelScale, freeNormalizeDelta, legendLineHeight, footerBand,
    attributionLine, creditLine, footerLine, imageryCredits, docSize, autoLayoutRows,
    autoCoords, formatCoords, autoSourceUrls, proofSource, statedSources, openableSource,
    specPoints, statePanelPoint, pointProposed, uncheckedPoints, footerLines, coordsPostLines, proofCoordsLines, MAX_POINTS,
    normalizeMaterial, resolveSourceUrls,
    toSpec, newId, loadImage, orderedFeatureColors, notesFromShapes,
    templateFromProof, applyProofStyle, normalizeProofStyle, newSignatureText,
    anchoredPos, anchoredOffset, SIG_TEXT_SIZE,
    dedupeBySrc, satPanelInput, mediaPanelInput,
    SIG_ANCHORS, SIG_SCALE, newSignature, signatureBox, signatureOffset, signaturePairPositions,
    groupNeighborIndex, hasGroupNeighbor,
    denseRowValues, clampPanelScale, trimClosingDuplicate, freehandShape,
    canReassignLegendNote,
    surfaces, surfaceHitTest, surfaceFrame, pageToSurface, surfaceToPage, pageStepOnSurface,
    surfaceShows, holdOnSurface, surfaceCorners, panelSizedHeight,
    moveShapeToSurface, withInkOnPage, pasteBoxes, clampPaste, clampPasteScale,
    pasteInsertScale, newPaste, newFrame, normalizeFrame, FRAME_WIDTH_MAX, FRAME_COLOR,
    PASTE_SCALE_MIN, PASTE_SCALE_MAX,
    filterProofPanelItems, hasProofCanvasContent, proofExportOptions, panelPreview,
    isPublishedProof, publishedBoxes, publishedPage,
  } from '../lib/composer.js';
  import {
    canFill,
    fillPaint,
    movedBy,
    nextMarkerNumber,
    nextPanelRow,
    notesAfterRemoval,
    nudgeShape,
    PANEL_SCALE_MAX,
    PANEL_SCALE_MIN,
    pointsWithTransform,
    dashPattern,
    DASHABLE,
    restacked,
    scaleFromNode,
    tagBox,
    tagFont,
    tagPlate,
    textBoxPad,
    viewCentrePoint,
  } from '../lib/proofEdits.js';
  import {
    blurPatch,
    blurRadiusFor,
    cutToSourceCrop,
    fitSurfaceCut,
    isQuarterTurn,
    mapSurfaceShapes,
    normalizeSourceCrop,
    normalizeSurfaceAngle,
    settleSurfaceCut,
    shiftProofShape,
    sourceSize,
    surfaceBoxSize,
    surfaceCutMiddle,
    surfaceCutOutline,
    surfaceCutReach,
    surfaceCutSeat,
    surfaceCutStart,
    surfaceImageSize,
    turnSurfaceCut,
    turned,
  } from '../lib/proofSurface.js';
  import {
    ICON_BOX, ICON_SIZE_DEFAULT, ICON_SIZE_MIN, PROOF_ICONS,
    glyphInk, iconByName, iconOrigin, isSolidIcon,
  } from '../lib/proofIcons.js';
  import { isModel } from '../lib/icons/catalog.js';
  import { drawModelRing } from '../lib/proofModelRing.js';
  import { stampNodes } from '../lib/proofStamp.js';
  import { pickedModelView } from '../lib/proofModelNode.js';
  import {
    assetName, base64Of, PASTE_TYPES, MAX_PASTES, MAX_PASTE_BYTES,
  } from '../lib/pasteAsset.js';
  import {
    isDefaultName, nextName, ownName, savedSlugs, savedTitles, savedTitle, slugify, specAttr, specPath,
  } from '../lib/naming.js';
  import { createHistory } from '../lib/history.js';
  import { shortcut } from '../lib/keys.js';
  import { middleClickPaste } from '../lib/clipboardPaste.js';
  import {
    along, bearingTo, coneHandles, fovFromEdge, lensFov, CONE_BADGE, CONE_BADGE_MIN, CONE_BADGE_MAX,
  } from '../lib/viewCone.js';
  import {
    isPageMark, CALLOUT_FONT, CALLOUT_OFFSET, calloutBox, calloutInk, nearestOnRect, bubbleTail,
    insetBox, insetHeight, insetPlacement, insetConnectors, labelToCallout, calloutToLabel, INSET_MIN,
  } from '../lib/pageMarks.js';
  import {
    PAGE, isFree, canBeFree, pageEntry, onPage, pageHit, isLink, holdsToPicture, linkPoints, settleLink,
    pictureUnder, nudgedLink, letGoOf, shiftedTies, markBounds, freeExtent,
  } from '../lib/freeMarks.js';
  import { INSET, goingWith, insetSurfaces, isLocked, reframedInsetMarks } from '../lib/insetMarks.js';
  import { clipText, makeCopy, pasteShapes, readClip } from '../lib/proofClipboard.js';
  import { pollWhile } from '../lib/poll.js';
  import { carriesOutsideFiles } from '../lib/drag.js';
  import ProofSlides from './proof/ProofSlides.svelte';
  import { startPost } from './post/start.js';
  import DraftPage from './proof/DraftPage.svelte';
  import ProofFrames from './inspect/ProofFrames.svelte';
  import { neighbour, resumeAt, slideAfterDelete, slideStyle, slideTiles, switchPlan } from '../lib/proofSlides.js';
  import { defaultProofTemplate } from '../lib/proofTemplates.js';
  import { addMark, newAzimutMark } from '../lib/proofMark.js';
  import { PROOF_TEMPLATE_HELP } from '../lib/proofTemplateHelp.js';
  import MarkShowChoice from '../components/MarkShowChoice.svelte';
  import { onEvent } from '../lib/events.js';
  import {
    abandonProof, abandonScene, ensureSceneQueue, geolocateScene, geolocating, holdSceneQueue, readSceneQueue, restoreProof, restoreScene,
    sceneQueue,
  } from '../lib/geolocating.svelte.js';
  import { sceneMaterial, scenesToProve } from '../lib/newProof.js';
  import { openScenes, queueColor } from '../lib/sceneQueue.js';
  import { NO_VIDEO, inVideo, proofLabel, proofVideos, slideTag } from '../lib/proofList.js';
  import { collagesOfScene, pictureHandoff, proofHandoff } from '../lib/sceneFrames.js';
  import { sceneMoments, sceneStart, sceneTime } from '../lib/scenes.js';

  const SCALE_STEP = 0.05;
  // Canvas handles are drawn, not styled, so the one accent has to be spelled
  // out here. Keep it equal to --accent in app.css.
  const ACCENT = '#e8a33d';
  const HANDLE_RING = '#10141c'; // the dark ring Collage draws its handles with

  const DRAW_TOOLS = [
    { id: 'select', icon: 'cursor', label: 'Select / move', shortcut: 'v' },
    { id: 'rect', icon: 'square', label: 'Box', shortcut: 'r' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse', shortcut: 'e' },
    { id: 'arrow', icon: 'arrow', label: 'Arrow', shortcut: 'a' },
    { id: 'line', icon: 'line', label: 'Line', shortcut: 'l' },
    { id: 'curve', icon: 'curve', label: 'Curve (click points, double-click to finish)', shortcut: 'c' },
    { id: 'freehand', icon: 'freehand', label: 'Freehand', shortcut: 'd' },
    { id: 'text', icon: 'text', label: 'Text', shortcut: 't' },
    { id: 'callout', icon: 'calloutLeader', label: 'Callout (press the point, drag to the label)', shortcut: 'k' },
    { id: 'number', icon: 'numbered', label: 'Numbered marker', shortcut: 'n' },
    { id: 'blur', icon: 'blurBox', label: 'Blur box', shortcut: 'b' },
    { id: 'zoom', icon: 'zoomInset', label: 'Zoom inset (frame the detail)', shortcut: 'z' },
    { id: 'cone', icon: 'viewCone', label: 'View cone (press where the camera stood, drag the way it looked)', shortcut: 'o' },
  ];

  // Ink is measured in page pixels, the same on every panel and overlay. Nodes
  // are drawn inside their surface's scale, so each size is divided by it there.
  const ARROW_HEAD = 14;
  // Ctrl+D and a paste step a copy this far down-right of what it copies.
  const PASTE_STEP = 26;

  // Document state. Notes are keyed by color, shapes bind to surfaces and pasted
  // images remain local to this proof.
  const proof = $state({
    title: '', panels: [], pastes: [], shapes: [], notes: {}, legendOrder: [],
    // The pictures of a proof imported as published, top to bottom: the page itself, with
    // no background, margins or footer. Empty for every other proof.
    published: [],
    templateId: null, // selected saved house style; its values remain copied below
    // What the proof concludes on, one row per point, the first one the conclusion.
    // Always at least one row: an empty one reads as the coordinates the panels
    // give it, which is what the field has always shown.
    points: [{ coords: '', label: '', pov: false }],
    sources: null, // null → traced from the panels; a list → what the analyst states
    // When the material was taken, in the case's temporal profile, and the
    // sentence the proof carries. Both optional, neither printed on the plate:
    // the date is what puts the proof on the Timeline, the description is what a
    // post is written from. '' → the panels answer for the date, nothing for the
    // sentence.
    when: '',
    // The zone the date is read in: null is the first point's, resolved on save.
    whenZone: null,
    description: '',
    // Case files the proof rests on without composing them, brought in from a stated
    // source address. They join the chain on save, and the point with it.
    material: [],
    footerCoords: false, // whether the plate prints the proof's points
    footerText: true, // whether the plate prints its credit line
    footerCredits: false, // whether the panels' imagery credits follow that line
    sceneBadge: false, // whether the panels cut from the proof's video print the scene's time
    captionSize: CAPTION_SIZE, legendSize: LEGEND_SIZE, footerSize: FOOTER_SIZE, footer: '',
    footerEnabled: true, // false → no footer line at all
    footerColor: null, // null → auto from the background
    footerAlign: 'left',
    captionColor: null, // null → auto from the background
    captionsEnabled: true, // whether newly added panels get a default caption
    font: DEFAULT_PROOF_FONT, // the typeface every word on the proof is set in
    fontBold: true, // the words of labels, callouts and tags in bold
    bg: BG, // proof background fill; captions/legend/footer follow it (textColors)
    space: { pad: PAD, gap: GAP, rowGap: ROW_GAP }, // panel spacing, editable per proof
    layout: 'grid', // 'grid' (rows) | 'free' (drag panels anywhere, overlap allowed)
    panelDirection: 'horizontal', // preferred arrangement for the first two panels
    signature: null, // null → unsigned; else { anchor, dx, dy, scale, opacity }
    signatureText: null, // null → none; else a Settings-handle slot over the panels
    azimutMark: null, // null → none; else the Azimut mark beside the signature (lib/proofMark.js)
    palette: [...ANNO_COLORS], // ordered drawing colours, most preferred first
  });

  // The app-wide logo, read again whenever Settings saves a new one; null disables
  // the control. The canvas redraws when it lands.
  let sigImg = $state(null);
  $effect(() => {
    const url = myLogoUrl();
    let live = true;
    loadImage(url).then(
      (picture) => { if (live) sigImg = picture; },
      () => { if (live) sigImg = null; }, // no saved logo
    );
    return () => { live = false; };
  });
  let collapsed = $state({ panels: false, overlays: false, annotations: false, elements: false });
  let cropSurfaceId = $state(null);
  let cropDraft = $state(null); // the box the crop marks frame, upright, from the source's middle
  let cropStart = null; // where the marks opened: leaving them there changes nothing
  // Saved proof slug, or null before the first save.
  let savedName = $state(null);
  let dirty = $state(false);

  // ---- the analyst's layers the points are in -------------------------------
  // Read again whenever the case moves or the tab comes back, since a marker is
  // as easily taken out from the map as from here.
  const pointLayers = createProofLayers({ api, layers: addedLayers, lookup: lookupEntity, notify: toast,
    refreshEditor: (name) => { if (personalLayers.editor?.name === name) personalLayers.refresh(); } });
  $effect(() => {
    const owner = caseState.current?.id, name = savedName;
    void caseState.rev;
    if (uiState.tool !== 'proof') return;
    untrack(() => pointLayers.refresh(owner, name));
  });

  // ---- the clock the date is read on ---------------------------------------
  // The first point is the conclusion, and footage is read on the clock of the
  // place it shows, so that point's zone is the default. It is looked up only
  // while a date is set, from the bundled boundaries (no network).
  let pointZone = $state('');
  const zonePointKey = $derived.by(() => {
    if (!proof.when.trim()) return '';
    const typed = String(specPoints(proof)[0]?.coords ?? '').trim();
    if (typed) return typed;
    const auto = autoCoords(proof.panels ?? []);
    return auto ? `${auto.lat}, ${auto.lon}` : '';
  });
  $effect(() => {
    const key = zonePointKey;
    if (!key) {
      pointZone = '';
      return;
    }
    let live = true;
    const timer = setTimeout(async () => {
      try {
        const where = parseLatLon(key) ?? (await api.post('/api/geo/parse', { text: key }));
        const zone = await zoneAt({ lat: Number(where.lat), lon: Number(where.lon) });
        if (live) pointZone = zone;
      } catch {
        if (live) pointZone = '';
      }
    }, 250);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  });
  /** The clock the date reads on: the analyst's pick, else the point's, else UTC. A
   *  pick of the point's own row goes back to following the point. */
  function pickClock(zone, { here }) {
    proof.whenZone = here ? null : zone;
    dirty = true;
  }
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
  // The saved proof open here is what the topbar's Add event seats; an unsaved one offers nothing.
  $effect(() => {
    const spec = savedName ? specPath('proof', savedName) : null;
    offerNote('proof', proofEntities.find((e) => e.attrs?.[specAttr('proof')] === spec) ?? null);
  });
  onDestroy(() => withdrawNote('proof'));

  // ---- a save another act waits for ---------------------------------------------
  // The same save a press of Save proof runs, its point check and name question
  // included, for what needs the proof saved first: the note pinned beside, the cut
  // for the post. Answers once it is over, landed or not.
  let saveWaiters = [];
  $effect(() => {
    if (saving || checking || overwritePrompt) return;
    const waiting = saveWaiters;
    saveWaiters = [];
    for (const settle of waiting) settle();
  });

  function saveSettled() {
    return new Promise((resolve) => {
      saveWaiters.push(resolve);
      void save();
      // A save refused before it began leaves nothing to wait for.
      if (!saving && !checking && !overwritePrompt) {
        saveWaiters = saveWaiters.filter((one) => one !== resolve);
        resolve();
      }
    });
  }

  // ---- into the note pinned beside -------------------------------------------
  // "This proof" is the proof as saved: an unsaved one is saved first and the put
  // waits for it. A save that does not land puts nothing in.
  function savedForNote({ signal } = {}) {
    const settle = () => {
      if (signal?.aborted) throw new DOMException('Stopped', 'AbortError');
      if (dirty || !savedName) throw new Error('The proof was not saved, so nothing went in');
      return statedForNote();
    };
    if (!dirty && savedName) return Promise.resolve().then(settle);
    if (!proofHasContent) return Promise.reject(new Error('The proof is empty'));
    return saveSettled().then(settle);
  }

  /** Cut for the post on a proof never saved: where its save put it, or null when it stopped. */
  async function savedForClip() {
    if (!savedName) await saveSettled();
    return savedName ? { caseId: caseState.current?.id, name: savedName } : null;
  }

  /** The saved proof's record, and what it states, as the note puts them. */
  async function statedForNote() {
    const entity = await lookupEntity(caseState.current?.id, specAttr('proof'), specPath('proof', savedName));
    if (!entity?.attrs?.path) throw new Error('The proof has no picture yet. Save it again');
    const stated = specPoints(proof);
    return {
      entity,
      description: entity.attrs.notes ?? proof.description,
      when: entity.attrs.when ?? '',
      whenZone: entity.attrs.when_zone ?? null,
      lines: stated.length ? stated : proofCoordsLines(proof, 'dd'),
    };
  }

  const noteOffer = proofOffer({ saved: savedForNote, unsaved: () => dirty || !savedName });
  offerPuts('proof', () => (proofHasContent ? [noteOffer] : []));

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
        shelfThumbs = new Map([...media, ...sat].map((it) => [it.path, it.thumbnail || null]));
      })
      .catch(() => { if (live) { presentPaths = new Set(); caseMedia = []; shelfThumbs = new Map(); } });
    return () => { live = false; };
  });

  /** The case's own media, kept for one question: whether a stated address is already
   *  in the case. Answered by tracing each file back the way a panel's source line is
   *  traced, so a frame cut from a downloaded clip counts as that clip's address. */
  let caseMedia = $state([]);
  // Each case file's thumbnail, the captures' included: what a slide shows of a scene's first capture.
  let shelfThumbs = $state(new Map());
  const heldAddresses = $derived.by(() => {
    const byPath = new Map(caseMedia.map((one) => [one.path, one]));
    const found = new Set();
    for (const one of caseMedia) for (const url of resolveSourceUrls(one, byPath)) found.add(url);
    return found;
  });

  // ---- the scene: where in its video the proof happens ------------------------------
  // Read off the panels Inspect cut from a video, unless the proof states it
  // (`lib/proofScene.js`). It is shown and stated in the side column (SceneBlock), and
  // written through its own route, never with a save (proof/proofScene.svelte.js).
  const sceneFrames = $derived(panelFrames(proof.panels, new Map(caseMedia.map((one) => [one.path, one]))));
  // The other panels made from a video's footage: a capture over a frame or a collage of
  // it, or one a scene of it gathered on the map. The server walks each one's derivation
  // (`POST /scenes/ties`); they say which video and scene, and are never frames.
  let sceneTies = $state([]);
  const untiedPanels = $derived.by(() => {
    const cut = new Set(sceneFrames.map((f) => f.src));
    return [...new Set(proof.panels.map((p) => p.src).filter((src) => src && !cut.has(src)))].join('\n');
  });
  // a panel taken out, or another proof opened, lets its ties go before the next read lands
  const panelTies = $derived.by(() => {
    const laid = new Set(untiedPanels.split('\n'));
    return sceneTies.filter((tie) => laid.has(tie.src));
  });
  let tiesRun = 0;
  async function readTies(caseId = caseState.current?.id, panels = untiedPanels) {
    const run = ++tiesRun;
    const wanted = panels ? panels.split('\n') : [];
    if (!caseId || !wanted.length) {
      sceneTies = [];
      return;
    }
    try {
      const answer = await api.post(`/api/cases/${caseId}/scenes/ties`, { panels: wanted });
      if (run === tiesRun) sceneTies = Array.isArray(answer?.ties) ? answer.ties : [];
    } catch {
      if (run === tiesRun) sceneTies = [];
    }
  }
  const tiesCase = $derived(caseState.current?.id ?? null);
  $effect(() => {
    const id = tiesCase, panels = untiedPanels;
    untrack(() => readTies(id, panels));
  });
  const scene = new ProofScene({
    api,
    toast,
    where: () => ({ caseId: caseState.current?.id ?? null, name: savedName }),
    frames: () => sceneFrames,
    ties: () => panelTies,
    // a video by its title in Media, as every surface of Geo Proof names it
    titleOf: (path) => mediaTitle(path),
    // the ★ video's scenes, as the strip read them: where a proof made by hand finds its own
    listed: () => slides.answer,
    // a time printed on the picture is a picture the saved one no longer is
    onstated: () => {
      if (proof.sceneBadge) dirty = true;
    },
  });
  // The video a delete asks about the scene of: one the proof states or was cut from. A
  // proof only tied to it states nothing there, so its delete gives nothing back.
  const sceneOwned = $derived(scene.stated || sceneFrames.length ? scene.star : null);
  // The badge each panel of the proof's video prints, when asked: part of the picture.
  const badges = $derived(sceneBadges(proof.sceneBadge, sceneFrames, scene.star, scene.moments));
  // The scene's colour on Inspect's bar, read when its player opens on the proof's video.
  const sceneVideo = $derived(scene.view?.video ?? null);
  let sceneHue = $state(undefined);
  $effect(() => {
    const video = sceneVideo, id = caseState.current?.id, name = savedName, draft = scene.draft;
    if (!video || !id) return;
    // the strip under the canvas has read this video's scenes already
    if (slides.answer?.video === video) {
      sceneHue = sceneColor(slides.answer.scenes, { proof: name, draft });
      return;
    }
    let live = true;
    api.get(`/api/cases/${id}/scenes?video=${encodeURIComponent(video)}`)
      .then((res) => { if (live) sceneHue = sceneColor(res?.scenes, { proof: name, draft }); })
      .catch(() => {});
    return () => { live = false; };
  });

  // ---- the slides: the scenes of the proof's video, on a strip under the canvas ---------
  // A view of the read Inspect's Scenes tab makes (`lib/proofSlides.js`): the proofs
  // resting on the ★ video and the scenes of it still to prove, in clip order. A proof
  // on no video has no strip, and the composer is exactly what it was. Moving to another
  // slide saves the one left (`switchSlide`); the strip itself never writes.
  const slides = $state({
    video: null, // the video the strip is about: the ★ of the proof open, or of the scene shown
    answer: null, // what `/scenes` answered for it
    gone: false, // the video is no longer in the case
    folded: false, // the strip folded to its line, for the session
  });
  // The scene of the strip whose page stands in place of a proof: `{ video, id }`.
  let draftShown = $state(null);
  // The tile a switch heads to while the slide left is saved; more presses move it.
  let heading = $state(null);
  let switching = false;
  // Whether a slide is being opened from the strip, which keeps the strip as it stands.
  let openingSlide = $state(false);
  // The look of the slide left for a scene's page, which the slide made of it keeps.
  let lastLook = null;
  // The thumbnail the last save answered, so its tile shows it before the strip is read again.
  let savedThumb = $state(null);
  let slidesRun = 0;
  let slidesTimer = null;
  // `{ video, row, look, navigate, scene, frames, filedIds, captures, collages, capture }` while Make the proof chooses.
  let slideChooser = $state(null);
  let chooserBusy = $state(false);
  let chooserUrls = [];

  $effect(() => {
    const star = scene.star, started = proofStarted, page = draftShown;
    if (openingSlide) return;
    slides.video = started ? star : (page?.video ?? null);
  });

  $effect(() => {
    const id = caseState.current?.id, video = slides.video;
    clearTimeout(slidesTimer);
    if (!id || !video) {
      slidesRun += 1;
      slides.answer = null;
      slides.gone = false;
      return;
    }
    untrack(() => {
      // another video's tiles never stand under this one while it is read
      if (slides.answer && slides.answer.video !== video) slides.answer = null;
      readSlides(id, video);
    });
  });

  /** Read the video's scenes. A late answer, for a video or a case since left, is dropped. */
  async function readSlides(caseId = caseState.current?.id, video = slides.video, retried = false) {
    if (!caseId || !video) return;
    const run = ++slidesRun;
    try {
      const answer = await api.get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(video)}`);
      if (run !== slidesRun) return;
      slides.answer = answer;
      slides.gone = false;
    } catch (e) {
      if (run !== slidesRun || !(e.status >= 400 && e.status < 500)) return;
      // A video renamed since the proof was opened: its spec names it where it is now.
      if (!retried && savedName && proofStarted) {
        const name = savedName;
        try {
          const spec = await api.get(`/api/cases/${caseId}/proofs/${encodeURIComponent(name)}`);
          const stated = readStatedScene(spec?.scene);
          if (run === slidesRun && savedName === name && stated && stated.video !== video && scene.stated) {
            scene.stated = { ...scene.stated, video: stated.video };
            return;
          }
        } catch {
          // read as gone below
        }
      }
      if (run !== slidesRun) return;
      slides.answer = null;
      slides.gone = true;
    }
  }

  /**
   * A nudge about scenes or the scene geolocated: read again, once for a burst, when it is
   * this video's, and the open proof's scene with it when a scene moved. Geo Proof behind
   * another tool reads both when it comes back to the front, so it lets the nudge go.
   */
  function slidesNudged(event, video, { moved = false } = {}) {
    if (!slides.video || event.case_id !== caseState.current?.id) return;
    if (video && video !== slides.video) return;
    if (uiState.tool !== 'proof') return;
    clearTimeout(slidesTimer);
    slidesTimer = setTimeout(() => (moved ? rereadScenes() : readSlides()), 400);
  }
  onDestroy(onEvent('scenes', (event) => slidesNudged(event, event.video ?? null, { moved: true })));
  onDestroy(onEvent('geolocating', (event) => {
    // an end names no video: it matters to the strip only while it shows a scene geolocated
    if (event.video == null && !slides.answer?.geolocating) return;
    slidesNudged(event, event.video ?? null);
  }));
  onDestroy(() => clearTimeout(slidesTimer));

  // ---- read again: what Inspect, or another window, changed meanwhile ---------------------
  // Inspect's Scenes tab writes a proof's time through the route the Scene tab writes it
  // through. Each time Geo Proof comes back to the front, when the case moves, and on a
  // nudge, the strip and the open proof's scene are read again (`ProofScene.reread`); a
  // proof never saved follows the scene it was made from (`ProofScene.follow`). The player
  // and the tab stay where they stand, and nothing is written. A time in hand with a change
  // stays; the read is made again once it is applied or dropped.
  function rereadScenes() {
    readSlides();
    // a capture gathered by a scene meanwhile points the proof's panels at it
    readTies();
    if (proofStarted) scene.reread();
  }
  $effect(() => {
    void caseState.rev;
    if (uiState.tool !== 'proof') return;
    untrack(rereadScenes);
  });
  $effect(() => {
    if (scene.edit.scene || !scene.behind || uiState.tool !== 'proof') return;
    untrack(rereadScenes);
  });
  $effect(() => {
    void slides.answer;
    untrack(() => scene.follow());
  });

  const thumbOf = (path) => shelfThumbs.get(path) ?? null;
  const slideOpen = $derived({
    started: proofStarted,
    name: savedName,
    title: proof.title,
    draft: scene.draft,
    thumb: savedThumb?.name === savedName ? savedThumb.thumb : null,
    // what its Scene tab reads, which its tile says too
    time: sceneTime({ kind: 'proof', moments: scene.moments }),
    page: draftShown?.id ?? null,
  });
  const strip = $derived(slides.video && slides.answer?.video === slides.video
    ? slideTiles(slides.answer, slideOpen, { thumbOf })
    : []);
  const stripShown = $derived(!!slides.video && (slides.gone || strip.length > 0));
  const shownSlide = $derived(strip.find((tile) => tile.current) ?? null);
  // the scene whose page is shown, as its tile reads it
  const pageTile = $derived(draftShown && !proofStarted ? strip.find((tile) => tile.kind === 'draft' && tile.id === draftShown.id) ?? null : null);

  /** Something typed a save could not keep, since a save needs a panel. */
  const typedFacts = () => proof.points.some((one) => String(one.coords ?? '').trim())
    || !!proof.description.trim() || !!proof.when.trim();

  /**
   * Let the slide on screen go, as moving to another one does: nothing to keep goes at
   * once, a slide never started is dropped, words a save could not keep are asked
   * about, anything else is saved first. True once the composer may move on.
   */
  async function settleSlide() {
    const plan = switchPlan({
      started: proofStarted, dirty, saved: !!savedName,
      panels: proof.panels.length + proof.published.length, pastes: proof.pastes.length, facts: typedFacts(),
    });
    if (plan === 'open' || plan === 'drop') return true;
    if (plan === 'ask') return mayLeave();
    return saveSlide();
  }

  // The switch's save, settled by the overwrite question when it asks one.
  let settleSave = null;

  /**
   * The slide saved as Save proof saves it, its unchecked points kept off the map rather
   * than walked one by one. True once it landed; a refused save keeps the slide, and its
   * toast says why.
   */
  function saveSlide() {
    return new Promise((resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        if (settleSave === finish) settleSave = null;
        resolve(ok);
      };
      settleSave = finish;
      save({ checked: true, then: () => finish(true) }).then(() => {
        if (!overwritePrompt) finish(false);
      });
    });
  }

  /**
   * Move to another slide, the one left saved first. Presses while it saves only move
   * where it is heading, so three fast Alt+→ go three slides on with one save.
   */
  async function switchSlide(target) {
    if (!target || target.current) return false;
    if (switching) {
      heading = target.key;
      headingTile = target;
      return false;
    }
    switching = true;
    heading = target.key;
    headingTile = target;
    try {
      if (!(await settleSlide())) return false;
      // what the presses meanwhile pointed at, as the strip reads it now
      let next = headingTile;
      while (next) {
        headingTile = null;
        await openSlide(strip.find((tile) => tile.key === next.key) ?? next);
        next = headingTile && headingTile.key !== next.key ? headingTile : null;
      }
      return true;
    } finally {
      switching = false;
      heading = null;
      headingTile = null;
    }
  }
  let headingTile = null;

  /** The slide `step` tiles on from the one shown, or from the one a switch is heading to. */
  function stepSlide(step) {
    const target = neighbour(strip, heading ?? shownSlide?.key ?? null, step);
    if (target) switchSlide(target);
  }

  /** Open a slide: a saved proof as Open proof opens it, a scene still to prove as its page. */
  async function openSlide(tile) {
    if (tile.kind === 'proof') {
      draftShown = null;
      openingSlide = true;
      try {
        await openProof({ name: tile.name }, { navigate: false });
      } catch (error) {
        toast(`This proof cannot be opened: ${error.message}`, 'warn');
        readSlides();
      } finally {
        openingSlide = false;
      }
      return;
    }
    if (tile.kind !== 'draft') return;
    if (proofStarted) lastLook = slideStyle(proof);
    const video = slides.video;
    resetDoc();
    draftShown = { video, id: tile.id };
  }

  /** The look of a slide laid on the one just started: its style, switches, house style and signature. */
  function applyLook(look) {
    applyProofStyle(proof, look, { logo: !!sigImg, handle: !!prefs.signatureHandle?.trim() });
    proof.footerCredits = look.footerCredits === true;
    proof.sceneBadge = look.sceneBadge === true;
    color = proof.palette[0] ?? ANNO_COLORS[0];
    const template = templatesState.proof.find((t) => t.id === look.templateId);
    proof.templateId = template ? template.id : null;
    appliedTemplate = template ? { id: template.id, name: template.name, prevStyle: templateFromProof(proof) } : null;
  }

  /**
   * + New scene: the slide left saved, then a new one of the same video in its look, with
   * no panel, point or legend. It opens on the Scene tab, the player after the last moment
   * proved, where the next place is likely to show.
   */
  async function newSlide() {
    const video = slides.video;
    if (!video || switching) return;
    switching = true;
    try {
      const look = proofStarted ? slideStyle(proof) : lastLook;
      if (!(await settleSlide())) return;
      // the slide just saved may not be among the case's proofs read yet
      const left = savedName ? [proof.title] : [];
      const at = resumeAt(strip);
      resetDoc();
      draftShown = null;
      proofStarted = true;
      if (look) applyLook(look);
      proof.title = nextName('proof', [...savedProofTitles(), ...left]);
      scene.hold({ video, moments: [], draft: null });
      pickSideTab('scene');
      scene.show(video, at != null ? { at } : {});
      anchorHistory();
      requestAnimationFrame(fit);
    } finally {
      switching = false;
    }
  }

  /** A tile's menu, or the page of a scene still to prove. */
  async function slideAction(action, tile, extra = '') {
    const caseId = caseState.current?.id;
    const video = slides.video;
    if (!caseId || !video) return;
    if (action === 'inspect') {
      // the video opened on this slide's moment and its row of the Scenes tab
      uiState.inspectScene = { video, slide: tile.name };
      uiState.tool = 'inspect';
      return;
    }
    if (action === 'delete') {
      askDelete({ name: tile.name, title: tile.title, video });
      return;
    }
    if (action === 'rename') {
      await renameSlide(tile, extra);
      return;
    }
    if (action === 'make') {
      if (!pageTile || pageTile.key !== tile.key) {
        if (!(await switchSlide(tile))) return;
      }
      await chooseSlideFrames(strip.find((one) => one.key === tile.key) ?? tile);
      return;
    }
    try {
      if (action === 'geolocate') {
        await geolocateScene(caseId, { video, id: tile.id });
      } else if (action === 'abandon' && tile.kind === 'proof') {
        // a slide saved with no place yet is given up on as a scene is
        await abandonProof(caseId, tile.name, extra);
        await readSlides();
        toast('Slide abandoned', 'info', 6000, {
          label: 'Undo',
          onClick: () => restoreProof(caseId, tile.name).then(() => readSlides(), (e) => toast(e.message, 'danger')),
        });
      } else if (action === 'restore' && tile.kind === 'proof') {
        await restoreProof(caseId, tile.name);
        await readSlides();
      } else if (action === 'abandon') {
        await abandonScene(caseId, video, tile.id, extra);
        await readSlides();
        toast('Scene abandoned', 'info', 6000, {
          label: 'Undo',
          onClick: () => restoreScene(caseId, video, tile.id).then(() => readSlides(), (e) => toast(e.message, 'danger')),
        });
      } else if (action === 'restore') {
        await restoreScene(caseId, video, tile.id);
        await readSlides();
      }
    } catch (e) {
      toast(e.message, 'danger');
      readSlides();
    }
  }

  /**
   * Rename a slide from its menu, the way the name field renames a proof. The slide open
   * takes the name as if typed there, and its next save moves its files; another slide is
   * saved under it at once, its picture moving with it, as Map plate renames a plate.
   */
  async function renameSlide(tile, title) {
    const caseId = caseState.current?.id;
    const name = String(title ?? '').trim();
    if (!caseId || !name || name === (tile.row?.title ?? tile.title) || tile.kind !== 'proof') return;
    if (tile.current && proofStarted) {
      proof.title = name;
      dirty = true;
      return;
    }
    try {
      const loaded = await api.get(`/api/cases/${caseId}/proofs/${encodeURIComponent(tile.name)}`);
      const saved = await api.post(`/api/cases/${caseId}/proofs`, { title: name, spec: loaded, rename_from: tile.name });
      toast(`Renamed to ${saved?.title ?? name}`, 'ok', 1800);
      await reloadCase();
    } catch (e) {
      toast(e.status === 409 ? 'Another proof already uses that name' : e.message, 'danger');
    }
    readSlides();
  }

  /**
   * Export the slides: every proved slide's saved picture copied into one new folder in
   * the destination saved for proofs, numbered in clip order. Nothing is drawn again, so
   * the slide on screen is saved first when it holds changes.
   */
  async function exportSlides() {
    const caseId = caseState.current?.id;
    const video = slides.video;
    if (!caseId || !video || switching) return;
    if (proofStarted && dirty && hasProofCanvasContent(proof) && !(await saveSlide())) return;
    try {
      const done = await api.post(`/api/cases/${caseId}/proofs/series-export`, { video });
      const count = done.files?.length ?? 0;
      const left = (done.skipped ?? []).map((one) => one.title || one.proof);
      const words = `Exported ${count === 1 ? '1 slide' : `${count} slides`} to ${done.name}`;
      toast(left.length ? `${words} · Left out, no picture yet: ${left.join(', ')}` : words, left.length ? 'warn' : 'ok', 6000, {
        label: 'Show',
        onClick: () => api.post(`/api/cases/${caseId}/proofs/export/reveal`).catch((e) => toast(e.message, 'warn')),
      });
    } catch (e) {
      toast(`The slides were not exported: ${e.message}`, 'danger', 6000);
    }
  }

  /**
   * Post this video's slides: the placed slides as one video thread in Post, read from
   * what they saved, so the slide on screen is saved first when it holds changes.
   */
  async function postSlides() {
    const video = slides.video;
    if (!caseState.current?.id || !video || switching) return;
    if (proofStarted && dirty && hasProofCanvasContent(proof) && !(await saveSlide())) return;
    startPost('video', [video]);
  }

  /** A case file's title in Media, or '' when the case does not say one. */
  const mediaTitle = (path) => caseMedia.find((one) => one.path === path)?.title ?? '';
  /** What a case file is called in the chooser and wherever a proof names its video. */
  const fileTitle = (path) => videoName(path, mediaTitle);

  // ---- a scene's material, as Make the proof reads it -----------------------------------
  // Read once here for every surface of Geo Proof that makes the proof of a scene still to
  // prove: Make this slide on the strip, a chip of the home's To prove, and a scene picked
  // in New proof. Its frames come from the video's Inspect work, read and never written
  // (`GET /scenes/{draft}/frames`); a frame not in the case yet is drawn from the video for
  // the choice, and filed on the way.

  /**
   * What Make the proof offers of a scene: `{ frames, filedIds, captures, collages, capture }`,
   * the frames in clip order, the collages of the video holding one of its moments
   * (`collages`, the video's as `GET /scenes?video=` lists them), the captures it gathered,
   * and the frame to capture at its start when it holds no frame and no collage.
   */
  async function readSceneMaterial(caseId, video, row, collages) {
    const query = new URLSearchParams({ video });
    const { frames = [] } = await api.get(`/api/cases/${caseId}/scenes/${encodeURIComponent(row.id)}/frames?${query}`);
    const shown = frames
      .filter((f) => Number.isFinite(f?.time))
      .sort((a, b) => a.time - b.time)
      .map((f) => ({ id: String(f.id), time: f.time, path: f.path ?? null, edits: f.edits ?? {}, url: f.thumb || f.path ? fileUrl(caseId, f.thumb || f.path) : '' }));
    const mine = collagesOfScene(row, (collages ?? []).filter((c) => c.export), 0).map((c) => ({
      path: c.export, url: fileUrl(caseId, thumbOf(c.export) || c.export), title: c.title, start: c.start, current: c.current,
    }));
    const moments = sceneMoments(row);
    return {
      frames: shown,
      filedIds: new Set(shown.filter((f) => f.path).map((f) => f.id)),
      captures: (row.captures ?? []).map((path) => ({ path, url: fileUrl(caseId, thumbOf(path) || path), title: fileTitle(path) })),
      collages: mine,
      capture: shown.length || mine.length ? null : {
        time: sceneStart(row) ?? 0,
        why: moments.length === 1 && moments[0].end == null ? 'instant' : 'start',
      },
    };
  }

  /**
   * Make this slide, or a chip of the home: the scene's frames chosen as Inspect's Make the
   * proof chooses them. `look` is the look the proof made keeps (the slide's before it), and
   * `navigate` whether opening it is a step Back retraces.
   */
  async function chooseSceneFrames({ video, row, color, collages, look = null, navigate = false }) {
    const caseId = caseState.current?.id;
    if (!caseId || !video || row?.kind !== 'draft') return;
    let material;
    try {
      material = await readSceneMaterial(caseId, video, row, collages);
    } catch (e) {
      // the scene or its video went meanwhile: the strip says what is left
      toast(e.status === 404 ? 'That scene is no longer in this video' : e.message, 'warn');
      if (slides.video === video) readSlides();
      return;
    }
    slideChooser = { video, row, look, navigate, scene: { ...row, color }, ...material };
    void drawUnfiledFrames(caseId, video, material.frames, () => slideChooser?.frames);
  }

  /** Make this slide, from a tile of the strip or the page of its scene. */
  function chooseSlideFrames(tile) {
    if (tile.kind !== 'draft') return;
    return chooseSceneFrames({ video: slides.video, row: tile.row, color: tile.color, collages: slides.answer?.collages, look: lastLook });
  }

  // Inspect's sliders, read once: a frame the case does not hold yet is drawn and filed
  // through the edits Inspect keeps for it, so it comes out as Inspect would save it.
  let frameFilters = null;
  async function frameOps(edits) {
    if (!edits || !Object.keys(edits).length) return [];
    frameFilters ??= sliderFilters((await api.get('/api/inspect/ops')).filters);
    return buildFrameOps(frameFilters, edits);
  }

  /**
   * The frames the case does not hold yet, drawn from the video for a choice, a few at a
   * time. `held()` is the list shown now, whose frames take their picture as it comes.
   */
  async function drawUnfiledFrames(caseId, video, frames, held) {
    for (const frame of frames.filter((f) => !f.url).slice(0, 24)) {
      try {
        const res = await fetch(`/api/cases/${caseId}/inspect/render-preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: video, time: frame.time, ops: await frameOps(frame.edits), format: 'jpeg' }),
        });
        const shown = held();
        if (!res.ok || !shown) return;
        const url = URL.createObjectURL(await res.blob());
        chooserUrls.push(url);
        const one = held()?.find((f) => f.id === frame.id);
        if (one) one.url = url;
      } catch {
        return;
      }
    }
  }

  /** The frames of a video the case does not hold yet, filed as Inspect saves them; each takes its path. */
  async function fileFrames(caseId, video, frames) {
    const unfiled = frames.filter((f) => !f.path);
    if (!unfiled.length) return;
    const title = caseMedia.find((one) => one.path === video)?.title;
    const items = [];
    for (const f of unfiled) {
      items.push({ path: video, time: f.time, ops: await frameOps(f.edits), label: frameSaveName(sourceStem({ path: video, title }), f.time) });
    }
    const res = await api.post(`/api/cases/${caseId}/inspect/save-frames`, { items });
    unfiled.forEach((f, i) => { f.path = res?.saved?.[i]?.item?.path ?? null; });
    if (!frames.every((f) => f.path)) throw new Error('A frame could not be saved to the case');
  }

  /** Let go of the frames drawn for a choice, once nothing shows them. */
  function dropDrawnFrames() {
    for (const url of chooserUrls) URL.revokeObjectURL(url);
    chooserUrls = [];
  }

  function closeSlideChooser() {
    slideChooser = null;
    dropDrawnFrames();
  }
  onDestroy(() => { for (const url of chooserUrls) URL.revokeObjectURL(url); });

  /** The frames chosen: the ones not in the case filed, then the proof made of them, in clip order. */
  async function confirmSlideFrames(ids, capturePaths = [], collagePaths = []) {
    const chooser = slideChooser;
    const caseId = caseState.current?.id;
    if (!chooser || chooserBusy || !caseId) return;
    chooserBusy = true;
    try {
      const frames = chooser.capture
        ? [{ id: 'start', time: chooser.capture.time, path: null }]
        : chooser.frames.filter((f) => ids.includes(f.id)).map((f) => ({ ...f }));
      await fileFrames(caseId, chooser.video, frames);
      const collages = chooser.collages.filter((c) => collagePaths.includes(c.path));
      const panels = [
        ...frames.map((f) => ({ at: f.time, path: f.path })),
        ...collages.map((c) => ({ at: c.start, path: c.path })),
      ].sort((a, b) => a.at - b.at).map((p) => p.path);
      closeSlideChooser();
      await makeSceneProof(proofHandoff(chooser.row, chooser.video, [...panels, ...capturePaths]), { look: chooser.look, navigate: chooser.navigate });
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      chooserBusy = false;
    }
  }

  // ---- the header ---------------------------------------------------------------------
  // Its own width, read for its compact forms, set for a proof with changes in its widest
  // state: under the first the secondary buttons show as icons, under the second the name
  // narrows, Save proof says Save and the unsaved badge keeps its dot, so Save and To Post
  // stay whole beside the case panel on a 1024 px screen.
  const HEADER_COMPACT = 1030;
  const HEADER_TIGHT = 800;
  let headerW = $state(0);

  // ---- the side column's tabs (proof/sideTabs.js) ----------------------------------
  // A new proof opens on Layout and one made from a scene on Proof, its facts still to
  // fill; opening another keeps the tab in use. The tool stays mounted for the session, so this is that
  // memory, and nothing writes it to disk.
  let sideTab = $state('proof');
  const sideTabList = $derived(sideTabs(scene.videos.length > 0));
  const sideShown = $derived(shownTab(sideTab, scene.videos.length > 0));
  // the blanks the Proof tab's fields mark with a `!`, said on its label as well
  const proofTabNeeds = $derived(
    needsWords(proofNeeds({ coords: !!displayedCoords, source: !!displayedSource, when: proof.when })),
  );

  function pickSideTab(id) {
    // leaving the scene keeps a time that reads as one, as leaving a row of Inspect's Scenes tab does
    if (sideShown === 'scene' && id !== 'scene') scene.leaveTime();
    sideTab = id;
  }

  /** A panel's ▶ on the canvas: its video's player, on its frame. */
  function playPanelScene(frame) {
    if (frame.video !== scene.star) scene.leaveTime();
    pickSideTab('scene');
    scene.show(frame.video, { at: frame.time });
  }

  /** Add this frame: the frame on the player saved to the case as Inspect saves one, then a panel. */
  async function addSceneFrame(video, time) {
    const c = caseState.current;
    if (!c || scene.adding) return;
    scene.adding = true;
    try {
      const title = caseMedia.find((one) => one.path === video)?.title;
      const res = await api.post(`/api/cases/${c.id}/inspect/save-frames`, {
        items: [{ path: video, time, label: frameSaveName(sourceStem({ path: video, title }), time) }],
      });
      const path = res?.saved?.[0]?.item?.path;
      if (!path) throw new Error('the case did not keep it');
      await refreshCaseMedia(c.id);
      await addPanelsFromPaths([path]);
      toast(`Frame at ${preciseClock(time)} added as a panel`, 'ok', 2600);
    } catch (e) {
      toast(`The frame could not be added: ${e.message}`, 'danger');
    } finally {
      scene.adding = false;
    }
  }

  /**
   * Make the proof of a scene kept in Inspect: a new proof of its frames, in order,
   * named after it, its time held for the first save. It opens on the Proof tab, the
   * facts being what is left to do, its player ready on the Scene tab where it starts.
   * A picture marked to geolocate states no time: its proof lays out the picture and
   * the captures gathered for it, and that alone proves it.
   *
   * `template` is the house style New proof chose for it ('' for none), in place of the
   * look of the slide before or the default. True once the proof is open.
   *
   * Pictures a map tab sends while a scene is geolocated (`handoff.join`, `lib/toGeoProof.js`)
   * join the proof open when it already holds that scene, or lays out that picture.
   */
  async function makeSceneProof(handoff, { look = null, navigate = true, template = undefined } = {}) {
    const made = readHandoff(handoff);
    if (!made) return false;
    const holding = made.scene ? !!made.scene.draft && scene.draft === made.scene.draft : proof.panels.some((p) => p.src === made.panels[0]);
    if (handoff.join && proofStarted && holding) {
      await readCaseMedia(caseState.current.id);
      await addPanelsFromPaths(made.panels, { media: caseMedia });
      return true;
    }
    // On the video of the slide open, that slide is saved as moving to the next one saves
    // it; any other proof with changes asks first, as it always did.
    const onSlides = proofStarted && !!made.scene?.video && made.scene.video === scene.star;
    // a new slide of the same video keeps the look of the slide before it, wherever it was asked
    look ??= onSlides && template === undefined ? slideStyle(proof) : null;
    if (!(await (onSlides ? settleSlide() : mayLeave()))) return false;
    resetDoc();
    proofStarted = true;
    if (template !== undefined) {
      const chosen = templatesState.proof.find((t) => t.id === template);
      if (chosen) applyTemplate(chosen, { notify: false });
    } else if (look) applyLook(look);
    else applyDefaultTemplate();
    pickSideTab('proof');
    settlePlace('proof', place(), { navigate });
    if (made.title) proof.title = made.title;
    if (made.scene) scene.hold(made.scene);
    // the frames were filed a moment ago, so the case's media is read again first
    await readCaseMedia(caseState.current.id);
    await addPanelsFromPaths(made.panels, { media: caseMedia });
    dirty = true;
    anchorHistory();
    if (made.scene) scene.show(made.scene.video);
    requestAnimationFrame(fit);
    return true;
  }

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
  let calloutTail = $state('leader'); // how the next callout reaches its point
  let lineStyle = $state('solid'); // how the next line is drawn: solid, dash or dot
  // The lens the next view cone opens to: a phone's main camera, held landscape.
  let coneLens = $state('1');
  let coneUpright = $state(false);
  let coneBadge = $state(CONE_BADGE); // how big the next cone's camera is drawn
  let guide = $state(null); // null | '16:9' | '4:5' — tweet centre-crop overlay
  // The picked annotations. A press replaces the set, shift adds to it, and a
  // marquee dragged over the page takes everything it touches. Panels, overlays
  // and the signature stay single: each is one object, not a family.
  let selectedIds = $state([]);
  let selectedPanelId = $state(null); // free-layout only: panel picked for move/resize
  let selectedPasteId = $state(null); // pasted image picked for move/resize/frame
  let selectedSig = $state(null); // null | 'logo' | 'text' — signature picked for resize; 'footer' for its text
  let picker = $state(false);
  let pickerItems = $state([]);
  let newProofOpen = $state(false);
  // Importing a published proof is a third way into the same tool, beside
  // composing one and opening a saved one. It writes a proof like any other, so
  // the only thing this screen owns is the door — and that door is in the New
  // proof dialog rather than the toolbar, which has no room left for a button.
  let importOpen = $state(false);
  // `{ row, view }` while one point is being moved on the map, else null.
  let pointMap = $state(null);
  let newProofTemplateId = $state('');
  let newProofLoading = $state(false);
  let creatingProof = $state(false);
  let replaceWithNewConfirm = $state(false);
  // What New proof asked for, held while the replace question is answered: `{ keys, empty }`.
  let newProofPlan = null;
  // The scene picked in New proof, `{ entry, material }`, its material read as Make the proof reads it.
  let newProofScene = $state(null);
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
  // The video the list is narrowed to, '' for every proof (`lib/proofList.js`).
  let proofVideo = $state('');
  const listVideos = $derived(proofVideos(openList ?? []));
  const visibleProofs = $derived((openList ?? []).filter((entry) => inVideo(entry, proofVideo) && matchesProofQuery(entry, proofQuery)));
  const proofBrowserEntries = $derived(
    (openList ?? []).filter((entry) => inVideo(entry, proofVideo))
      .map((entry) => ({ ...entry, id: entry.name, attrs: { folder: entry.folder ?? '' } }))
  );
  let saving = $state(false);
  let proofFor = $state(undefined);

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

  /**
   * Attach a source image to a spec surface. `natural` becomes the upright box
   * the turned image occupies, because that is what the page lays out; the
   * source size it was read from is kept beside it.
   */
  function hydratedSurface(surface, img) {
    const sourceNatural = sourceSize(surface.sourceNatural ?? surface.natural);
    const crop = normalizeSourceCrop(surface.crop, sourceNatural);
    const rotation = normalizeSurfaceAngle(surface.rotation);
    const hydrated = {
      ...surface,
      sourceNatural,
      crop,
      rotation,
      // an upright cut, which a surface with a crop never has
      cut: crop ? null : fitSurfaceCut(surface.cut, sourceNatural),
      img,
    };
    refreshSurface(hydrated);
    return hydrated;
  }

  /** Re-measure one hydrated surface after its crop, cut or turn changes. */
  function refreshSurface(surface) {
    surface.natural = surfaceBoxSize(surface.sourceNatural, surface.crop, surface.rotation, surface.cut);
  }

  /** The pixels a surface draws: its crop, or the whole source. */
  const imageSizeOf = (surface) => surfaceImageSize(surface.sourceNatural, surface.crop);

  const docSnapshot = () => JSON.stringify(toSpec(proof));

  function syncHist() {
    canUndo = history.canUndo;
    canRedo = history.canRedo;
  }

  function anchorHistory() {
    clearTimeout(histTimer);
    history.reset(docSnapshot());
    syncHist();
    // another proof, or a fresh one: a paste of marks copied before lands as into another proof
    docKey += 1;
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
    proof.footerCredits = spec.footerCredits === true;
    proof.sceneBadge = spec.sceneBadge === true;
    proof.sources = statedSources(spec.sources ?? spec.source ?? null);
    proof.when = typeof spec.when === 'string' ? spec.when : '';
    proof.whenZone = typeof spec.whenZone === 'string' && spec.whenZone ? spec.whenZone : null;
    proof.description = typeof spec.description === 'string' ? spec.description : '';
    proof.material = normalizeMaterial(spec.material);
    proof.captionSize = style.captionSize;
    proof.legendSize = style.legendSize;
    proof.footerSize = style.footerSize;
    proof.footer = style.footer;
    proof.footerEnabled = style.footerEnabled;
    proof.footerColor = style.footerColor;
    proof.captionColor = style.captionColor;
    proof.footerAlign = style.footerAlign;
    proof.captionsEnabled = style.captionsEnabled;
    proof.font = style.font;
    proof.fontBold = style.fontBold;
    proof.bg = style.bg;
    proof.space = style.space;
    proof.layout = style.layout;
    proof.panelDirection = style.panelDirection;
    proof.signature = style.signature;
    proof.signatureText = style.signatureText;
    proof.azimutMark = style.azimutMark;
    // The colour in hand is not part of the document, so a step back keeps it.
    // Only a step across a template, which changes the palette, takes its first
    // colour the way applying the template did.
    if (proof.palette.join() !== style.palette.join()) color = style.palette[0];
    proof.palette = style.palette;
    proof.notes = spec.notes ?? {};
    proof.legendOrder = spec.legendOrder ?? [];
    proof.templateId = typeof spec.templateId === 'string' ? spec.templateId : null;
    proof.panels = spec.panels.map((p) => {
      const img = imgCache.get(p.src);
      return img ? hydratedSurface(p, img) : hydratedSurface(p, null);
    });
    proof.pastes = (spec.pastes ?? []).map((p) => {
      return hydratedSurface(p, pasteAssets.get(p.asset)?.img ?? null);
    });
    proof.published = (spec.published ?? []).map((p) => hydratedSurface(p, pasteAssets.get(p.asset)?.img ?? null));
    proof.shapes = spec.shapes ?? [];
    // a panel image missing from the cache (shouldn't happen) reloads async
    for (const p of proof.panels.filter((x) => !x.img)) {
      loadImage(fileUrl(caseState.current?.id, p.src))
        .then((img) => {
          imgCache.set(p.src, img);
          Object.assign(p, hydratedSurface(p, img));
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
    // A page zoomed into to draw a detail stays where it was; one still fitted
    // to the window is fitted again, in case the step changed its size.
    if (viewFitted) requestAnimationFrame(fit);
    // outlast the capture debounce so the restore itself is not re-recorded
    setTimeout(() => (histBusy = false), 400);
  }

  /** Mid-curve, a step back takes the last corner off rather than the curve and the mark before it. */
  function stepBackPath() {
    pathDraft.points.splice(-2);
    if (!pathDraft.points.length) { finishPath(false); return; }
    pathDraft.node.points([...pathDraft.points]);
    docLayer.batchDraw();
  }

  function undo() {
    if (pathDraft) { stepBackPath(); return; }
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
  let stage, docLayer, uiLayer, transformer, cropHandles, endHandles, guideGroup, panelCtrls, scenePlays;
  let rotateKnob;
  let landingGuide; // the outline of where a dragged mark will belong
  let canvasRenderGate;
  let drawing = null; // {panel, node, start, box, kind}
  let pathDraft = null; // {panel, box, node, points:[]} — multi-click curve in progress
  let dragMoved = false; // did the press that is ending turn into a drag?
  let marquee = null; // {start, add, base, node} — rectangle picking over the page
  let marqueeEnded = false; // did the press that is ending draw a marquee?
  let spacePan = false; // hold-space panning (manual, so it wins over shape drags)
  let panDrag = null; // {sx, sy, ox, oy} — space/middle-drag pan in progress
  let viewFitted = true; // the page as Fit left it, before any zoom or pan of the analyst's
  let gestureSeq = 0; // bumped by every press, so a deferred settle can tell whose
  let textEdit = $state(null); // {id, value, left, top, size} — inline text editor

  onMount(() => {
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
      rotateAnchorOffset: 28,
      rotationSnaps: [0, 90, 180, 270],
      rotationSnapTolerance: 5,
      flipEnabled: false,
      // Collage's handles, so a mark is pulled the same way in both tools: accent
      // discs on the corners, accent squares on the sides, ringed dark so they
      // hold up over bright imagery.
      anchorSize: 13,
      anchorCornerRadius: 2,
      anchorStroke: HANDLE_RING,
      anchorStrokeWidth: 2,
      anchorFill: ACCENT,
      borderStroke: ACCENT,
      borderDash: [4, 3],
      ignoreStroke: true,
      // The turn knob reads like Collage's too: a dark disc ringed in the accent,
      // on a short accent stem.
      anchorStyleFunc: (anchor) => {
        if (anchor.hasName('rotater')) {
          anchor.cornerRadius(anchor.width() / 2);
          anchor.fill('rgba(22, 22, 22, 0.92)');
          anchor.stroke(ACCENT);
          anchor.strokeWidth(1.5);
        } else if (/(top|bottom)-(left|right)/.test(anchor.name())) {
          anchor.cornerRadius(anchor.width() / 2);
        }
      },
    });
    // A cut picture turning under its square cut has no frame to show: Konva's
    // would tilt with the turn while the cut stays put. The knob carries on alone
    // and the frame comes back with the next selection drawn.
    let frameHidden = false;
    transformer.on('transformstart', () => {
      if (transformer.getActiveAnchor() !== 'rotater' || !transformer.nodes()[0]?.hasName('surface-cut')) return;
      frameHidden = true;
      transformer.borderEnabled(false);
      transformer.enabledAnchors([]);
    });
    // a knob let go where it started changes nothing, and redraws nothing either
    transformer.on('transformend', () => {
      if (!frameHidden) return;
      frameHidden = false;
      requestAnimationFrame(() => { if (stage) refreshCanvasUi(); });
    });
    guideGroup = new Konva.Group({ listening: false });
    uiLayer.add(guideGroup);
    uiLayer.add(transformer);
    rotateKnob = new Konva.Group({ name: 'rotate-knob', listening: false });
    uiLayer.add(rotateKnob);
    cropHandles = new Konva.Group({ id: 'proof-crop-handles' });
    uiLayer.add(cropHandles);
    endHandles = new Konva.Group();
    uiLayer.add(endHandles);
    panelCtrls = new Konva.Group();
    uiLayer.add(panelCtrls);
    scenePlays = new Konva.Group({ name: 'scene-plays' });
    uiLayer.add(scenePlays);
    landingGuide = new Konva.Group({ listening: false });
    uiLayer.add(landingGuide);

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
    // A mark being dragged says where it will belong once let go, when that is
    // somewhere new. Handles draw their own (see drawLinkHandles), so only a
    // mark's own drag answers here.
    stage.on('dragstart', (event) => {
      const s = proof.shapes.find((x) => x.id === event.target.id());
      if (s && outsideOwnPicture(s)) pinnedOut.add(s.id);
    });
    stage.on('dragmove', (event) => {
      const s = proof.shapes.find((x) => x.id === event.target.id());
      if (s) showLanding(landingOfDrag(s, event.target));
    });
    stage.on('dragend', (event) => {
      pinnedOut.delete(event.target.id());
      showLanding(null);
    });

    // The release can happen outside the canvas. Capture it at window level so
    // a deferred rebuild is never left waiting after an interrupted drag, and
    // so a gesture the browser stopped reporting is ended rather than left
    // running against the pointer.
    const closeStranded = () => {
      if (stage) closeStrandedGesture({ transformer, stage, isDragging: () => Konva.isDragging() });
    };
    // The wheel button moves the view and nothing else. Konva lets it drag a mark
    // as well, so a mark under the pointer slid along with the pan. That setting
    // is one for every canvas in the app, so it is narrowed for a press that
    // starts here, before Konva hears of it, and given back at the release.
    const dragButtons = [...Konva.dragButtons];
    const beginPointer = (event) => {
      // a press is tested against the page on screen, never one rebuilt a frame ago
      if (hitStale && docLayer) {
        hitStale = false;
        docLayer.drawHit();
      }
      if (event.button === 1) Konva.dragButtons = dragButtons.filter((b) => b !== 1);
      closeStranded(); // a new press proves the last gesture is over, however it ended
      gestureSeq += 1;
      canvasRenderGate?.beginPointer();
    };
    const settlePointer = () => {
      Konva.dragButtons = dragButtons;
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
    containerEl.addEventListener('dblclick', onCanvasDblClick);
    containerEl.addEventListener('contextmenu', onCanvasContextMenu);
    window.addEventListener('pointerup', settlePointer, true);
    window.addEventListener('pointercancel', settlePointer, true);
    window.addEventListener('blur', settlePointer);

    return () => {
      resize.disconnect();
      containerEl.removeEventListener('pointerdown', beginPointer, true);
      containerEl.removeEventListener('dblclick', onCanvasDblClick);
      containerEl.removeEventListener('contextmenu', onCanvasContextMenu);
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
      requestOpenProof({ name });
    }
  });

  // consume a "make the proof" handoff from a scene of Inspect
  $effect(() => {
    if (uiState.tool === 'proof' && uiState.proofScene && caseState.current) {
      const handoff = uiState.proofScene;
      uiState.proofScene = null;
      untrack(() => makeSceneProof(handoff));
    }
  });

  // ---- leaving a proof that holds unsaved changes --------------------------
  // Opening another proof, from the list, the sidebar or Back, asks first when this
  // one has changes not saved, so nothing is dropped without the analyst saying so.
  let leaving = $state(null); // { answer(ok) }
  function mayLeave() {
    if (!proofStarted || !dirty) return Promise.resolve(true);
    leaving?.answer(false);
    return new Promise((resolve) => {
      leaving = {
        answer: (ok) => {
          leaving = null;
          resolve(ok);
        },
      };
    });
  }
  // The proof being opened, named on the canvas while its pictures load: the list goes
  // at once rather than standing frozen until the last picture arrives.
  let openingTitle = $state(null);
  let openingRun = 0;
  async function requestOpenProof(entry) {
    if (!(await mayLeave())) return;
    const mine = ++openingRun;
    openList = null;
    openingTitle = proofLabel(entry);
    try {
      await openProof(entry);
    } catch (e) {
      toast(`This proof cannot be opened: ${e.message}`, 'warn');
    } finally {
      if (mine === openingRun) openingTitle = null;
    }
  }

  // Where the composer is, in the address: the saved proof open, or none. Opening a
  // proof, starting a new one and going home are the steps Back retraces; a save
  // naming the proof or a rename only rewrite the step it is on.
  const place = () => ({ proof: savedName });
  $effect(() => settlePlace('proof', place()));
  onDestroy(onBackForward('proof', async (to) => {
    const target = to.proof ?? null;
    if (target === savedName) return true;
    if (!(await mayLeave())) return false;
    if (!target) {
      resetDoc();
      return true;
    }
    try {
      await openProof({ name: target });
    } catch (error) {
      toast(`This proof cannot be opened: ${error.message}`, 'warn');
    }
    return true;
  }));
  onDestroy(holdsUnsaved('proof', () => proofStarted && dirty));

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
      if (tool !== 'select' && cropSurfaceId) endSurfaceCrop();
      syncCanvasListening();
      if (proofHasContent) refreshCanvasUi();
    });
  });

  // Rebuild only when published document content changes. Selection is UI-only
  // and gets a lightweight refresh below, without recreating every image node.
  // What the page draws is its signature: asked again with the same one, as a case
  // read again after a save hands over equal values in new objects, the gate skips
  // the rebuild rather than replace every node a press about to land would hit.
  $effect(() => {
    const signature = JSON.stringify([
      proof.panels.map((p) => [
        p.src, p.caption, p.row, p.scale, p.x, p.y, p.frame,
        p.crop, p.cut, p.rotation, p.natural, pictureId(p.img),
      ]),
      proof.pastes.map((p) => [
        p.asset, p.x, p.y, p.scale, p.frame,
        p.crop, p.cut, p.rotation, p.natural, pictureId(p.img),
      ]),
      proof.published.map((p) => [p.asset, p.natural, !!p.img]),
      proof.shapes,
      proof.notes,
      proof.legendOrder,
      proof.captionSize, proof.legendSize, proof.footerSize, proof.footer,
      proof.footerEnabled, proof.footerColor,
      proof.footerAlign, proof.captionColor,
      // the plate prints these when asked, and printing them changes its height:
      // both have to reach the rebuild, or the picture lags a line behind
      proof.footerCoords, proof.footerText, proof.footerCredits, proof.points,
      // the scene's badges are drawn on the picture, so a change of time redraws it
      [...badges],
      proof.bg, proof.space,
      proof.layout,
      proof.panelDirection,
      proof.signature,
      proof.signatureText,
      proof.azimutMark,
      pictureId(sigImg), // the logo lands async — redraw once it does
      prefs.signatureHandle, // Settings can change the rendered handle live
    ]);
    if (stage) canvasRenderGate?.requestRebuild(signature);
  });

  $effect(() => {
    selectedIds;
    selectedPanelId;
    selectedPasteId;
    selectedSig;
    guide;
    tool;
    sceneFrames;
    scene.star;
    prefs.proofScenePlays;
    if (stage) canvasRenderGate?.requestUi();
  });

  // Text-size options threaded into every layout/size computation.
  const textSizes = () => ({
    captionSize: proof.captionSize,
    legendSize: proof.legendSize,
    footerSize: proof.footerSize,
    footerEnabled: proof.footerEnabled !== false,
  });
  const textOpts = () => ({ ...textSizes(), footerLines: printedFooter().length });

  /** The footer's lines as the page prints them, its credit line cut to the page's width. */
  function printedFooter() {
    return proof.footerEnabled !== false ? footerLines(proof, prefs.coordFormat, cutCredit) : [];
  }

  // The last credit line cut, kept: the page is measured far more often than its credits change.
  let creditCut = { key: '', lines: [] };
  /**
   * The credit line in the lines the page's width holds, in the footer's own type:
   * a long list of credits goes on below rather than being cut short (lib/creditLines.js).
   * The width is the page's without its footer, which never widens it.
   */
  function cutCredit(text) {
    const { width } = docSize(
      proof.panels, proof.shapes, proof.notes, { ...textSizes(), footerEnabled: false }, proof.legendOrder,
      proof.layout, proof.space, freeExtent(proof.shapes, inkHelpers),
    );
    const room = width - normSpace(proof.space).pad * 2;
    const fontSize = proof.footerSize ?? FOOTER_SIZE;
    const key = `${fontSize}|${proofFace()}|${room}|${text}`;
    if (creditCut.key !== key) {
      const probe = new Konva.Text({ text: ' ', fontSize, fontFamily: proofFace() });
      const lines = creditLines(text, room, (line) => {
        probe.text(line);
        return probe.width();
      });
      probe.destroy();
      creditCut = { key, lines };
    }
    return creditCut.lines;
  }

  // Layout boxes + document measure for the active layout mode. Pasted images
  // are deliberately absent from the measure: the panels alone size the
  // document, so moving a paste can never change the export.
  const boxesOf = () => layoutPanels(proof.panels, proof.captionSize, proof.layout, proof.space);
  // The pictures front→back, then the page itself, which takes the marks drawn
  // free of any picture (see lib/freeMarks.js). The zoom insets' enlargements come
  // first, since they are drawn over every picture, and take the marks drawn over
  // them (see lib/insetMarks.js).
  function surfacesOf() {
    if (!hasProofCanvasContent(proof)) return surfaces(proof);
    const { width, height } = measureDoc();
    const pictures = surfaces(proof);
    const pictureFrame = (id) => {
      const entry = pictures.find((x) => x.id === id);
      return entry ? surfaceFrame(entry) : null;
    };
    return [...insetSurfaces(proof.shapes, pictureFrame, width, height), ...pictures, pageEntry(width, height)];
  }
  // The proof's typeface, and the weight a mark's words are set in.
  const proofFace = () => fontStack(proof.font);
  const markWeight = () => (proof.fontBold === false ? 'normal' : 'bold');

  // A canvas does not wait for a font: a word measured before its face arrived
  // keeps the fallback's width. So the page is drawn again once the face is in,
  // and an export waits for it.
  let fontReady = Promise.resolve();
  $effect(() => {
    const face = proof.font;
    fontReady = loadProofFont(face).then(() => {
      if (stage && face === proof.font) rebuild();
    });
  });

  // A published picture is the page, at its own size: no legend, footer or margin grows it.
  const measureDoc = () => (isPublishedProof(proof)
    ? { ...publishedPage(proof.published), legend: [], cols: 1 }
    : docSize(
      proof.panels, proof.shapes, proof.notes, textOpts(), proof.legendOrder, proof.layout, proof.space,
      freeExtent(proof.shapes, inkHelpers),
    ));
  // Whether the open proof is a picture as published, which the side column and the
  // toolbar read to leave out what cannot apply to it.
  const asPublished = $derived(isPublishedProof(proof));

  // What sizing a free mark takes: a label's words measured in the proof's face,
  // and the frames of the pictures a line's ends hold to. Read off the pictures
  // alone, since the page's own frame is what is being measured.
  const inkHelpers = {
    measure: (s) => {
      const fontSize = s.fontSize ?? 28;
      const probe = new Konva.Text({ text: s.text || ' ', fontSize, fontFamily: proofFace(), fontStyle: markWeight() });
      const pad = s.frame || s.bg ? textBoxPad(fontSize) * 2 : 0;
      const size = { w: probe.width() + pad, h: probe.height() + pad };
      probe.destroy();
      return size;
    },
    frameOf: (id) => {
      const entry = surfaces(proof).find((x) => x.id === id);
      return entry ? surfaceFrame(entry) : null;
    },
  };

  function resetDoc() {
    proof.title = freshTitle();
    proof.panels = [];
    proof.pastes = [];
    proof.published = [];
    discardSurfaceCrop();
    proof.shapes = [];
    proof.notes = {};
    proof.legendOrder = [];
    proof.templateId = null;
    proof.points = [blankPoint()];
    proof.sources = null;
    proof.when = '';
    proof.whenZone = null;
    proof.description = '';
    proof.material = [];
    proof.captionSize = CAPTION_SIZE;
    proof.legendSize = LEGEND_SIZE;
    proof.footerSize = FOOTER_SIZE;
    proof.footer = '';
    proof.footerEnabled = true;
    proof.footerCoords = false;
    proof.footerText = true;
    proof.footerCredits = false;
    proof.sceneBadge = false;
    proof.footerColor = null;
    proof.captionColor = null;
    proof.footerAlign = 'left';
    proof.captionsEnabled = true;
    proof.font = DEFAULT_PROOF_FONT;
    proof.fontBold = true;
    proof.bg = BG;
    proof.space = { pad: PAD, gap: GAP, rowGap: ROW_GAP };
    proof.layout = 'grid';
    proof.panelDirection = 'horizontal';
    proof.signature = null;
    proof.signatureText = null;
    proof.azimutMark = null;
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
    scene.reset();
    draftShown = null;
    anchorHistory();
  }

  /**
   * Back to the home, the proofs of the case. Changes not saved are asked about first, as
   * opening another proof asks; a proof with none goes at once. It is a step Back retraces,
   * so the browser's Back from the home opens the proof again, as last saved.
   */
  async function backToHome() {
    if (!(await mayLeave())) return;
    openRun += 1;
    resetDoc();
    settlePlace('proof', place(), { navigate: true });
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
    // so No template always walks back to the pre-template style, not the last one.
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

  /** The template Settings marks as the default, laid on a proof just started, when there is one. */
  function applyDefaultTemplate() {
    const template = defaultProofTemplate(templatesState.proof, prefs.proofTemplate);
    if (template) applyTemplate(template, { notify: false });
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
      // the wheel button is the view's, and picks nothing (see beginPointer)
      if (tool !== 'select' || (e.evt.button ?? 0) !== 0) return;
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
    endSurfaceCrop();
    selectedSig = which;
    selectedIds = [];
    selectedPanelId = null;
    selectedPasteId = null;
  }

  function selectPaste(id) {
    if (tool !== 'select') return;
    if (cropSurfaceId && cropSurfaceId !== id) endSurfaceCrop();
    selectedPasteId = id;
    selectedIds = [];
    selectedPanelId = null;
    selectedSig = null;
  }

  function selectPanel(id) {
    if (tool !== 'select' || marqueeEnded) return;
    if (cropSurfaceId && cropSurfaceId !== id) endSurfaceCrop();
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
    endSurfaceCrop();
    pickShape(id, additive);
  }

  /** Clicking the lit row again lets go, which is how the thumbnails read. */
  function pickPanelRow(id) {
    tool = 'select';
    marqueeEnded = false;
    if (cropSurfaceId !== id || selectedPanelId === id) endSurfaceCrop();
    selectedPanelId = selectedPanelId === id ? null : id;
    selectedPasteId = null;
    selectedIds = [];
    selectedSig = null;
  }

  function pickPasteRow(id) {
    tool = 'select';
    if (cropSurfaceId !== id || selectedPasteId === id) endSurfaceCrop();
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
    // Where each picture comes from, for New proof's sources (`lib/newProof.js`): a frame
    // or a collage of one video knows the video and the instant, read as the server reads it.
    const byPath = new Map(media.map((m) => [m.path, m]));
    // Newest first, across both halves at once. Each list arrives in that order
    // already, so concatenating them filed every capture above every photo — the
    // picker is opened for the frame cut a minute ago, and a proof of a strike is
    // built out of whichever of the two came in last.
    return sortItems(
      dedupeBySrc([
        ...sats.map((s) => ({
          ...satPanelInput(s, prefs.coordFormat),
          label: `${fmtCoords(s.lat, s.lon)} · z${s.zoom}`,
          ...panelPreview(s),
          kind: isSatelliteMedia(s) ? 'satellite' : 'media',
          sourceType: s.source?.type ?? 'satellite',
          origin: null,
          collage: false,
          folder: s.folder ?? '',
          added_at: s.added_at ?? s.fetched_at ?? '',
        })),
        ...media
          .filter((m) => m.kind === 'image' && !captured.has(m.path))
          .map((m) => ({
            ...mediaPanelInput(m, media),
            label: m.title || m.filename,
            ...panelPreview(m),
            kind: 'media',
            sourceType: m.source?.type ?? '',
            origin: frameOrigin(m, byPath),
            collage: m.source?.op === 'collage',
            folder: m.folder ?? '',
            added_at: m.added_at ?? '',
          })),
      ]),
      'newest'
    );
  }

  async function openNewProofDialog() {
    // the default template, preselected while it still exists
    newProofTemplateId = defaultProofTemplate(templatesState.proof, prefs.proofTemplate)?.id ?? '';
    newProofScene = null;
    pickerItems = [];
    newProofOpen = true;
    newProofLoading = true;
    // the scenes still to prove, listed under the sources when the case has some
    const caseId = caseState.current?.id;
    if (caseId) void ensureSceneQueue(caseId);
    try {
      pickerItems = await fetchPanelItems();
    } catch (e) {
      toast(`Could not load case images: ${e.message}`, 'danger');
    } finally {
      newProofLoading = false;
    }
  }

  function closeNewProof() {
    newProofOpen = false;
    newProofScene = null;
    dropDrawnFrames();
  }

  // The queue is kept in step while New proof or the home shows its scenes.
  $effect(() => {
    if (!newProofOpen && !(homeShown && uiState.tool === 'proof')) return;
    return holdSceneQueue();
  });
  const queueFiles = $derived(sceneQueue.caseId === caseState.current?.id ? sceneQueue.files ?? [] : []);
  const live = $derived(geolocating.caseId === caseState.current?.id ? geolocating.scene : null);
  const newProofScenes = $derived(scenesToProve(queueFiles, live));

  // ---- the home: what Geo Proof shows with no proof open ---------------------------------
  // The last proofs saved, the search, and the scenes still to prove (`proof/ProofHome.svelte`).
  // It opens on the list read last while one read brings it up to date (`GET /proofs`, the
  // list Open proof reads too), read again when the case moves.
  const homeShown = $derived(!proofStarted && !draftShown);
  let homeProofs = $state(null);
  let homeFor = null;
  let homeRun = 0;
  const homeFiles = $derived(openScenes(queueFiles));
  $effect(() => {
    const id = caseState.current?.id;
    void caseState.rev;
    if (!homeShown || uiState.tool !== 'proof') return;
    untrack(() => {
      if (!id) {
        homeProofs = [];
        return;
      }
      if (homeFor !== id) homeProofs = null;
      homeFor = id;
      void ensureSceneQueue(id);
      readHomeProofs(id);
    });
  });

  async function readHomeProofs(caseId) {
    const run = ++homeRun;
    try {
      const list = await api.get(`/api/cases/${caseId}/proofs`);
      if (run === homeRun && homeFor === caseId) homeProofs = list;
    } catch {
      if (run === homeRun && homeFor === caseId) homeProofs ??= [];
    }
  }

  /**
   * A chip of the home's To prove: Make the proof of that scene, as from Inspect. A video's
   * scene chooses its frames first; a picture's proof lays the picture and its captures out.
   */
  async function makeFromHome(file, row) {
    const caseId = caseState.current?.id;
    if (!caseId) return;
    if (file.kind === 'image' || row.file_kind === 'image') {
      await makeSceneProof(pictureHandoff(row, file.video, row.captures ?? []));
      return;
    }
    let collages = [];
    try {
      collages = (await api.get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(file.video)}`))?.collages ?? [];
    } catch {
      // its collages are only offered: the frames are read below, and say if the scene went
    }
    await chooseSceneFrames({ video: file.video, row: { ...row, video: file.video }, color: queueColor(row), collages, navigate: true });
  }

  /**
   * A scene picked in New proof: its material, read as Make the proof reads it, the
   * frames not in the case yet drawn for the choice. A picture marked to geolocate brings
   * itself and the captures gathered for it.
   */
  async function readNewProofScene(entry) {
    const caseId = caseState.current?.id;
    if (!caseId) return null;
    newProofScene = { entry, material: null };
    const captured = (paths) => (paths ?? []).map((path) => ({ path, url: fileUrl(caseId, thumbOf(path) || path), title: fileTitle(path) }));
    try {
      let material;
      if (entry.picture) {
        const [picture] = captured([entry.video]);
        material = { picture, frames: [], collages: [], captures: captured(entry.row.captures), capture: null };
      } else {
        const answer = await api.get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(entry.video)}`);
        material = await readSceneMaterial(caseId, entry.video, entry.row, answer?.collages);
        if (material.capture) material.startFrame = { id: 'start', time: material.capture.time, path: null, url: '' };
      }
      if (newProofScene?.entry.key !== entry.key) return null;
      newProofScene.material = material;
      const held = () => {
        const now = newProofScene?.entry.key === entry.key ? newProofScene.material : null;
        return now ? (now.startFrame ? [now.startFrame] : now.frames) : null;
      };
      const drawn = held();
      if (drawn) void drawUnfiledFrames(caseId, entry.video, drawn, held);
      return newProofScene.material;
    } catch {
      return null;
    }
  }

  /** Create proof, from New proof: `keys` the pictures in panel order, `scene` the one it takes up. */
  function requestNewProofCreation({ keys = [], scene: entry = null } = {}) {
    if (creatingProof) return;
    // a proof of a scene asks through Make the proof's own question, or saves the slide open
    if (entry) {
      void createSceneProof(keys, entry);
      return;
    }
    newProofPlan = { keys };
    if (proofStarted && dirty) {
      replaceWithNewConfirm = true;
      return;
    }
    createNewProof();
  }

  /** Start empty, from New proof: no panel, in the template chosen. */
  function requestEmptyProof() {
    if (creatingProof) return;
    newProofPlan = { keys: [] };
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
    const selectedItems = (newProofPlan?.keys ?? [])
      .map((path) => pickerItems.find((item) => item.src === path))
      .filter(Boolean);
    try {
      resetDoc();
      proofStarted = true;
      pickSideTab('layout');
      settlePlace('proof', place(), { navigate: true });
      if (template) applyTemplate(template, { notify: false });
      for (const item of selectedItems) await addPanel(item);
      dirty = true;
      anchorHistory();
      closeNewProof();
      replaceWithNewConfirm = false;
      newProofPlan = null;
      if (proof.panels.length) requestAnimationFrame(fit);
    } finally {
      creatingProof = false;
    }
  }

  /**
   * The proof of a scene picked in New proof: the frames not in the case filed, then the
   * proof made as Make the proof makes it, of the pictures in the order picked, in the
   * template chosen.
   */
  async function createSceneProof(keys, entry) {
    const caseId = caseState.current?.id;
    const held = newProofScene;
    if (!caseId || !held?.material || held.entry.key !== entry.key) return;
    creatingProof = true;
    try {
      const byKey = new Map(sceneMaterial(held.material).map((one) => [one.key, one]));
      const unfiled = keys
        .filter((key) => byKey.get(key)?.frame && !byKey.get(key).frame.path)
        .map((key) => ({ ...byKey.get(key).frame, key }));
      await fileFrames(caseId, entry.video, unfiled);
      const filed = new Map(unfiled.map((f) => [f.key, f.path]));
      const panels = keys.map((key) => filed.get(key) ?? key);
      const handoff = entry.picture
        ? { ...pictureHandoff(entry.row, entry.video), panels }
        : proofHandoff(entry.row, entry.video, panels);
      if (await makeSceneProof(handoff, { template: newProofTemplateId, navigate: true })) closeNewProof();
    } catch (e) {
      toast(e.message, 'danger');
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
    // A picture as published is the whole page: a panel beside it would put a frame
    // round somebody else's proof again. A new proof takes it instead.
    if (isPublishedProof(proof)) {
      toast('A proof kept as published takes no panels. Start a new proof for this one', 'warn', 5200);
      return;
    }
    try {
      // the first panel of a proof not started yet starts a new one, on Layout, from the default
      if (!proofStarted) pickSideTab('layout');
      if (!proofStarted) applyDefaultTemplate();
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
      const panel = hydratedSurface({
        id: newId('p'),
        src: item.src,
        // captionsEnabled off → new panels start caption-less (you can still add
        // one). On → they carry the panel's own default (satellite coords, etc.).
        caption: proof.captionsEnabled === false ? '' : (item.caption ?? ''),
        row,
        scale: 1,
        natural: [img.naturalWidth, img.naturalHeight],
        meta: item.meta ?? {},
      }, img);
      // what the proof answers with today, read before the panel can change it
      const answered = displayedCoords;
      const answeredProposed = pointProposed(proof.points, 0, proof.panels);
      // grid: append (rightmost / bottom row); free: a new panel lands in front
      if (proof.layout === 'free') proof.panels.unshift(panel);
      else proof.panels.push(panel);
      // a panel that carries a place states it, under the point already there
      proof.points = statePanelPoint(proof.points, panel, answered, prefs.coordFormat, answeredProposed);
      dirty = true;
      requestAnimationFrame(fit);
    } catch (e) {
      toast(e.message, 'danger');
    }
  }

  /** These case files as panels, in order. `media` is the media list when it was just read. */
  async function addPanelsFromPaths(paths, { media: read = null } = {}) {
    // a list that misses one of them was read before it was filed
    const fresh = read && paths.every((path) => read.some((one) => one.path === path)) ? read : null;
    const [media, sats] = await Promise.all([
      fresh ?? api.get(`/api/cases/${caseState.current.id}/media`),
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

  // Grow / shrink a single panel. Its marks live in its own pixels, so they stay
  // on what they point at and span what they spanned; their ink keeps its width.
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

  // Fold a finished panel move/resize/rotation back into the document. Image
  // groups are centred so the round rotation handle turns around their centre.
  function commitPanelNode(panel, node, { resized = false } = {}) {
    const free = proof.layout === 'free';
    if (free) materializeFreePositions();
    // The group sits on the image's middle, so this is where the picture is —
    // the one point that has to survive a turn, which changes the box around it.
    const centre = node.position();
    // The node's scale is the image's, so the panel's own height reads off the
    // image too — the box around a turned one is bigger and is not what was sized.
    if (resized) panel.scale = scaleFromNode(node.scaleX(), panelSizedHeight(panel));
    const turned = applyNodeTurn(panel, node);
    if (free) {
      const k = panelScale(panel);
      panel.x = centre.x - panel.natural[0] * k / 2;
      panel.y = centre.y - panel.natural[1] * k / 2;
      normalizeFree();
    }
    dirty = true;
    // The grid re-flows around the new bounds, so a resize refits the page. A
    // turn does not: the page it needs grows as the picture comes round, and
    // rescaling the view under the hand mid-gesture reads as the photo shrinking.
    if (!free && !turned) requestAnimationFrame(fit);
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

  /** A line's ends that held to a picture leaving the proof stay where they are, free. */
  function letGoOfSurface(surfaceId) {
    const frame = frameOf(surfaceId);
    if (frame) proof.shapes = proof.shapes.map((s) => letGoOf(s, surfaceId, frame));
  }

  /** A picture leaving, and the insets on it: the lines they hold let go, where they were. */
  function letGoOfSurfaceAndInsets(surfaceId) {
    for (const inset of proof.shapes.filter((s) => s.kind === 'zoom' && s.panel === surfaceId)) letGoOfSurface(inset.id);
    letGoOfSurface(surfaceId);
  }

  /** How many zoom insets the proof holds, for naming one of them. */
  const insetCount = () => proof.shapes.filter((s) => s.kind === 'zoom').length;

  function removePanel(index) {
    const panel = proof.panels[index];
    if (cropSurfaceId === panel?.id) discardSurfaceCrop(); // it is leaving anyway
    letGoOfSurfaceAndInsets(panel.id);
    const going = goingWith(proof.shapes, [panel.id]);
    proof.shapes = proof.shapes.filter((s) => !going.has(s.id));
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
    // A paste sits on top of a proof; the panels, or a published picture, are what
    // give the document its size, so there has to be one before an image can land.
    if (!hasProofCanvasContent(proof)) {
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
      const paste = hydratedSurface(newPaste(name, natural, {
        x: centre.x - (natural[0] * scale) / 2,
        y: centre.y - (natural[1] * scale) / 2,
        scale,
      }), img);
      Object.assign(paste, clampPaste(paste, width, height));
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
   * Two clipboards answer one chord: the system's, which may hold a screenshot,
   * and this composer's, which holds the marks just copied. A copy made here is
   * written to the system clipboard too, as a marked text (lib/proofClipboard.js),
   * so the system clipboard says which came last: the marked text pastes the
   * marks, from this tab or another, and an image there means it was copied since.
   * When the copy could not be written there, the older rule stands: a copy made
   * here without leaving the window wins, and leaving it hands the chord back.
   * Nothing is pasted into a field being typed in, nor behind a dialog.
   */
  function onPaste(e) {
    if (uiState.tool !== 'proof' || modalOpen || isTextTarget(e.target) || middleClickPaste()) return;
    const marked = readClip(e.clipboardData?.getData?.('text/plain') ?? '');
    const item = [...(e.clipboardData?.items ?? [])].find((i) => i.type.startsWith('image/'));
    if (marked) {
      e.preventDefault();
      pasteClip(marked.id === clipboard?.id ? clipboard : marked);
    } else if (clipboard && (!item || (shapeCopyFresh && !clipOnSystem))) {
      e.preventDefault();
      pasteClip(clipboard);
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
    if (!carriesOutsideFiles(e)) return;
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
    if (cropSurfaceId === paste.id) discardSurfaceCrop(); // it is leaving anyway
    letGoOfSurfaceAndInsets(paste.id);
    const going = goingWith(proof.shapes, [paste.id]);
    proof.shapes = proof.shapes.filter((s) => !going.has(s.id));
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
   * Change a surface's pixel geometry without making it jump in free layout.
   * Grid panels deliberately reflow; free panels and overlays keep their visual
   * centre, then return inside the document if their new bounds cross an edge.
   */
  function withSurfaceCentrePreserved(item, edit) {
    const panelIndex = proof.panels.findIndex((panel) => panel.id === item.id);
    const pasteIndex = proof.pastes.findIndex((paste) => paste.id === item.id);
    let before = null;

    if (panelIndex >= 0 && proof.layout === 'free') {
      materializeFreePositions();
      before = boxesOf()[panelIndex];
    } else if (pasteIndex >= 0) {
      before = pasteBoxes([item])[0];
    }

    edit();

    if (panelIndex >= 0) {
      if (proof.layout === 'free' && before) {
        const after = boxesOf()[panelIndex];
        item.x += (before.w - after.w) / 2;
        item.y += (before.h - after.h) / 2;
        normalizeFree();
        return; // the centre held: refitting here would throw the zoom away
      }
      requestAnimationFrame(fit);
      return;
    }

    if (pasteIndex >= 0 && before) {
      const after = pasteBoxes([item])[0];
      item.x += (before.w - after.w) / 2;
      item.y += (before.h - after.h) / 2;
      const { width, height } = measureDoc();
      Object.assign(item, clampPaste(item, width, height));
    }
  }

  /**
   * Turn a surface. The angle rides on the group that holds the image and its
   * annotations, so nothing is redrawn into new pixels and no coordinate moves:
   * the image, its border, its marks and its notes all turn as one.
   */
  function applySurfaceRotation(item, angle) {
    const turned = normalizeSurfaceAngle(angle);
    if (turned === (item.rotation ?? 0)) return false;
    item.rotation = turned;
    refreshSurface(item);
    return true;
  }

  /**
   * Fold a turn the selection made into a surface. One without a cut is held by
   * its own turned group, whose angle is the turn; a cut one by the upright group
   * standing on its cut, which starts square, so its angle is the step taken.
   */
  function applyNodeTurn(item, node) {
    return item.cut ? turnCutSurface(item, node.rotation()) : applySurfaceRotation(item, node.rotation());
  }

  /**
   * Turn a cut surface by a step, about the middle of its cut (`turnSurfaceCut`).
   * Brought level again, the cut is a plain crop, the way a cut that ran along the
   * picture's edges always was. A panel keeps the size its pixels are drawn at, so
   * a quarter turn that swaps the cut's sides does not grow or shrink the picture.
   */
  function turnCutSurface(item, step) {
    const delta = normalizeSurfaceAngle(step);
    if (!delta) return false;
    const before = panelSizedHeight(item);
    const from = item.rotation ?? 0;
    const to = normalizeSurfaceAngle(from + delta);
    const cut = turnSurfaceCut(item.cut, from, to);
    item.rotation = to;
    if (isQuarterTurn(to)) {
      const crop = cutToSourceCrop(cut, item.sourceNatural, to);
      shiftSurfaceMarks(item, -(crop?.x ?? 0), -(crop?.y ?? 0));
      item.crop = crop;
      item.cut = null;
    } else {
      item.cut = cut;
    }
    refreshSurface(item);
    if (proof.panels.includes(item)) {
      const scale = (item.scale ?? 1) * panelSizedHeight(item) / before;
      item.scale = Math.min(Math.max(scale, PANEL_SCALE_MIN), PANEL_SCALE_MAX);
    }
    return true;
  }

  /**
   * Annotations are measured from the corner of the pixels a surface draws, so a
   * crop that moves that corner moves them back by as much, and they stay on the
   * same spot of the picture. A cut moves no corner: it only hides.
   */
  function shiftSurfaceMarks(item, dx, dy) {
    if (!dx && !dy) return;
    proof.shapes = shiftedTies(mapSurfaceShapes(proof.shapes, item.id, (s) => shiftProofShape(s, dx, dy)), item.id, dx, dy);
  }

  const surfaceById = (id) => (id
    ? proof.panels.find((panel) => panel.id === id)
      ?? proof.pastes.find((paste) => paste.id === id)
      ?? null
    : null);

  /**
   * The on-canvas crop mode, opened by a double-click or the side control. Both
   * toggle: asking again for the image already under the marks is how you say
   * you are done with it, without reaching for the canvas.
   */
  function beginSurfaceCrop(item) {
    if (!item?.img) return;
    if (cropSurfaceId) {
      const same = cropSurfaceId === item.id;
      endSurfaceCrop();
      if (same) return;
    }
    tool = 'select';
    cropSurfaceId = item.id;
    // The whole source comes back into view, shaded outside the box it already
    // keeps, so what an earlier crop cut off can be taken back in this pass. The
    // marks stand square on the page however the picture is turned, and open on
    // what it shows now: its cut, or the upright box around its picture.
    cropDraft = item.cut ? { ...item.cut } : surfaceCutStart(item.sourceNatural, item.crop, item.rotation);
    cropStart = { ...cropDraft };
    if (proof.panels.includes(item)) selectPanel(item.id);
    else selectPaste(item.id);
    // through the gate, which holds it past a press still under way
    canvasRenderGate?.requestRebuild();
  }

  /**
   * Leave crop mode, keeping what the marks frame. They move freely until then,
   * in both directions, so a corner pulled too far comes back in the same pass
   * and the whole session lands as one box.
   */
  function endSurfaceCrop() {
    const item = surfaceById(cropSurfaceId);
    const selection = cropDraft;
    // marks never moved say nothing, which keeps a crop that runs along a turned
    // picture's edges rather than trading it for the upright box around it
    const moved = !!selection && !sameBox(selection, cropStart);
    discardSurfaceCrop();
    if (item && moved) applySurfaceCrop(item, selection);
  }

  const sameBox = (a, b) => !!a && !!b
    && ['x', 'y', 'w', 'h'].every((key) => Math.abs(a[key] - b[key]) < 1e-6);

  /** Leave crop mode and drop the draft: the image keeps the pixels it had. */
  function discardSurfaceCrop() {
    const hadMarks = !!cropSurfaceId;
    cropSurfaceId = null;
    cropDraft = null;
    cropStart = null;
    cropHandles?.destroyChildren();
    cropHandles?.getLayer()?.batchDraw();
    if (hadMarks) canvasRenderGate?.requestRebuild();
  }

  /**
   * Commit the box the marks frame. Where it runs along the picture's own edges,
   * unturned or a quarter turn round, it is a crop in source pixels, as it always
   * was. Across them it is a cut, square on the page, and the picture keeps all
   * its pixels under it.
   */
  function applySurfaceCrop(item, selection) {
    const turn = item.rotation ?? 0;
    const square = isQuarterTurn(turn);
    const crop = square ? cutToSourceCrop(selection, item.sourceNatural, turn) : null;
    const cut = square ? null : settleSurfaceCut(selection, item.sourceNatural, turn);
    if (JSON.stringify([crop, cut]) === JSON.stringify([item.crop ?? null, item.cut ?? null])) return;
    reshapeSurface(item, crop, cut);
  }

  /**
   * Give a surface a new crop and cut. Annotations are measured from the crop's
   * own corner, so they travel by whatever that corner moved. Their own angles
   * never change: the turn is on the group they are drawn in.
   */
  function reshapeSurface(item, crop, cut) {
    const dx = (item.crop?.x ?? 0) - (crop?.x ?? 0);
    const dy = (item.crop?.y ?? 0) - (crop?.y ?? 0);
    withSurfaceCentrePreserved(item, () => {
      shiftSurfaceMarks(item, dx, dy);
      item.crop = crop;
      item.cut = cut;
      refreshSurface(item);
    });
    dirty = true;
  }

  /** Expand the source back to full size, crop or cut, and keep the turn. */
  function resetSurfaceCrop(item) {
    if (!item?.crop && !item?.cut) return;
    reshapeSurface(item, null, null);
    if (cropSurfaceId === item.id) {
      cropDraft = surfaceCutStart(item.sourceNatural, null, item.rotation);
      cropStart = { ...cropDraft };
    }
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
    viewFitted = true;
    drawScenePlays();
    if (cropSurfaceId) drawCropHandles();
    stage.batchDraw();
  }

  function onWheel(e) {
    e.evt.preventDefault();
    viewFitted = false;
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
    drawScenePlays();
    if (cropSurfaceId) drawCropHandles();
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
      // a locked inset is held out of reach, the marks over it are not
      if (isLocked(s)) continue;
      const node = docLayer.findOne(`#${s.id}`);
      if (!node) continue;
      const r = node.getClientRect({ relativeTo: docLayer });
      const misses = r.x > box.x + box.width || r.x + r.width < box.x
        || r.y > box.y + box.height || r.y + r.height < box.y;
      if (!misses) caught.push(s.id);
    }
    return caught;
  }

  // Annotations are drawn on whatever surface is under the pointer — a zoom
  // inset's enlargement, a panel or a pasted image, or the page around them.
  // Insets and pasted images are in front, so they claim the point first, and the
  // page answers last. `page: false` for the marks that only mean something on a
  // picture's own pixels, which no inset or page takes.
  function surfaceAt(doc, { page = true } = {}) {
    const list = surfacesOf();
    const held = page ? list : list.filter((x) => x.id !== PAGE && x.kind !== INSET);
    return surfaceHitTest(held, doc);
  }

  /** Where a surface sits on the page now, or null once it is gone. */
  function frameOf(surfaceId) {
    const entry = surfacesOf().find((x) => x.id === surfaceId);
    return entry ? surfaceFrame(entry) : null;
  }

  /**
   * The pointer in a surface's own pixels, held to its picture; `loose`, held
   * only where the page is or can grow to, for a mark drawn on the page and for
   * a line's far end, which may reach another picture.
   */
  function pointerOn(frame, loose = false) {
    if (loose) return pageToSurface(onPage(docPoint()), frame);
    return holdOnSurface(pageToSurface(docPoint(), frame), frame);
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
      if (cropSurfaceId) {
        const group = docLayer.findOne(`#pg-${cropSurfaceId}`);
        const insideSurface = e.target === group || group?.isAncestorOf(e.target);
        const insideCrop = e.target === cropHandles || cropHandles?.isAncestorOf(e.target);
        const insideTransformer = e.target === transformer || transformer?.isAncestorOf(e.target);
        if (!insideSurface && !insideCrop && !insideTransformer) endSurfaceCrop();
      }
      dragMoved = false;
      marqueeEnded = false;
      const add = e.evt.shiftKey;
      // Where a drag can mean nothing else, it means picking. On the page around
      // the panels, and across a panel the grid pins in place — an overlay or a
      // free-layout panel is dragged instead, and the room outside the page
      // still pans, which is the gesture that was there before the marquee.
      // a locked inset is ground to pick the marks over it from, as the page is
      const onPage = e.target.name() === 'bg' || e.target.name() === 'inset-hold';
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
    // A mark drawn where no picture is, in a margin or a gap, is free on the
    // page. One drawn over a zoom inset belongs to that inset and follows it.
    // The marks that only mean something on a picture's pixels need one under
    // them.
    const hit = surfaceAt(docPoint(), { page: canBeFree(tool) });
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
    // A callout starts the same way but from its point: the press names the
    // pixel, the drag carries the label to where it reads, and the release opens
    // its editor. A press that never moved puts the label up and to the right.
    if (tool === 'callout') {
      const tipPage = surfaceToPage({ x: hit.nx, y: hit.ny }, hit.frame);
      const node = new Konva.Line({
        points: [tipPage.x, tipPage.y, tipPage.x, tipPage.y],
        stroke: color, strokeWidth: calloutInk().line, dash: [6, 4], listening: false,
      });
      uiLayer.add(node);
      drawing = {
        panel, node, kind: 'callout', box: hit.box, frame: hit.frame,
        start: { x: hit.nx, y: hit.ny }, tipPage,
      };
      return;
    }
    // A view cone starts where the camera stood and is aimed by the drag.
    if (tool === 'cone') {
      drawing = {
        panel, kind: 'cone', box: hit.box, frame: hit.frame, group,
        start: { x: hit.nx, y: hit.ny }, node: null, cone: null,
      };
      return;
    }
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
        x: hit.nx, y: hit.ny, size: ICON_SIZE_DEFAULT,
        ...(isSolidIcon(entry.name) ? {} : { strokeWidth: strokeW }),
        ...(fillOpacity > 0 ? { fillOpacity } : {}),
        // a model is laid down at the picker's View, written on it at once
        ...pickedModelView(entry.name),
      };
      proof.shapes.push(s);
      selectedIds = [s.id];
      dirty = true;
      return;
    }
    // A numbered marker is stamped like a symbol, and keeps the tool: numbering
    // four things in a picture is one act. The number is the first one free in
    // its colour on this picture (or on the page), so each picture counts from 1
    // and deleting #2 and stamping again fills the hole rather than leaving a
    // picture that counts 1, 3, 4.
    if (tool === 'number') {
      const s = {
        id: newId('s'), panel: panel.id, kind: 'number', color,
        x: hit.nx, y: hit.ny, size: ICON_SIZE_DEFAULT, n: nextMarkerNumber(proof.shapes, color, panel.id),
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
      if (pathDraft && pathDraft.panel.id !== panel.id) finishPath(true, { keepTool: true });
      if (!pathDraft) {
        const node = new Konva.Line({
          points: [hit.nx, hit.ny], tension: 0.5, stroke: color,
          strokeWidth: strokeW / hit.box.scale, lineCap: 'round', lineJoin: 'round',
          listening: false,
        });
        group.add(node);
        pathDraft = { panel, box: hit.box, frame: hit.frame, node, points: [hit.nx, hit.ny] };
      } else {
        pathDraft.points.push(hit.nx, hit.ny);
        pathDraft.node.points([...pathDraft.points]);
        docLayer.batchDraw();
      }
      return;
    }
    // Ink is in page pixels, and the draft is drawn inside the surface's scale.
    const sw = strokeW / hit.box.scale;
    if (tool === 'freehand') {
      const node = new Konva.Line({
        points: [hit.nx, hit.ny], tension: 0.25, stroke: color,
        strokeWidth: sw, lineCap: 'round', lineJoin: 'round', listening: false,
      });
      group.add(node);
      drawing = { panel, node, box: hit.box, frame: hit.frame, kind: tool };
      return;
    }
    const common = {
      stroke: color, strokeWidth: sw, listening: false,
      ...(DASHABLE.has(tool) && dashPattern(lineStyle, strokeW)
        ? { dash: dashPattern(lineStyle, strokeW).map((v) => v / hit.box.scale), lineCap: lineStyle === 'dot' ? 'round' : 'butt' }
        : {}),
    };
    // the draft is drawn with the fill it will be committed with, so the analyst
    // sees what the box hides while dragging it, not after
    const paint = canFill(tool) ? fillPaint(color, fillOpacity) : null;
    let node;
    if (tool === 'rect') {
      node = new Konva.Rect({
        x: hit.nx, y: hit.ny, width: 1, height: 1, cornerRadius: 2, fill: paint, ...common,
      });
    } else if (tool === 'zoom') {
      // The frame of what will be shown bigger; the inset itself is placed on
      // the release, beside the frame where the page has room.
      node = new Konva.Rect({
        x: hit.nx, y: hit.ny, width: 1, height: 1,
        dash: [7 / hit.box.scale, 5 / hit.box.scale],
        ...common,
      });
    } else if (tool === 'blur') {
      // The draft is a dashed box over a darkened patch: the blur itself is
      // built from the picture once the box is a box, and a filter re-applied
      // on every pointer move would blur the whole drag.
      node = new Konva.Rect({
        x: hit.nx, y: hit.ny, width: 1, height: 1,
        fill: 'rgba(20, 22, 26, 0.45)',
        dash: [7 / hit.box.scale, 5 / hit.box.scale],
        ...common,
      });
    } else if (tool === 'ellipse') {
      node = new Konva.Ellipse({ x: hit.nx, y: hit.ny, radiusX: 1, radiusY: 1, fill: paint, ...common });
    } else {
      node = new Konva.Arrow({
        points: [hit.nx, hit.ny, hit.nx, hit.ny],
        pointerLength: tool === 'arrow' ? ARROW_HEAD / hit.box.scale : 0,
        pointerWidth: tool === 'arrow' ? ARROW_HEAD / hit.box.scale : 0,
        fill: color,
        ...common,
      });
    }
    group.add(node);
    drawing = { panel, node, start: { x: hit.nx, y: hit.ny }, box: hit.box, frame: hit.frame, kind: tool };
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
      viewFitted = false;
      stage.position({ x: panDrag.ox + p.x - panDrag.sx, y: panDrag.oy + p.y - panDrag.sy });
      stage.batchDraw();
      return;
    }
    if (pathDraft) {
      const { x: nx, y: ny } = pointerOn(pathDraft.frame, pathDraft.panel.id === PAGE);
      pathDraft.node.points([...pathDraft.points, nx, ny]);
      docLayer.batchDraw();
      return;
    }
    if (!drawing) return;
    if (drawing.kind === 'cone') {
      // the line of sight follows the pointer, wherever it is on the page
      const at = pageToSurface(docPoint(), drawing.frame);
      drawing.cone = newCone(drawing, at);
      drawing.node?.destroy();
      drawing.node = makeConeNode(drawing.cone, drawing.box.scale, drawing.frame.rotation, {
        live: false, image: drawing.frame.image, outline: drawing.frame.outline,
      });
      drawing.group.add(drawing.node);
      docLayer.batchDraw();
      return;
    }
    if (drawing.kind === 'callout') {
      // the label goes anywhere on the page, so the pointer is not held to the picture
      const at = docPoint();
      drawing.node.points([drawing.tipPage.x, drawing.tipPage.y, at.x, at.y]);
      uiLayer.batchDraw();
      return;
    }
    const { start, node, kind } = drawing;
    // Clamp to the picture even if the pointer leaves it, except for a line or
    // an arrow: its far end may reach the page or another picture, and hold
    // there (see commitDrawing). Either way it stays inside the document.
    const loose = kind === 'arrow' || kind === 'line' || drawing.panel.id === PAGE;
    const { x: nx, y: ny } = pointerOn(drawing.frame, loose);
    if (kind === 'freehand') {
      const points = node.points();
      const lx = points[points.length - 2];
      const ly = points[points.length - 1];
      if (nx !== lx || ny !== ly) node.points([...points, nx, ny]);
    } else if (kind === 'rect' || kind === 'blur' || kind === 'zoom') {
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
    if (drawing.kind === 'callout') {
      commitCallout();
      return;
    }
    if (drawing.kind === 'zoom') {
      commitZoom();
      return;
    }
    if (drawing.kind === 'cone') {
      commitCone();
      return;
    }
    const { node, kind, panel, frame } = drawing;
    const box = drawing.box;
    drawing = null;
    const minSize = 5 / box.scale;
    let shape = null;
    if ((kind === 'rect' || kind === 'blur') && node.width() > minSize && node.height() > minSize) {
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
      let s = {
        id: newId('s'), panel: panel.id,
        // A blur box carries neither: it hides what is under it rather than
        // pointing at it, so it is drawn from the picture's own pixels and
        // nothing ever reads a colour or a line width off it.
        ...(kind === 'blur' ? {} : { color, strokeWidth: strokeW }),
        ...(DASHABLE.has(kind) && lineStyle !== 'solid' ? { dash: lineStyle } : {}),
        // only the kinds that can hold one carry the field, and only once asked
        ...(canFill(kind) && fillOpacity > 0 ? { fillOpacity } : {}),
        ...shape,
      };
      if (kind === 'arrow' || kind === 'line') s = linkFromDraft(s, frame);
      proof.shapes.push(s);
      selectedIds = [s.id];
      // The pen goes down with the shape. What follows a stroke is almost always
      // a word about it — its colour, its width, the note it carries — and the
      // toolbar edits the picked annotation, so leaving the tool in hand meant
      // every one of those first drew a second box nobody wanted. Drawing three
      // in a row is `r`, `r`, `r`, which is what the shortcuts are for. The
      // stamp is the exception and keeps the tool: marking six vehicles is one
      // act, not six.
      tool = 'select';
      dirty = true;
    }
  }

  /**
   * A line or arrow just drawn, settled from what is under each end: drawn
   * within one picture it is that picture's mark, as ever; drawn from one picture
   * to another, or out into a margin, it goes on the page and each end holds to
   * the picture it was pressed or let go on, a zoom inset's enlargement included.
   */
  function linkFromDraft(s, frame) {
    const [x0, y0, x1, y1] = s.points;
    const start = surfaceToPage({ x: x0, y: y0 }, frame);
    const end = surfaceToPage({ x: x1, y: y1 }, frame);
    const held = s.panel === PAGE ? null : { id: s.panel, nx: x0, ny: y0 };
    return settleLink(
      s,
      { page: start, on: held },
      { page: end, on: pictureUnder(surfacesOf(), end) },
    );
  }

  /** Settle a callout's drag: its point where it was pressed, its label where it was let go. */
  function commitCallout() {
    const { node, panel, start, tipPage } = drawing;
    drawing = null;
    node.destroy();
    uiLayer.batchDraw();
    const at = docPoint();
    // under a few screen pixels the press was a click, not a drag
    const dragged = Math.hypot(at.x - tipPage.x, at.y - tipPage.y) * stage.scaleX() > 4;
    const s = {
      id: newId('s'), panel: panel.id, kind: 'callout', color, text: 'Text',
      fontSize: CALLOUT_FONT, x: start.x, y: start.y,
      dx: dragged ? at.x - tipPage.x : CALLOUT_OFFSET.dx,
      dy: dragged ? at.y - tipPage.y : CALLOUT_OFFSET.dy,
      tail: calloutTail,
    };
    proof.shapes.push(s);
    selectedIds = [s.id];
    tool = 'select';
    dirty = true;
    // a frame later, for the reason the label waits (see the Text tool)
    requestAnimationFrame(() => startTextEdit(s));
  }

  /**
   * A cone from where the press was toward `at`, in the picture's own pixels,
   * opening to the lens in hand. A drag shorter than a few screen pixels was a
   * click, which aims the cone up the picture at a length that reads.
   */
  function newCone(draft, at) {
    const { start, box } = draft;
    const reach = at ? Math.hypot(at.x - start.x, at.y - start.y) : 0;
    const clicked = reach * box.scale * stage.scaleX() < 6;
    return {
      id: newId('s'), panel: draft.panel.id, kind: 'cone', color, strokeWidth: strokeW,
      x: start.x, y: start.y,
      rotation: clicked ? 0 : bearingTo(start, at),
      reach: clicked ? 160 / box.scale : reach,
      fov: lensFov(coneLens, coneUpright), lens: coneLens, upright: coneUpright,
      badge: coneBadge, fillOpacity: 0.35,
      ...(lineStyle !== 'solid' ? { dash: lineStyle } : {}),
    };
  }

  /** Settle a cone where it was drawn, or straight up from a click. */
  function commitCone() {
    const draft = drawing;
    drawing = null;
    draft.node?.destroy();
    const s = draft.cone ?? newCone(draft, null);
    proof.shapes.push(s);
    selectedIds = [s.id];
    tool = 'select';
    dirty = true;
  }

  /** Settle an inset's frame, and put the enlargement where the page has room. */
  function commitZoom() {
    const { node, panel, frame } = drawing;
    drawing = null;
    const w = node.width();
    const h = node.height();
    const rect = { x: node.x(), y: node.y(), w, h };
    node.destroy();
    // a frame under a few screen pixels a side is a slipped click
    const minSize = 5 / (frame.box.scale * stage.scaleX());
    if (w <= minSize || h <= minSize) return;
    const { width, height } = measureDoc();
    const { box } = frame;
    // the frame as the page sees it: its centre, and its size at the picture's scale
    const centre = surfaceToPage({ x: rect.x + w / 2, y: rect.y + h / 2 }, frame);
    const pw = w * box.scale;
    const ph = h * box.scale;
    const placed = insetPlacement(
      { x: centre.x - pw / 2, y: centre.y - ph / 2, w: pw, h: ph },
      { x: box.x, y: box.y, w: box.w, h: box.h },
      width,
      height,
    );
    const s = {
      id: newId('s'), panel: panel.id, kind: 'zoom', color, strokeWidth: strokeW,
      ...(lineStyle !== 'solid' ? { dash: lineStyle } : {}),
      ...rect, iw: placed.iw, dx: placed.dx, dy: placed.dy,
    };
    proof.shapes.push(s);
    selectedIds = [s.id];
    tool = 'select';
    dirty = true;
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

  /** Close the curve in hand. `keepTool` for the one caller that is opening the
   *  next curve in the same gesture, where putting the pen down would strand it. */
  function finishPath(commit, { keepTool = false } = {}) {
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
      // The pen goes down, like the box, the line and the arrow it belongs beside:
      // the curve is picked so the toolbar edits it (see commitDrawing).
      if (!keepTool) tool = 'select';
      dirty = true;
    } else {
      proof.shapes = [...proof.shapes]; // force rebuild to drop the preview
    }
  }

  // Fold a drag or a corner-resize of a pasted image back into its stored
  // position and scale, then hold it inside the document.
  function commitPasteNode(paste, node, { resized = false } = {}) {
    const centre = node.position();
    if (resized) paste.scale = clampPasteScale(node.scaleX());
    applyNodeTurn(paste, node);
    paste.x = centre.x - paste.natural[0] * paste.scale / 2;
    paste.y = centre.y - paste.natural[1] * paste.scale / 2;
    const { width, height } = measureDoc();
    Object.assign(paste, clampPaste(paste, width, height));
    node.scale({ x: paste.scale, y: paste.scale });
    node.position({ x: paste.x, y: paste.y });
    dirty = true;
  }

  /**
   * The decorative border of a panel or a pasted image, drawn inset so it never
   * spills past the image: the document is measured from the panels, and a frame
   * must not change what that measure sees. Width is in page pixels like any
   * other ink, so a 6 px border is 6 px on every panel; `scale` is the surface's.
   */
  function frameNode(frame, natural, scale) {
    const w = frame.width / scale;
    return new Konva.Rect({
      x: w / 2, y: w / 2,
      width: Math.max(0, natural[0] - w), height: Math.max(0, natural[1] - w),
      stroke: frame.color, strokeWidth: w, listening: false,
    });
  }

  // ---- rebuild canvas from state ------------------------------------------------------

  /**
   * The nodes a surface is drawn in. `group` is the surface's own pixels, turned,
   * where its picture and its marks live. Without a cut it is also `node`, what
   * the selection holds and a drag moves, and it stands on its layout box as it
   * always has. A cut surface stands on its cut instead: `node` is an upright
   * group on the cut, holding the turned group, so the selection frame and its
   * handles are square on the page like the cut they frame.
   */
  function surfaceNodes(item, box, draggable) {
    const image = imageSizeOf(item);
    const turn = item.rotation ?? 0;
    const centre = { x: box.x + box.w / 2, y: box.y + box.h / 2 };
    if (!item.cut) {
      const group = new Konva.Group({
        id: `pg-${item.id}`, ...centre,
        offsetX: image[0] / 2, offsetY: image[1] / 2,
        rotation: turn, scaleX: box.scale, scaleY: box.scale, draggable,
      });
      return { node: group, group, image };
    }
    const { w, h } = item.cut;
    const off = surfaceCutMiddle(item.cut);
    const node = new Konva.Group({
      id: `pc-${item.id}`, name: 'surface-cut', ...centre, scaleX: box.scale, scaleY: box.scale, draggable,
    });
    // Konva measures a group by everything in it and looks past a clip, which
    // would frame the whole picture the cut hides. The surface is its cut.
    node.getClientRect = ({ skipTransform, relativeTo } = {}) => {
      const rect = { x: -w / 2, y: -h / 2, width: w, height: h };
      if (skipTransform) return rect;
      const at = node.getAbsoluteTransform(relativeTo);
      const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]]
        .map(([x, y]) => at.point({ x, y }));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
    };
    const group = new Konva.Group({
      id: `pg-${item.id}`, x: -off.x, y: -off.y,
      offsetX: image[0] / 2, offsetY: image[1] / 2, rotation: turn,
    });
    // a mark dragged to the front brings its picture with it, cut and all
    group.moveToTop = () => {
      node.moveToTop();
      return true;
    };
    node.add(group);
    // While the knob turns it, the cut stays square on the page and the picture
    // turns under it, as it will once let go. The clip reads the same live cut.
    node.on('transform', () => {
      const live = liveCutOf(item, node);
      group.findOne('.cut-seat')?.setAttrs(surfaceCutSeat(live.cut, image, live.turn));
    });
    return { node, group, image };
  }

  /**
   * A cut surface's cut and turn as they stand mid-gesture: the upright group it
   * is held by has turned by a step the surface does not have yet.
   */
  function liveCutOf(item, node) {
    const from = item.rotation ?? 0;
    const turn = normalizeSurfaceAngle(from + (node?.rotation() ?? 0));
    return { cut: turnSurfaceCut(item.cut, from, turn), turn };
  }

  /**
   * What catches a press on a surface: its picture, or its whole cut, blank
   * corners included, since that is the box the page shows for it.
   */
  function surfaceHitNode(item, image) {
    if (!item.cut) {
      return new Konva.Rect({
        x: 0, y: 0, width: image[0], height: image[1],
        fill: 'transparent', listening: true, name: 'panel-hit',
      });
    }
    return new Konva.Line({
      points: surfaceCutOutline(item.cut, image, item.rotation).flatMap((p) => [p.x, p.y]),
      closed: true, fill: 'transparent', listening: true, name: 'panel-hit',
    });
  }

  /**
   * Where a surface's border and its scene time go: on the picture's own edges,
   * or on its cut, square on the page. Returns the group to draw them in and the
   * size of what they frame.
   */
  function shownLayer(group, item, image) {
    if (!item.cut) return { layer: group, size: image };
    const seat = surfaceCutSeat(item.cut, image, item.rotation);
    const layer = new Konva.Group({ ...seat, name: 'cut-seat', listening: false });
    group.add(layer);
    return { layer, size: [item.cut.w, item.cut.h] };
  }

  /** A surface's cut in its own pixels, or null when it has none. */
  function cutOutlineOf(item) {
    return item?.cut ? surfaceCutOutline(item.cut, imageSizeOf(item), item.rotation) : null;
  }

  /** Trace a closed outline on a canvas, for a clip that is not a rectangle. */
  function traceOutline(ctx, outline) {
    outline.forEach((p, index) => (index ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.closePath();
  }

  /**
   * What a surface draws. Ordinarily its crop, straight out of the source with
   * no intermediate canvas, and only what its cut keeps when it has one. Under
   * the crop marks it is the whole source instead, shifted so the kept box does
   * not move and shaded outside it — the pixels an earlier crop or cut left out
   * are there to be taken back.
   */
  function surfaceImageNode(item, image) {
    if (cropSurfaceId !== item.id) {
      const cutClip = (ctx, self) => {
        const live = liveCutOf(item, self.findAncestor('.surface-cut'));
        traceOutline(ctx, surfaceCutOutline(live.cut, image, live.turn));
      };
      const group = new Konva.Group({
        ...(item.cut
          ? { clipFunc: cutClip }
          : { clip: { x: 0, y: 0, width: image[0], height: image[1] } }),
        listening: false,
      });
      group.add(new Konva.Image({
        image: item.img, width: image[0], height: image[1], listening: false,
        ...(item.crop
          ? { crop: { x: item.crop.x, y: item.crop.y, width: item.crop.w, height: item.crop.h } }
          : {}),
      }));
      return group;
    }
    const [sw, sh] = item.sourceNatural;
    const originX = -(item.crop?.x ?? 0);
    const originY = -(item.crop?.y ?? 0);
    const ghost = new Konva.Group({ name: 'crop-ghost', listening: false });
    ghost.add(new Konva.Image({
      image: item.img, x: originX, y: originY, width: sw, height: sh, listening: false,
    }));
    // The shade is square on the page, like the marks, from the source's middle,
    // and lies on the picture only: the page around a turned one stays the page.
    const onPicture = new Konva.Group({ clip: { x: originX, y: originY, width: sw, height: sh }, listening: false });
    const upright = new Konva.Group({
      x: originX + sw / 2, y: originY + sh / 2, rotation: -(item.rotation ?? 0), listening: false,
    });
    for (let index = 0; index < 4; index++) {
      upright.add(new Konva.Rect({ name: 'crop-shade', fill: 'rgba(0, 0, 0, 0.55)', listening: false }));
    }
    onPicture.add(upright);
    ghost.add(onPicture);
    shadeCropGhost(ghost, item);
    return ghost;
  }

  /** Lay the four shaded bands over everything the marks leave out. */
  function shadeCropGhost(ghost, item) {
    if (!ghost || !cropDraft) return;
    // a hair past the picture's reach, so no sliver of it is left unshaded
    const reach = surfaceCutReach(item.sourceNatural, item.rotation);
    const left = reach.left - 2;
    const top = reach.top - 2;
    const right = reach.right + 2;
    const bottom = reach.bottom + 2;
    const { x, y, w, h } = cropDraft;
    const bands = ghost.find('.crop-shade');
    bands[0]?.setAttrs({ x: left, y: top, width: right - left, height: Math.max(0, y - top) });
    bands[1]?.setAttrs({ x: left, y: y + h, width: right - left, height: Math.max(0, bottom - y - h) });
    bands[2]?.setAttrs({ x: left, y, width: Math.max(0, x - left), height: h });
    bands[3]?.setAttrs({ x: x + w, y, width: Math.max(0, right - x - w), height: h });
  }

  // Each picture the page draws, by a number of its own: a picture replaced by another
  // changes what is drawn though every field around it reads the same.
  const pictureIds = new WeakMap();
  let pictureSeq = 0;
  function pictureId(img) {
    if (!img || typeof img !== 'object') return 0;
    if (!pictureIds.has(img)) pictureIds.set(img, (pictureSeq += 1));
    return pictureIds.get(img);
  }

  // Whether the page was rebuilt since its hit graph was last drawn. Konva draws it a
  // frame later, so a press landing inside that frame would be tested against nodes
  // gone: it lost its target, and with it the selection (`beginPointer`).
  let hitStale = false;

  function rebuild() {
    hitStale = true;
    docLayer.destroyChildren();
    // A template can be selected before any panels are chosen. Keep its style
    // in state, but do not render a background, footer, logo, or handle yet.
    if (!hasProofCanvasContent(proof)) {
      transformer.nodes([]);
      cropHandles.destroyChildren();
      endHandles.destroyChildren();
      panelCtrls.destroyChildren();
      scenePlays.destroyChildren();
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

    const published = isPublishedProof(proof);
    // A published picture has no background of its own: the picture is the page.
    if (!published) {
      docLayer.add(
        new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: bgFill })
      );
    }

    // The published pictures, as they were published: behind everything, never moved,
    // cropped or turned. A press on one is a press on the page, so a marquee picks the
    // marks drawn on it; a drawing tool finds it under the pointer like any picture.
    const publishedBox = publishedBoxes(proof.published);
    for (let i = proof.published.length - 1; i >= 0; i--) {
      const picture = proof.published[i];
      const box = publishedBox[i];
      const { node, group, image } = surfaceNodes(picture, box, false);
      group.add(new Konva.Rect({
        name: 'bg', x: 0, y: 0, width: image[0], height: image[1], fill: 'transparent', listening: true,
      }));
      if (picture.img) group.add(surfaceImageNode(picture, image));
      for (const s of proof.shapes.filter((x) => x.panel === picture.id && !isPageMark(x))) {
        addSurfaceShape(group, s, box, picture);
      }
      docLayer.add(node);
    }

    // Drawn back→front: array order is front→back, so Z1 (the first panel in
    // the side list) is the foreground panel where free-mode panels overlap.
    for (let i = proof.panels.length - 1; i >= 0; i--) {
      const panel = proof.panels[i];
      const box = boxes[i];
      // Outer group is NOT clipped so an element can be dragged across panels;
      // only the image itself is clipped to the panel box (inner group).
      // The group's own space is the image's pixels and it carries the turn, so
      // the frame, the marks and the annotations all sit on the image's edges.
      // The box around it is the upright room the page reserved for it, which is
      // the cut itself when there is one (`surfaceNodes`).
      const { node, group, image } = surfaceNodes(panel, box, free);
      // Invisible full-panel hit target: the image itself never listens (so
      // drawing tools pass through to the stage), but the panel must catch
      // select-clicks — and, in free mode, drags. Added first so shapes stay
      // on top for hit-testing.
      group.add(surfaceHitNode(panel, image));
      bindPanelPointerLifecycle(node, {
        // Only the select tool touches panels. Selection itself waits until the
        // gesture settles so rebuild() cannot destroy the pointerdown target.
        onPress: () => node.draggable(free && tool === 'select' && !spacePan),
        onSelect: () => selectPanel(panel.id),
        onDragEnd: free ? () => commitPanelNode(panel, node) : null,
      });
      node.on('transformend', () => commitPanelNode(panel, node, { resized: true }));
      node.on('dblclick dbltap', (event) => {
        if (tool !== 'select') return;
        event.cancelBubble = true;
        beginSurfaceCrop(panel);
      });
      if (panel.img) group.add(surfaceImageNode(panel, image));
      const shown = shownLayer(group, panel, image);
      if (panel.frame) shown.layer.add(frameNode(panel.frame, shown.size, box.scale));
      // the scene's time, when asked, under the marks: it belongs to the picture
      if (badges.has(panel.id)) shown.layer.add(sceneBadgeNode(badges.get(panel.id), shown.size, box.scale));
      for (const s of proof.shapes.filter((x) => x.panel === panel.id && !isPageMark(x))) {
        addSurfaceShape(group, s, box, panel);
      }
      docLayer.add(node);
      if (panel.caption?.trim()) {
        // A press on the caption picks its panel, whose rail sizes and colours
        // the captions; a double-click writes on it (see onCanvasDblClick).
        const caption = new Konva.Text({
          id: `cap-${panel.id}`,
          x: box.x + 2, y: box.y + box.h + 9,
          width: box.w - 4, text: panel.caption,
          fontSize: capSize, fontFamily: proofFace(),
          fill: proof.captionColor || tc.dim, ellipsis: true, wrap: 'none',
        });
        caption.on('click tap', () => selectPanel(panel.id));
        docLayer.add(caption);
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
        fontFamily: proofFace(), ellipsis: true, wrap: 'none', listening: false,
      }));
    });
    const printed = printedFooter();
    if (proof.panels.length && printed.length) {
      const footerSize = proof.footerSize ?? 13;
      // The coordinates the proof prints sit above its credit line, each on the
      // line `footerLines` measured them at — one source for the height and for
      // the drawing, or a proof that grew a line would overflow its own picture.
      const lines = printed;
      const band = footerBand(footerSize);
      // One mark on the canvas: a press picks it for its size and colour, and a
      // double-click writes its credit line.
      const footer = new Konva.Group({ id: 'proof-footer' });
      footer.on('click tap', () => { if (tool === 'select') selectSig('footer'); });
      lines.forEach((line, i) => {
        footer.add(new Konva.Text({
          x: pad,
          y: height - pad - band * (lines.length - i) + Math.round((band - footerSize) / 2),
          width: width - pad * 2,
          text: line,
          align: proof.footerAlign === 'right' ? 'right' : 'left',
          fontSize: footerSize, fill: proof.footerColor || tc.faint,
          fontFamily: proofFace(), ellipsis: true, wrap: 'none',
        }));
      });
      docLayer.add(footer);
    }

    // Pasted images, over the panels and the legend: pixels laid on top of the
    // proof rather than part of its composition. Back→front like the panels, so
    // the first one in the list is the one in front.
    for (let i = proof.pastes.length - 1; i >= 0; i--) {
      const paste = proof.pastes[i];
      const box = pasteBox[i];
      const { node, group, image } = surfaceNodes(paste, box, false);
      // same invisible hit target as a panel: the image never listens, so a
      // drawing tool passes through to the stage, but a click still selects.
      group.add(surfaceHitNode(paste, image));
      bindPanelPointerLifecycle(node, {
        onPress: () => node.draggable(tool === 'select' && !spacePan),
        onSelect: () => selectPaste(paste.id),
        onDragEnd: () => commitPasteNode(paste, node),
      });
      node.on('transformend', () => commitPasteNode(paste, node, { resized: true }));
      node.on('dblclick dbltap', (event) => {
        if (tool !== 'select') return;
        event.cancelBubble = true;
        beginSurfaceCrop(paste);
      });
      if (paste.img) group.add(surfaceImageNode(paste, image));
      const shown = shownLayer(group, paste, image);
      if (paste.frame) shown.layer.add(frameNode(paste.frame, shown.size, box.scale));
      for (const s of proof.shapes.filter((x) => x.panel === paste.id && !isPageMark(x))) {
        addSurfaceShape(group, s, box, paste);
      }
      docLayer.add(node);
    }

    // Callouts and zoom insets point from a picture out onto the page, and the
    // free marks belong to it: all are drawn over every picture and overlay, in
    // the order the list keeps. The group is the page's, as a panel's is its own.
    const pageMarks = new Konva.Group({ id: `pg-${PAGE}` });
    const surfaceList = surfacesOf();
    const pageSurface = surfaceList.find((x) => x.id === PAGE);
    for (const s of proof.shapes.filter((x) => isPageMark(x) || isFree(x))) {
      if (isFree(s)) {
        if (pageSurface) addSurfaceShape(pageMarks, s, pageSurface.box, pageSurface.item);
        continue;
      }
      const entry = surfaceList.find((x) => x.id === s.panel);
      if (!entry) continue;
      const frame = surfaceFrame(entry);
      if (s.kind === 'callout') addCalloutNodes(pageMarks, s, frame, { width, height });
      else addZoomNodes(pageMarks, s, frame, { width, height }, entry.item, surfaceList.find((x) => x.id === s.id));
    }
    docLayer.add(pageMarks);

    const st = proof.signatureText && prefs.signatureHandle?.trim() ? proof.signatureText : null;
    const pendingHandleNode = st ? new Konva.Text({
      id: 'sig-text',
      text: prefs.signatureHandle.trim(),
      fontSize: st.size ?? SIG_TEXT_SIZE,
      fontStyle: 'bold',
      fontFamily: proofFace(),
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
    // docLayer (not the UI layer) because it's part of the published image. Somebody
    // else's published picture is not signed.
    if (proof.signature && sigImg && !published) {
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
    if (st && pendingHandleNode && !published) {
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

    // the Azimut mark, when asked, beside the logo and the handle (lib/proofMark.js)
    if (!published) {
      addMark(Konva, docLayer, proof, { width, height, pad, footerLines: proof.panels.length ? printed.length : 0 });
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
    // A whole panel can be selected instead (both modes): corner anchors keep
    // its aspect, and the round handle rotates its pixels and annotations. In
    // grid mode the grid re-flows the resulting bounds.
    // The marks drawn over a picked inset ride with it, so the frame holds the
    // inset alone: holding both would carry them twice.
    // A locked inset is held alone or not at all, so a family's drag never carries it.
    const pickedInsets = new Set(selectedShapes.filter((s) => s.kind === 'zoom').map((s) => s.id));
    const selectedNodes = selectedShapes
      .filter((s) => !pickedInsets.has(s.panel) && !(isLocked(s) && selectedShapes.length > 1))
      .map((s) => docLayer.findOne(`#${s.id}`))
      .filter(Boolean);
    const selectedNode = selectedNodes.length === 1 ? selectedNodes[0] : null;
    const panelNode = !selectedNodes.length && selectedPanelId
      ? surfaceNodeOf(selectedPanelId)
      : null;
    // Panels are scale-clamped *during* the gesture: letting the transform run
    // free and clamping on release made the panel visibly snap back whenever
    // the drag overshot the 25–250% range (worst at the bounds, where a resize
    // in the blocked direction just reverted). Shapes stay unconstrained.
    // the logo or the @handle, picked for a corner-resize (aspect locked).
    // a pasted image resizes from its corners with its aspect locked, within the
    // same kind of scale bounds a panel has
    const pasteNode = !selectedNodes.length && !panelNode && selectedPasteId
      ? surfaceNodeOf(selectedPasteId)
      : null;
    // the footer is picked for its size and colour only: framed, with nothing to pull
    const sigNode = !selectedNodes.length && !panelNode && !pasteNode && selectedSig
      ? docLayer.findOne({ logo: '#sig-logo', text: '#sig-text', footer: '#proof-footer' }[selectedSig])
      : null;
    const footerPicked = !!sigNode && selectedSig === 'footer';
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
    // Crop mode owns the image: two sets of handles over one picture is a pair
    // of frames to aim at, so the selection frame steps aside until it is over.
    transformer.nodes(
      !handles || cropSurfaceId
        ? []
        : selectedNodes.length
          ? selectedNodes
          : panelNode ? [panelNode] : pasteNode ? [pasteNode] : sigNode ? [sigNode] : []
    );
    const selKind = selectedShape?.kind;
    // A cone is pulled by its own handles; a box drawn round a wedge says nothing.
    transformer.borderEnabled(selKind !== 'cone');
    // A marker is a disc and a symbol is a glyph: both keep their ratio, because
    // an oval number and a squashed symbol are not the same mark drawn bigger.
    // An inset keeps its frame's proportions, or it would show something else.
    transformer.keepRatio(
      !!sigNode || !!panelNode || !!pasteNode || selKind === 'icon' || selKind === 'number' || selKind === 'zoom'
    );
    // A cut surface is held square, so its knob turns from nothing: it settles on a
    // quarter turn and on the angles that bring its picture level again, as an
    // uncut one settles on the page's quarters, and a small step stays small.
    const held = boundPanel ?? boundPaste;
    transformer.rotationSnaps(held?.cut
      ? [90, 180, 270, ...[0, 90, 180, 270].map((quarter) => quarter - (held.rotation ?? 0))]
      : [0, 90, 180, 270]);
    transformer.rotateEnabled(
      !!panelNode || !!pasteNode
        || selKind === 'text' || selKind === 'rect' || selKind === 'ellipse' || selKind === 'icon'
        || selKind === 'freehand' || selKind === 'number' || selKind === 'blur'
    );
    // A symbol gets corners only: the side handles are what would let it be
    // stretched, and a squashed symbol is a different symbol. A freehand stroke
    // is the one kind with neither vertex handles (too many points to show) nor
    // a shape to speak of, so it takes the full set: without them a selected
    // stroke showed a dashed frame and nothing to pull, which reads as a broken
    // selection rather than a stroke that can only be moved.
    transformer.enabledAnchors(
      isLocked(selectedShape) ? [] : selKind === 'rect' || selKind === 'ellipse' || selKind === 'freehand' || selKind === 'blur'
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
        : selKind === 'text' || selKind === 'icon' || selKind === 'number' || selKind === 'zoom'
            || panelNode || pasteNode || (sigNode && !footerPicked)
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : []
    );
    if (handles) {
      drawEndHandles(surfacesOf());
      drawPanelMoveControls(boxes);
      drawCropHandles();
    } else {
      endHandles.destroyChildren();
      panelCtrls.destroyChildren();
      cropHandles.destroyChildren();
    }
    drawScenePlays(boxes);
    drawRotateKnob();
    drawGuide(width, height); // the tweet crop is a view, not a handle: it stays
    uiLayer.batchDraw();
  }

  /**
   * The stem Collage hangs its turn knob off, drawn from the middle of the top
   * edge out to the anchor. Decoration only: the anchor is what the pointer
   * grabs, and it is styled into the same dark disc by `anchorStyleFunc`.
   */
  function drawRotateKnob() {
    rotateKnob.destroyChildren();
    const anchor = transformer.nodes().length && transformer.rotateEnabled()
      ? transformer.findOne('.rotater')
      : null;
    if (!anchor) return;
    const screenScale = stage.scaleX();
    const toLocal = rotateKnob.getAbsoluteTransform().copy().invert();
    const knob = toLocal.point(anchor.getAbsolutePosition());
    // The stem runs from the middle of the frame's top edge, which is where the
    // anchor hangs off however the selection is turned.
    const edge = toLocal.point(
      transformer.getAbsoluteTransform().point({ x: transformer.width() / 2, y: 0 }),
    );
    rotateKnob.add(new Konva.Line({
      points: [edge.x, edge.y, knob.x, knob.y],
      stroke: ACCENT, strokeWidth: 1.5 / screenScale, listening: false,
    }));
  }

  /** What the selection holds for a surface: the upright group on its cut, or its own. */
  function surfaceNodeOf(id) {
    return docLayer.findOne(`#pc-${id}`) ?? docLayer.findOne(`#pg-${id}`);
  }

  /**
   * The selected surface's group, and the two ways between the draft and the
   * screen. The draft is square on the page and measured from the source's
   * middle, so the marks stand upright however far the picture is turned, and
   * pull as far as the turned picture reaches.
   */
  function cropFrameOf() {
    const item = surfaceById(cropSurfaceId);
    const group = item && docLayer.findOne(`#pg-${item.id}`);
    if (!group) return null;
    const [sw, sh] = item.sourceNatural;
    // the source's middle, in the group's own pixels
    const originX = sw / 2 - (item.crop?.x ?? 0);
    const originY = sh / 2 - (item.crop?.y ?? 0);
    const turn = item.rotation ?? 0;
    return {
      item,
      group,
      scale: group.getAbsoluteScale().x,
      reach: surfaceCutReach(item.sourceNatural, turn),
      toScreen: (x, y) => {
        const own = turned(x, y, -turn);
        return group.getAbsoluteTransform().point({ x: originX + own.x, y: originY + own.y });
      },
      toDraft: (point) => {
        const local = group.getAbsoluteTransform().copy().invert().point(point);
        return turned(local.x - originX, local.y - originY, turn);
      },
    };
  }

  /**
   * PowerPoint-style crop marks: eight black edge and corner marks, square on
   * the page. They are drawn on the ui layer so they keep their screen size at
   * any zoom; the shading behind them rides with the image.
   */
  function drawCropHandles() {
    cropHandles.destroyChildren();
    if (!cropSurfaceId || !cropDraft || tool !== 'select') return;
    const frame = cropFrameOf();
    if (!frame) return;

    const screenScale = stage.scaleX();
    const lineWidth = 3 / screenScale;
    const haloWidth = 5 / screenScale;
    const arm = 16 / screenScale;
    const hit = 24 / screenScale;

    cropHandles.add(new Konva.Line({
      name: 'crop-border', closed: true,
      stroke: '#111111', strokeWidth: 1 / screenScale, listening: false,
    }));

    const points = {
      nw: [0, arm, 0, 0, arm, 0],
      n: [-arm / 2, 0, arm / 2, 0],
      ne: [-arm, 0, 0, 0, 0, arm],
      e: [0, -arm / 2, 0, arm / 2],
      se: [0, -arm, 0, 0, -arm, 0],
      s: [-arm / 2, 0, arm / 2, 0],
      sw: [arm, 0, 0, 0, 0, -arm],
      w: [0, -arm / 2, 0, arm / 2],
    };

    for (const [key, mark] of Object.entries(points)) {
      const handle = new Konva.Group({
        name: 'crop-anchor',
        draggable: true,
        cropKey: key,
      });
      handle.add(new Konva.Rect({
        x: -hit / 2, y: -hit / 2, width: hit, height: hit,
        fill: 'transparent', name: 'crop-hit',
      }));
      handle.add(new Konva.Line({
        points: mark, stroke: '#ffffff', strokeWidth: haloWidth,
        lineCap: 'square', lineJoin: 'miter', listening: false,
      }));
      handle.add(new Konva.Line({
        points: mark, stroke: '#111111', strokeWidth: lineWidth,
        lineCap: 'square', lineJoin: 'miter', listening: false,
      }));
      let start = null;
      handle.on('dragstart', (event) => {
        event.cancelBubble = true;
        start = { ...cropDraft };
      });
      handle.on('dragmove', (event) => {
        event.cancelBubble = true;
        updateCropFromHandle(frame, key, handle.getAbsolutePosition(), start);
        positionCropHandles(frame);
      });
      // The mark follows the pointer past where the box stopped, so put it back
      // on the corner it actually framed. The crop itself waits for the exit.
      handle.on('dragend', (event) => {
        event.cancelBubble = true;
        positionCropHandles(frame);
      });
      cropHandles.add(handle);
    }
    positionCropHandles(frame);
  }

  /** Move one edge or corner of the draft, square on the page, within the picture's reach. */
  function updateCropFromHandle(frame, key, screenPoint, start) {
    if (!start) return;
    const { reach } = frame;
    const min = Math.min(reach.right - reach.left, reach.bottom - reach.top, Math.max(1, 16 / frame.scale));
    const point = frame.toDraft(screenPoint);
    const px = Math.max(reach.left, Math.min(reach.right, point.x));
    const py = Math.max(reach.top, Math.min(reach.bottom, point.y));
    let left = start.x;
    let top = start.y;
    let right = start.x + start.w;
    let bottom = start.y + start.h;
    if (key.includes('w')) left = Math.min(px, right - min);
    if (key.includes('e')) right = Math.max(px, left + min);
    if (key.includes('n')) top = Math.min(py, bottom - min);
    if (key.includes('s')) bottom = Math.max(py, top + min);
    cropDraft = { x: left, y: top, w: right - left, h: bottom - top };
  }

  function positionCropHandles(frame) {
    if (!cropDraft) return;
    const { x, y, w, h } = cropDraft;
    const corners = {
      nw: [x, y], n: [x + w / 2, y], ne: [x + w, y],
      e: [x + w, y + h / 2], se: [x + w, y + h], s: [x + w / 2, y + h],
      sw: [x, y + h], w: [x, y + h / 2],
    };
    for (const handle of cropHandles.find('.crop-anchor')) {
      const [sx, sy] = corners[handle.getAttr('cropKey')];
      handle.setAbsolutePosition(frame.toScreen(sx, sy));
    }
    const border = cropHandles.findOne('.crop-border');
    if (border) {
      const toLocal = cropHandles.getAbsoluteTransform().copy().invert();
      border.points(['nw', 'ne', 'se', 'sw'].flatMap((key) => {
        const point = toLocal.point(frame.toScreen(...corners[key]));
        return [point.x, point.y];
      }));
    }
    shadeCropGhost(frame.group.findOne('.crop-ghost'), frame.item);
    frame.group.getLayer()?.batchDraw();
    cropHandles.getLayer()?.batchDraw();
  }

  // Tweet centre-crop preview: X displays a single image with object-fit: cover
  // into a box of the chosen aspect, so it crops whatever falls outside the
  // largest centred rect of that aspect. We dim that outside region and outline
  // the safe area. Screen-only (drawn on uiLayer, never exported).
  function drawGuide(width, height) {
    guideGroup.destroyChildren();
    const aspect = guide ? TWEET_GUIDES[guide] : null;
    if (!aspect || !hasProofCanvasContent(proof)) return;
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
    if (tool !== 'select' || !s) return;
    // A model stamp turns and tilts on its ring, the turn saved on the shape.
    if (s.kind === 'icon' && isModel(s.name)) {
      drawModelRing(Konva, {
        group: endHandles, node: docLayer.findOne(`#${s.id}`), s, screen: stage.scaleX(), accent: ACCENT, edge: HANDLE_RING,
        commit: (view) => { Object.assign(s, view); dirty = true; },
      });
      return;
    }
    if (!POINT_KINDS.has(s.kind) && s.kind !== 'callout' && s.kind !== 'zoom' && s.kind !== 'cone') return;
    const surface = list.find((x) => x.id === s.panel);
    if (!surface) return;
    // the handles sit on the page, over a surface that may be turned
    const frame = surfaceFrame(surface);
    const node = docLayer.findOne(`#${s.id}`);
    const r = 7 / stage.scaleX();
    const look = { radius: r, fill: ACCENT, stroke: HANDLE_RING, strokeWidth: 2 / stage.scaleX(), draggable: true, name: 'endh' };
    if (s.kind === 'callout') {
      drawTipHandle(s, frame, look);
      return;
    }
    if (s.kind === 'zoom') {
      // a locked inset says so where it is, and offers nothing to pull
      if (isLocked(s)) drawLockHint(s);
      else drawFrameHandles(s, frame, look);
      return;
    }
    if (s.kind === 'cone') {
      drawConeHandles(s, frame, look);
      return;
    }
    if (isLink(s)) {
      drawLinkHandles(s, frame, look);
      return;
    }
    for (let vi = 0; vi < s.points.length; vi += 2) {
      const handle = new Konva.Circle({
        ...surfaceToPage({ x: s.points[vi], y: s.points[vi + 1] }, frame),
        ...look,
      });
      const apply = (commit) => {
        const { x: nx, y: ny } = holdOnSurface(pageToSurface(handle.position(), frame), frame);
        handle.position(surfaceToPage({ x: nx, y: ny }, frame));
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

  /**
   * A line's or an arrow's two ends. An end let go over a picture holds to it
   * and follows it from then on, wherever the other end is; one let go in a
   * margin is free on the page. Both on one picture make that picture's mark. An
   * end that holds is drawn the other way round, dark and ringed in the accent.
   */
  function drawLinkHandles(s, frame, look) {
    const node = docLayer.findOne(`#${s.id}`);
    const page = isFree(s)
      ? linkPoints(s, frameOf)
      : [0, 2].flatMap((i) => {
          const p = surfaceToPage({ x: s.points[i], y: s.points[i + 1] }, frame);
          return [p.x, p.y];
        });
    const held = isFree(s) ? [0, 1].map((i) => !!s.ends?.[i]) : [true, true];
    // what the end that is not moving holds to, in the shape `settleLink` reads
    const holdOf = (i) => {
      if (!isFree(s)) return { id: s.panel, nx: s.points[i * 2], ny: s.points[i * 2 + 1] };
      const tie = s.ends?.[i];
      return tie ? { id: tie.panel, nx: tie.x, ny: tie.y } : null;
    };
    [0, 1].forEach((i) => {
      const handle = new Konva.Circle({
        ...look, x: page[i * 2], y: page[i * 2 + 1],
        ...(held[i] ? { fill: HANDLE_RING, stroke: ACCENT } : {}),
      });
      const at = () => onPage(handle.position());
      handle.on('dragmove', () => {
        const p = at();
        handle.position(p);
        if (node) {
          const own = pageToSurface(p, frame);
          const pts = [...node.points()];
          pts[i * 2] = own.x;
          pts[i * 2 + 1] = own.y;
          node.points(pts);
          docLayer.batchDraw();
        }
        showLanding(pictureUnder(surfacesOf(), p));
      });
      handle.on('dragend', () => {
        const p = at();
        const other = 1 - i;
        const ends = [];
        ends[i] = { page: p, on: pictureUnder(surfacesOf(), p) };
        ends[other] = { page: { x: page[other * 2], y: page[other * 2 + 1] }, on: holdOf(other) };
        putShape(settleLink(s, ends[0], ends[1]));
        showLanding(null);
        dirty = true;
      });
      endHandles.add(handle);
    });
  }

  /**
   * A callout's point, pulled to another pixel. The label stays where it is on
   * the page, and the point lands on whichever picture it is let go over, or is
   * held to its own when it is let go over none.
   */
  function drawTipHandle(s, frame, look) {
    const tip = surfaceToPage({ x: s.x, y: s.y }, frame);
    const label = { x: tip.x + (s.dx ?? 0), y: tip.y + (s.dy ?? 0) };
    const handle = new Konva.Circle({ ...tip, ...look });
    handle.on('dragend', () => {
      const at = handle.position();
      const hit = surfaceAt(at, { page: false });
      let landed;
      if (hit) {
        s.panel = hit.id;
        landed = { x: hit.nx, y: hit.ny, frame: hit.frame };
      } else {
        landed = { ...holdOnSurface(pageToSurface(at, frame), frame), frame };
      }
      s.x = landed.x;
      s.y = landed.y;
      const point = surfaceToPage(landed, landed.frame);
      s.dx = label.x - point.x;
      s.dy = label.y - point.y;
      dirty = true;
    });
    endHandles.add(handle);
  }

  /** The lock a 24-unit glyph draws, as the side list's lock icon draws it. */
  const LOCK_GLYPH = 'M7 11V7a5 5 0 0 1 10 0v4M5 11h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1Z';

  /**
   * A picked locked inset says so in the corner of its enlargement: a small dark
   * disc with the lock, the same size on screen at any zoom, and nothing to pull.
   */
  function drawLockHint(s) {
    const node = docLayer.findOne(`#${s.id}`);
    if (!node) return;
    const z = stage.scaleX();
    const r = 11 / z;
    const box = node.getClientRect({ relativeTo: docLayer });
    const badge = new Konva.Group({ x: box.x + box.width - r - 5 / z, y: box.y + r + 5 / z, listening: false, name: 'lock-hint' });
    badge.add(new Konva.Circle({ radius: r, fill: 'rgba(16, 20, 28, 0.82)', stroke: ACCENT, strokeWidth: 1.2 / z }));
    const glyph = 13 / z;
    badge.add(new Konva.Path({
      data: LOCK_GLYPH, x: -glyph / 2, y: -glyph / 2, scaleX: glyph / 24, scaleY: glyph / 24,
      stroke: '#ffffff', strokeWidth: 2.2, lineCap: 'round', lineJoin: 'round',
    }));
    endHandles.add(badge);
  }

  /**
   * An inset's frame, reshaped from its corners on its own picture: each corner
   * pulls against the one across from it, and the enlargement follows the new
   * proportions at its own width.
   */
  function drawFrameHandles(s, frame, look) {
    const own = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    own.forEach(([x, y], i) => {
      const handle = new Konva.Rect({
        ...look, width: look.radius * 1.6, height: look.radius * 1.6,
        offsetX: look.radius * 0.8, offsetY: look.radius * 0.8,
        ...surfaceToPage({ x, y }, frame),
      });
      const [ax, ay] = own[(i + 2) % 4];
      const minSide = 4 / frame.box.scale;
      handle.on('dragend', () => {
        const { x: px, y: py } = holdOnSurface(pageToSurface(handle.position(), frame), frame);
        const w = Math.abs(px - ax);
        const h = Math.abs(py - ay);
        if (w >= minSide && h >= minSide) {
          const before = { x: s.x, y: s.y, w: s.w, h: s.h };
          s.x = Math.min(px, ax);
          s.y = Math.min(py, ay);
          s.w = w;
          s.h = h;
          // the marks drawn over the enlargement keep to what they were drawn on
          proof.shapes = reframedInsetMarks(proof.shapes, s.id, before, s);
        }
        dirty = true;
      });
      endHandles.add(handle);
    });
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

  /**
   * A ▶ in the corner of each panel cut from a video, which opens the scene's player
   * on its frame. Drawn with the handles, never on the page, so no export carries it,
   * and only for Select: a drawing tool holds the canvas alone. The Scene tab's box hides
   * them all (`prefs.proofScenePlays`).
   */
  function drawScenePlays(boxes = boxesOf()) {
    scenePlays.destroyChildren();
    if (tool !== 'select' || cropSurfaceId || !prefs.proofScenePlays) return;
    const k = stage.scaleX();
    const r = 11 / k;
    for (const frame of sceneFrames) {
      const box = boxes[proof.panels.findIndex((p) => p.id === frame.panel)];
      if (!box) continue;
      const g = new Konva.Group({ x: box.x + 8 / k + r, y: box.y + 8 / k + r, name: 'scene-play' });
      g.add(new Konva.Circle({
        radius: r, fill: 'rgba(16, 20, 28, 0.78)',
        stroke: frame.video === scene.star ? ACCENT : 'rgba(255, 255, 255, 0.55)', strokeWidth: 1.5 / k,
      }));
      g.add(new Konva.Line({
        points: [-3 / k, -5 / k, 5.5 / k, 0, -3 / k, 5 / k], closed: true, fill: TEXT_MAIN, listening: false,
      }));
      // swallow the press so the stage doesn't treat it as an empty-deselect
      g.on('pointerdown', (e) => { e.cancelBubble = true; });
      g.on('click tap', (e) => {
        e.cancelBubble = true;
        playPanelScene(frame);
      });
      g.on('pointerenter', () => { containerEl.style.cursor = 'pointer'; });
      g.on('pointerleave', () => { containerEl.style.cursor = ''; });
      scenePlays.add(g);
    }
  }

  /**
   * The scene's time on a panel of its video, bottom left on the picture: the clip's
   * name and the moment the frame shows in. Sized in page pixels like any ink, a little
   * over the captions it reads beside, so it reads the same on every panel and still
   * once a post shrinks the picture; drawn on the page, so the export carries it.
   */
  function sceneBadgeNode(text, image, scale) {
    const k = 1 / scale; // page pixels → the picture's own
    const size = Math.round((proof.captionSize ?? CAPTION_SIZE) * 1.1);
    const pad = Math.round(size * 0.45);
    const margin = Math.round(size * 0.6);
    const words = new Konva.Text({
      x: pad * k, y: pad * k, text, fontSize: size * k, fontFamily: proofFace(),
      fill: '#ffffff', wrap: 'none', ellipsis: true, listening: false,
    });
    const most = image[0] - 2 * (margin + pad) * k;
    if (words.width() > most) words.width(Math.max(0, most));
    const w = words.width() + 2 * pad * k;
    const h = words.height() + 2 * pad * k;
    const badge = new Konva.Group({ x: margin * k, y: image[1] - margin * k - h, name: 'scene-badge', listening: false });
    badge.add(new Konva.Rect({ width: w, height: h, cornerRadius: 4 * k, fill: 'rgba(0, 0, 0, 0.62)' }));
    badge.add(words);
    return badge;
  }

  /**
   * A double-click that writes on a mark: a label's or a callout's words, a
   * box's tag. Read off the browser's own double-click rather than Konva's, which
   * is only reported when both presses land on one node: a first press that
   * draws the page again (a legend line it commits, say) leaves a new node under
   * the second, and the double-click was lost. Both presses were still on the
   * same mark, and that is what is asked. A label or a callout that Konva did
   * hear has its editor open already, which is what `textEdit` says.
   */
  function onCanvasDblClick(event) {
    if (tool !== 'select' || textEdit || !stage) return;
    const at = targetUnder(event);
    if (at.caption || at.footer) {
      if (at.caption) startCaptionEdit(at.caption);
      else startFooterEdit();
      event.preventDefault();
      return;
    }
    const s = at.shape;
    if (!s) return;
    if (s.kind === 'rect') startTagEdit(s);
    else if (s.kind === 'text' || s.kind === 'callout') startTextEdit(s);
    else return;
    event.preventDefault();
  }

  /**
   * What a browser pointer event is over: a mark, a panel, an overlay, or only
   * the page. A box's tag answers for its box.
   */
  function targetUnder(event) {
    stage.setPointersPositions(event);
    let node = stage.getIntersection(stage.getPointerPosition());
    for (; node; node = node.getParent()) {
      const id = node.getAttr('markId') ?? node.id();
      if (!id) continue;
      const shape = proof.shapes.find((x) => x.id === id);
      if (shape) return { shape };
      if (id === 'proof-footer') return { footer: true };
      if (id.startsWith('cap-')) {
        const caption = proof.panels.find((p) => p.id === id.slice(4));
        if (caption) return { caption };
      }
      if (!id.startsWith('pg-')) continue;
      const panelIndex = proof.panels.findIndex((p) => p.id === id.slice(3));
      if (panelIndex >= 0) return { panel: proof.panels[panelIndex], panelIndex };
      const pasteIndex = proof.pastes.findIndex((p) => p.id === id.slice(3));
      if (pasteIndex >= 0) return { paste: proof.pastes[pasteIndex], pasteIndex };
    }
    return {};
  }

  // A mark is drawn over the marks of its own picture, or over every picture
  // for a callout, an inset or a free mark (whose `panel` is the page already),
  // so that is what a step in the stack steps past.
  const stackLayer = (s) => (isPageMark(s) ? 'page' : s.panel);

  /**
   * Hold an inset in place, or let it go. Locked, no press or drag moves it or
   * resizes it, and a press on it draws or picks the marks over it; the side
   * list and its right-click still reach it. Stored as `locked` on the mark,
   * absent when it is not (lib/insetMarks.isLocked).
   */
  function setLocked(s, on) {
    const shape = proof.shapes.find((x) => x.id === s?.id);
    if (!shape || isLocked(shape) === on) return;
    if (on) shape.locked = true;
    else delete shape.locked;
    dirty = true;
  }

  /** Bring the picked marks to the front or forward, send them backward or to the back. */
  function restack(how) {
    const next = restacked(proof.shapes, selectedIds, how, stackLayer);
    if (next === proof.shapes) return;
    proof.shapes = next;
    dirty = true;
  }

  let ctxMenu = $state(null);

  /**
   * The right-click's one say on where a mark belongs. A mark is anchored by
   * where it is let go: on a picture it follows that picture, in a margin it is
   * free. A free mark out in a margin can still be pinned to the picture nearest
   * it, to follow it from out there.
   */
  function anchorItems() {
    const loose = editableShapes.filter((s) => canBeFree(s.kind) && !holdsToPicture(s));
    if (!loose.length) return [];
    const nearest = loose.length === 1 ? nearestPicture(anchorOf(loose[0])) : null;
    if (loose.length === 1 && !nearest) return [];
    return [{
      label: nearest ? `Pin to ${surfaceLabel(nearest)}` : 'Pin each to the nearest picture',
      icon: 'anchorPicture',
      run: () => {
        loose.forEach(pinShape);
        dirty = true;
      },
    }, 'sep'];
  }

  /**
   * The canvas's right-click. It never opens the browser's own menu here: this
   * is a drawing surface, and a right-click answers with what can be done to
   * what is under the pointer. A mark not yet picked is picked first, as it is
   * in every editor. A drawing tool in hand keeps the canvas to itself, so the
   * right button stays silent then, as it neither draws nor drops a pick.
   */
  function onCanvasContextMenu(event) {
    event.preventDefault();
    if (!stage || tool !== 'select' || drawing || pathDraft || textEdit || cropSurfaceId) return;
    const at = targetUnder(event);
    const keys = (k) => shortcut(k);
    let title = '';
    let items = [];
    if (at.shape && isLocked(at.shape)) {
      // A locked inset is not picked by a press, a right-click included: its menu
      // acts on it where it stands.
      const inset = at.shape;
      title = 'Zoom inset';
      items = [
        { label: 'Unlock', icon: 'unlock', run: () => setLocked(inset, false) },
        'sep',
        { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, run: () => deleteShape(inset.id) },
      ];
    } else if (at.shape) {
      if (!selectedIds.includes(at.shape.id)) pickShape(at.shape.id);
      const many = selectedIds.length > 1;
      const can = (how) => restacked(proof.shapes, selectedIds, how, stackLayer) !== proof.shapes;
      title = many ? `${selectedIds.length} marks` : (KIND_LABEL[at.shape.kind] ?? 'Mark');
      items = [
        { label: 'Bring to front', keys: keys('Ctrl+Shift+↑'), run: () => restack('front'), disabled: !can('front') },
        { label: 'Bring forward', icon: 'chevronUp', keys: keys('Ctrl+↑'), run: () => restack('forward'), disabled: !can('forward') },
        { label: 'Send backward', icon: 'chevronDown', keys: keys('Ctrl+↓'), run: () => restack('backward'), disabled: !can('backward') },
        { label: 'Send to back', keys: keys('Ctrl+Shift+↓'), run: () => restack('back'), disabled: !can('back') },
        'sep',
        ...anchorItems(),
        ...(at.shape.kind === 'zoom' && !many
          ? [{ label: 'Lock position', icon: 'lock', run: () => setLocked(at.shape, true) }, 'sep']
          : []),
        { label: 'Duplicate', icon: 'copy', keys: keys('Ctrl+D'), run: () => duplicateSelection() },
        { label: 'Copy', icon: 'clipboard', keys: keys('Ctrl+C'), run: () => copySelection() },
        'sep',
        { label: 'Delete', icon: 'trash', keys: 'Del', danger: true, run: deleteSelected },
      ];
    } else if (at.caption) {
      selectPanel(at.caption.id);
      title = 'Caption';
      items = [{ label: 'Edit caption', icon: 'edit', run: () => startCaptionEdit(at.caption) }];
    } else if (at.footer) {
      selectSig('footer');
      title = 'Footer';
      items = [{
        label: 'Edit credit line', icon: 'edit', run: startFooterEdit, disabled: proof.footerText === false,
      }];
    } else if (at.panel || at.paste) {
      const item = at.panel ?? at.paste;
      const index = at.panel ? at.panelIndex : at.pasteIndex;
      const list = at.panel ? proof.panels : proof.pastes;
      const move = (delta) => (at.panel ? movePanelZ(index, delta) : movePasteZ(index, delta));
      if (at.panel) selectPanel(item.id);
      else selectPaste(item.id);
      title = at.panel ? 'Panel' : 'Overlay';
      // Panels only overlap in free layout; in the grid their order is the grid's.
      const stacks = at.paste || proof.layout === 'free';
      items = [
        ...(stacks ? [
          { label: 'Bring to front', run: () => move(-index), disabled: index === 0 },
          { label: 'Bring forward', icon: 'chevronUp', run: () => move(-1), disabled: index === 0 },
          { label: 'Send backward', icon: 'chevronDown', run: () => move(1), disabled: index === list.length - 1 },
          { label: 'Send to back', run: () => move(list.length - 1 - index), disabled: index === list.length - 1 },
          'sep',
        ] : []),
        { label: 'Crop', icon: 'crop', run: () => beginSurfaceCrop(item) },
        // what was copied, set at the same place on this picture
        ...(clipboard ? [{ label: 'Paste', icon: 'clipboard', keys: keys('Ctrl+V'), run: () => pasteClip(clipboard, item.id) }] : []),
        'sep',
        {
          label: at.panel ? 'Remove panel' : 'Remove overlay', icon: 'trash', danger: true,
          run: () => (at.panel ? removePanel(index) : removePaste(index)),
        },
      ];
    } else {
      items = [
        ...(clipboard ? [{ label: 'Paste', icon: 'clipboard', keys: keys('Ctrl+V'), run: () => pasteClip(clipboard, null) }, 'sep'] : []),
        { label: 'Fit view', icon: 'eye', keys: 'F', run: fit },
      ];
    }
    ctxMenu = { x: event.clientX, y: event.clientY, title, items };
  }

  /**
   * The point a mark answers for when it is let go, in its surface's pixels.
   * Boxed kinds answer for their middle, a polyline for the mean of its
   * vertices, and everything else for the origin it is drawn from. Sorted by
   * what the shape holds rather than by a list of kinds: a numbered marker and
   * a blur box both used to fall through to the polyline branch, where reading
   * the points they have none of threw inside `dragend` — so the drop was
   * never written down and the mark sprang back to where it had been picked up.
   */
  function anchorOf(s) {
    if (s.kind === 'rect' || s.kind === 'blur' || s.kind === 'zoom') {
      const turn = ((s.rotation ?? 0) * Math.PI) / 180;
      const hw = (s.w ?? 0) / 2;
      const hh = (s.h ?? 0) / 2;
      return {
        x: s.x + hw * Math.cos(turn) - hh * Math.sin(turn),
        y: s.y + hw * Math.sin(turn) + hh * Math.cos(turn),
      };
    }
    if (!Array.isArray(s.points)) return { x: s.x, y: s.y };
    let sx = 0, sy = 0;
    for (let i = 0; i < s.points.length; i += 2) { sx += s.points[i]; sy += s.points[i + 1]; }
    return { x: sx / (s.points.length / 2), y: sy / (s.points.length / 2) };
  }

  /**
   * Where a mark let go at a page point belongs, or null to stay where it is: the
   * picture it is let go over, which it follows from then on, or the page when it
   * is let go in a margin, if it means anything there. One let go above or left of
   * the page stays where it belonged.
   */
  function landingFor(s, point, list = surfacesOf()) {
    const free = canBeFree(s.kind);
    // let go over an inset it belongs to the inset, if it means anything there
    const hit = pictureUnder(free ? list : list.filter((x) => x.kind !== INSET), point);
    if (hit) return hit.id !== s.panel ? hit : null;
    // In a margin a picture's mark comes free, unless it was pinned out there
    // and is only being moved about out there.
    if (!free || pinnedOut.has(s.id)) return null;
    const page = pageHit(list, point);
    return page && page.id !== s.panel ? page : null;
  }

  /**
   * The marks being dragged that a picture holds from outside it, pinned out in
   * its margin: filled as a drag starts, emptied once it has landed.
   */
  const pinnedOut = new Set();

  /** Whether a picture's mark stands outside its picture: pinned out in a margin. */
  function outsideOwnPicture(s) {
    if (isFree(s)) return false;
    const frame = frameOf(s.panel);
    if (!frame) return false;
    return !surfaceShows(anchorOf(s), frame);
  }

  /**
   * Hold a free mark on the page: one taken past its left or top edge comes back
   * to it, since the page grows right and down only. Past the other two, the
   * page grows to hold it.
   */
  function keepOnPage(s) {
    if (!isFree(s)) return;
    const b = markBounds(s, inkHelpers);
    if (!b) return;
    const dx = Math.max(0, -b.left);
    const dy = Math.max(0, -b.top);
    if (dx || dy) Object.assign(s, s.ends ? nudgedLink(s, dx, dy, frameOf) : nudgeShape(s, dx, dy));
  }

  /**
   * Where a dropped mark now belongs (see `landingFor`): the picture it is let
   * go over, which it follows from then on, or the page in a margin. The drag is already
   * folded into the shape, in the pixels of the surface it was picked up on. A
   * surface it was carried onto takes it in its own pixels, unchanged on the
   * page; one it never left keeps it as it is, which is how a mark keeps
   * belonging to its panel.
   */
  function landShape(s) {
    const list = surfacesOf();
    const fromEntry = list.find((x) => x.id === s.panel);
    if (!fromEntry) return;
    const from = surfaceFrame(fromEntry);
    const to = landingFor(s, surfaceToPage(anchorOf(s), from), list);
    if (to) Object.assign(s, moveShapeToSurface(s, from, to.frame), { panel: to.id });
    keepOnPage(s);
    // Come onto the page, it goes in front of what the page holds: it was let go
    // over an inset or a callout, most likely to say something about it.
    if (to?.id === PAGE) proof.shapes = restacked(proof.shapes, [s.id], 'front', stackLayer);
  }

  /** What a surface is called on the canvas, the way the side lists number them. */
  function surfaceLabel(entry) {
    if (entry.id === PAGE) return 'Free on the page';
    if (entry.kind === INSET) return insetCount() > 1 ? `Zoom inset ${entry.index + 1}` : 'Zoom inset';
    if (entry.kind === 'published') return proof.published.length > 1 ? `Picture ${entry.index + 1}` : 'Picture';
    return entry.kind === 'paste' ? `Overlay ${entry.index + 1}` : `Panel ${entry.index + 1}`;
  }

  /**
   * Outline the surface a dragged mark or end will belong to once let go, and
   * name it: the picture it is carried onto, or the whole page for a mark taken
   * out into a margin. Null takes the outline down.
   */
  function showLanding(entry) {
    if (!landingGuide) return;
    landingGuide.destroyChildren();
    if (entry) {
      const z = stage.scaleX();
      const frame = entry.frame ?? surfaceFrame(entry);
      const corners = surfaceCorners(frame);
      landingGuide.add(new Konva.Line({
        points: corners.flatMap((p) => [p.x, p.y]), closed: true,
        stroke: ACCENT, strokeWidth: 2 / z, dash: [8 / z, 5 / z], fill: 'rgba(232, 163, 61, 0.07)',
      }));
      const left = Math.min(...corners.map((p) => p.x));
      const top = Math.min(...corners.map((p) => p.y));
      const chip = new Konva.Label({ x: left + 8 / z, y: top + 8 / z });
      chip.add(new Konva.Tag({ fill: ACCENT, cornerRadius: 4 / z }));
      chip.add(new Konva.Text({
        text: surfaceLabel(entry), fontSize: 12 / z, padding: 5 / z, fontStyle: 'bold',
        fontFamily: 'system-ui, sans-serif', fill: HANDLE_RING,
      }));
      landingGuide.add(chip);
    }
    uiLayer.batchDraw();
  }

  /** Where a mark being dragged would land if let go now, or null for where it is. */
  function landingOfDrag(s, node) {
    if (isPageMark(s) || isLink(s)) return null;
    const frame = frameOf(s.panel);
    if (!frame) return null;
    const moved = Array.isArray(s.points)
      ? { ...s, points: s.points.map((v, i) => v + (i % 2 === 0 ? node.x() : node.y())) }
      : { ...s, x: node.x(), y: node.y() };
    return landingFor(s, surfaceToPage(anchorOf(moved), frame));
  }

  /** Replace a mark by its settled copy, in the same place in the stack. */
  function putShape(next) {
    const i = proof.shapes.findIndex((x) => x.id === next.id);
    if (i >= 0) proof.shapes[i] = next;
  }

  /**
   * A link with its ends moved by `step` (`[dx0, dy0, dx1, dy1]`, in its
   * surface's pixels), settled again: each end holds to the picture it now lies
   * over, or comes free in a margin.
   */
  function relinked(s, step) {
    const frame = frameOf(s.panel);
    if (!frame) return s;
    const own = s.ends ? linkPoints(s, frameOf) : s.points;
    const moved = own.map((v, i) => v + step[i]);
    const list = surfacesOf();
    const end = (i) => {
      const page = onPage(surfaceToPage({ x: moved[i * 2], y: moved[i * 2 + 1] }, frame));
      return { page, on: pictureUnder(list, page) };
    };
    return settleLink(s, end(0), end(1));
  }

  /** One annotation into its surface's group, a box with its tag. */
  function addSurfaceShape(group, s, box, surface) {
    const node = makeShapeNode(s, box, surface);
    group.add(node);
    if (s.kind === 'rect' && s.tag) group.add(makeTagNode(s, node, box.scale));
  }

  // Words and lines are sized apart: a tag, a callout's label and a label's words
  // grow on their own, without the line they hang from or are framed by.
  const tagSizeOf = (s) => s.tagSize ?? tagFont(s.strokeWidth ?? 4);
  const labelFrameOf = (s) => s.frameWidth ?? Math.max(2, Math.round((s.fontSize ?? 28) * 0.07));
  const badgeOf = (s) => s.badge ?? CONE_BADGE;

  /** The tab a box's tag is written on, measured in the surface's own units. */
  function tagLayout(s, k) {
    const fontSize = tagSizeOf(s);
    const text = new Konva.Text({
      text: s.tag || ' ', fontSize: fontSize / k, fontFamily: proofFace(),
      fontStyle: markWeight(), fill: glyphInk(s.color, 1), listening: false,
    });
    const padX = (fontSize * 0.3) / k;
    const padY = (fontSize * 0.15) / k;
    return { text, fontSize, padX, padY, w: text.width() + padX * 2, h: text.height() + padY * 2 };
  }

  /**
   * A box's tag: its words on a tab of the box's own colour, hung from one of
   * its corners. Part of the box rather than a mark of its own: it follows the
   * box as it is dragged, resized or turned, a press on it picks the box, and a
   * double-click edits its words.
   */
  function makeTagNode(s, rect, k) {
    const { text, padX, padY, w, h } = tagLayout(s, k);
    const plate = new Konva.Rect({ width: w, height: h, fill: s.color });
    // a press on the tab is a press on its box, double-click included
    const tab = new Konva.Group({ name: 'box-tag', markId: s.id });
    tab.add(plate, text);
    const place = () => {
      const size = [rect.width() * Math.abs(rect.scaleX()), rect.height() * Math.abs(rect.scaleY())];
      const line = (s.strokeWidth ?? 4) / k;
      const at = tagBox(...size, w, h, s.tagAt, line);
      tab.setAttrs({ x: rect.x(), y: rect.y(), rotation: rect.rotation() });
      const painted = tagPlate(...size, w, h, s.tagAt, line);
      plate.setAttrs({ x: painted.x, y: painted.y, width: painted.w, height: painted.h });
      text.position({ x: at.x + padX, y: at.y + padY });
    };
    place();
    rect.on('dragmove transform', place);
    bindShapePick(tab, s);
    tab.on('dblclick dbltap', (e) => { e.cancelBubble = true; });
    return tab;
  }

  /**
   * Open the editor on a box's tag. A box without one is given one first, from
   * its top-left corner, worded as its colour's line in the legend when it has
   * one: the colour already names the feature, so the tag starts from that name.
   */
  function startTagEdit(s) {
    const frame = frameOf(s.panel);
    if (!frame || s.kind !== 'rect') return;
    const fresh = !s.tag;
    if (fresh) {
      s.tag = proof.notes?.[s.color]?.trim() || 'Label';
      s.tagAt = s.tagAt ?? 'tl';
      // sized off the line it hangs from, and its own from then on
      s.tagSize = tagFont(s.strokeWidth ?? 4);
      dirty = true;
    }
    const k = frame.box.scale;
    const { text, fontSize, padX, padY, w, h } = tagLayout(s, k);
    text.destroy();
    const at = tagBox(s.w, s.h, w, h, s.tagAt, (s.strokeWidth ?? 4) / k);
    const turn = ((s.rotation ?? 0) * Math.PI) / 180;
    const lx = at.x + padX;
    const ly = at.y + padY;
    const page = surfaceToPage({
      x: s.x + lx * Math.cos(turn) - ly * Math.sin(turn),
      y: s.y + lx * Math.sin(turn) + ly * Math.cos(turn),
    }, frame);
    selectedIds = [s.id];
    textEdit = {
      font: proofFace(), weight: markWeight() === 'bold' ? 700 : 400,
      id: s.id,
      field: 'tag',
      fresh,
      value: s.tag,
      left: stage.x() + page.x * stage.scaleX(),
      top: stage.y() + page.y * stage.scaleY(),
      size: fontSize * stage.scaleX(),
      color: glyphInk(s.color, 1),
    };
  }

  // ---- free on the page -------------------------------------------------------

  /** The picture nearest a page point, over it or beside it, with its frame. */
  function nearestPicture(point) {
    let best = null;
    for (const entry of surfaces(proof)) {
      const frame = surfaceFrame(entry);
      const corners = surfaceCorners(frame);
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const dx = Math.max(Math.min(...xs) - point.x, 0, point.x - Math.max(...xs));
      const dy = Math.max(Math.min(...ys) - point.y, 0, point.y - Math.max(...ys));
      const away = Math.hypot(dx, dy);
      if (!best || away < best.away) best = { ...entry, frame, away };
    }
    return best;
  }

  /**
   * Pin a free mark to the picture nearest it, unchanged where it is drawn: it
   * follows that picture from then on, out in its margin. It stays pinned when
   * dragged about out there (see `pinnedOut`), and a drag onto a picture or
   * back into a margin from inside one anchors it again by where it lands.
   */
  function pinShape(s) {
    if (holdsToPicture(s)) return;
    const page = frameOf(PAGE);
    const to = nearestPicture(anchorOf(s));
    if (page && to) putShape({ ...moveShapeToSurface(s, page, to.frame), panel: to.id });
  }

  /** Draw the picked lines solid, dashed or dotted, and the next one the same way. */
  function setDash(style) {
    for (const s of editableShapes) {
      if (!DASHABLE.has(s.kind)) continue;
      if (style === 'solid') delete s.dash;
      else s.dash = style;
      dirty = true;
    }
    lineStyle = style;
  }

  /** The picked label's frame and the plate behind its words. */
  function setTextBox(patch) {
    const s = editableShape;
    if (s?.kind !== 'text') return;
    if ('frame' in patch) s.frame = patch.frame;
    if ('bg' in patch) s.bg = patch.bg;
    dirty = true;
  }

  /** Hang the picked box's tag from another corner, give it one, or take it off. */
  function setTagAt(at) {
    const s = editableShape;
    if (s?.kind !== 'rect') return;
    if (at === 'none') {
      if (!s.tag) return;
      delete s.tag;
      delete s.tagAt;
    } else {
      s.tagAt = at;
      // a frame later, so the press on the control does not take the focus back
      if (!s.tag) requestAnimationFrame(() => startTagEdit(s));
    }
    dirty = true;
  }

  // The node for one annotation, inside its surface's group. That group is scaled
  // to the surface (`box.scale`, its pixels to the page) while ink is measured in
  // page pixels, so every width and size is divided by the scale here: a 4 px
  // line is 4 px on any panel or overlay, whatever its resolution or size.
  function makeShapeNode(s, box, surface) {
    const k = box.scale;
    if (s.kind === 'text') {
      // The glyph itself: always built first so its measured size drives the
      // optional frame/background box. Unboxed, it's also the interactive node.
      const fontSize = s.fontSize ?? 28;
      const textNode = new Konva.Text({
        x: 0, y: 0, text: s.text || ' ',
        fontSize: fontSize / k, fontFamily: proofFace(),
        fontStyle: markWeight(), fill: s.color,
      });
      const boxed = s.frame || s.bg;
      let node; // the draggable/transformable/selectable node (group when boxed)
      if (boxed) {
        const pad = textBoxPad(fontSize) / k;
        const w = textNode.width() + pad * 2;
        const h = textNode.height() + pad * 2;
        const frameSW = labelFrameOf(s) / k;
        node = new Konva.Group({ id: s.id, x: s.x, y: s.y, rotation: s.rotation ?? 0, draggable: true });
        // invisible full-box hit target — clicking/dragging the padding (not
        // just the glyph or the frame stroke) must still select this element
        node.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: 'transparent', listening: true }));
        if (s.bg) {
          node.add(new Konva.Rect({ x: 0, y: 0, width: w, height: h, fill: s.bg, cornerRadius: 4 / k, listening: false }));
        }
        if (s.frame) {
          node.add(new Konva.Rect({
            x: 0, y: 0, width: w, height: h, stroke: s.color, strokeWidth: frameSW,
            cornerRadius: 4 / k, listening: false,
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
        s.x = node.x();
        s.y = node.y();
        landShape(s);
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
    if (s.kind === 'cone') {
      return makeConeNode(s, k, surface?.rotation ?? 0, {
        image: surface ? imageSizeOf(surface) : null, outline: cutOutlineOf(surface),
      });
    }
    if (s.kind === 'icon') return makeIconNode(s, k);
    if (s.kind === 'number') return makeNumberNode(s, k);
    if (s.kind === 'blur') return makeBlurNode(s, surface);
    const sw = (s.strokeWidth ?? 4) / k;
    const dash = dashPattern(s.dash, s.strokeWidth ?? 4);
    const common = {
      id: s.id, stroke: s.color, strokeWidth: sw, rotation: s.rotation ?? 0,
      draggable: true, hitStrokeWidth: Math.max(sw * 3, 14 / k),
      ...(dash ? { dash: dash.map((v) => v / k), lineCap: s.dash === 'dot' ? 'round' : 'butt' } : {}),
    };
    const paint = canFill(s.kind) ? fillPaint(s.color, s.fillOpacity) : null;
    let node;
    if (s.kind === 'rect') {
      node = new Konva.Rect({
        x: s.x, y: s.y, width: s.w, height: s.h, cornerRadius: 2, fill: paint, ...common,
      });
      // A double-click on a box writes its tag (see onCanvasDblClick), so it must
      // not reach the panel under it, which would open its crop marks.
      node.on('dblclick dbltap', (e) => { e.cancelBubble = true; });
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
        // a link's ends are where the pictures they hold to have them now
        points: s.ends ? linkPoints(s, frameOf) : s.points,
        pointerLength: s.kind === 'arrow' ? ARROW_HEAD / k : 0,
        pointerWidth: s.kind === 'arrow' ? ARROW_HEAD / k : 0,
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
        s.x = node.x();
        s.y = node.y();
      } else if (isLink(s)) {
        // each end holds to the picture it is let go over, or comes free in a margin
        const dx = node.x(), dy = node.y();
        node.position({ x: 0, y: 0 });
        putShape(relinked(s, [dx, dy, dx, dy]));
        dirty = true;
        return;
      } else {
        // points-based shapes: fold the drag offset into every vertex
        const dx = node.x(), dy = node.y();
        s.points = s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
        node.position({ x: 0, y: 0 });
      }
      landShape(s);
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
  /**
   * A numbered marker: a filled disc carrying its number.
   *
   * Filled rather than outlined, and the ink read off the colour, because this
   * one has to survive being printed over anything — a numeral in a thin line
   * over a bright roof is a numeral nobody can read.
   */
  function makeNumberNode(s, k) {
    const size = s.size ?? ICON_SIZE_DEFAULT;
    const side = size / k; // drawn inside the surface's scale
    const ink = glyphInk(s.color, 1);
    const group = new Konva.Group({
      id: s.id, x: s.x, y: s.y, rotation: s.rotation ?? 0, draggable: true,
    });
    group.add(new Konva.Circle({
      x: 0, y: 0, radius: side / 2, fill: s.color,
      stroke: ink, strokeWidth: Math.max(size * 0.04, 0.5) / k,
    }));
    const label = new Konva.Text({
      text: String(s.n ?? 1), fontSize: side * 0.58, fontStyle: 'bold',
      fontFamily: proofFace(), fill: ink, listening: false,
    });
    label.position({ x: -label.width() / 2, y: -label.height() / 2 });
    group.add(label);
    bindShapePick(group, s);
    group.on('dragstart', () => {
      dragMoved = true;
      group.getParent()?.moveToTop();
    });
    group.on('dragend', () => {
      s.x = group.x();
      s.y = group.y();
      landShape(s);
      dirty = true;
    });
    group.on('transformend', () => {
      s.size = Math.max(ICON_SIZE_MIN, Math.abs(size * group.scaleX()));
      s.x = group.x();
      s.y = group.y();
      s.rotation = group.rotation();
      group.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return group;
  }

  /**
   * A box that hides what is under it, by redrawing the picture through a blur.
   *
   * Not paint: the same source image is drawn again, cropped to the box and
   * filtered, so what comes out is the picture's own pixels made unreadable
   * rather than a rectangle laid over evidence. It follows the panel's turn and
   * crop because it lives in the panel's own space, and it is rebuilt as it is
   * dragged so the patch always shows the ground it is standing on.
   *
   * A blur is only ever as strong as the box is big (`blurRadiusFor`). Where the
   * surface has no picture — an image still loading — the box is drawn solid
   * instead, because a blur box that shows nothing is a blur box that hides
   * nothing.
   */
  function makeBlurNode(s, surface, { live = true } = {}) {
    const radius = blurRadiusFor(s);
    const turn = s.rotation ?? 0;
    const group = new Konva.Group({
      // a zoom inset draws a still copy: same pixels, nothing to pick or drag
      ...(live ? { id: s.id, draggable: true } : { listening: false }),
      x: s.x, y: s.y, rotation: turn,
      // The filter reads a margin of ground around the box; the clip is what
      // keeps the box the size it was drawn.
      clip: { x: 0, y: 0, width: s.w, height: s.h },
    });
    // The transformer and the marquee both measure a node by what it draws, and
    // Konva measures a group by its children without looking at the clip — so
    // this one measured a blur's margin past its own edges, and the frame stood
    // that far off the box it was framing. It is the box.
    group.getClientRect = ({ skipTransform, relativeTo } = {}) => {
      const rect = { x: 0, y: 0, width: s.w, height: s.h };
      if (skipTransform) return rect;
      const at = group.getAbsoluteTransform(relativeTo);
      const corners = [[0, 0], [s.w, 0], [s.w, s.h], [0, s.h]]
        .map(([x, y]) => at.point({ x, y }));
      const xs = corners.map((p) => p.x);
      const ys = corners.map((p) => p.y);
      const left = Math.min(...xs);
      const top = Math.min(...ys);
      return { x: left, y: top, width: Math.max(...xs) - left, height: Math.max(...ys) - top };
    };
    // The whole box catches the pointer, including the part hanging off the
    // picture: what is selected has to be what is drawn.
    group.add(new Konva.Rect({
      name: 'blur-hit', x: 0, y: 0, width: s.w, height: s.h, fill: 'transparent', listening: true,
    }));

    const paint = () => {
      for (const node of group.find('.blur-fill')) node.destroy();
      // A turned box still hides the ground it stands on: the patch is read
      // upright and turned back the other way inside the box (`blurPatch`).
      const patch = surface?.img
        ? blurPatch(
            { x: group.x(), y: group.y(), w: s.w, h: s.h, rotation: group.rotation() },
            surface.sourceNatural,
            surface.crop,
            radius
          )
        : null;
      const node = patch
        ? new Konva.Image({
            name: 'blur-fill', image: surface.img,
            x: patch.dx, y: patch.dy, rotation: patch.turn,
            width: patch.w, height: patch.h, crop: patch.crop,
            filters: [Konva.Filters.Blur], blurRadius: radius, listening: false,
          })
        : new Konva.Rect({
            name: 'blur-fill', x: 0, y: 0, width: s.w, height: s.h,
            fill: 'rgba(20, 22, 26, 0.92)', listening: false,
          });
      // On a cut picture the patch stops at the cut, as it stops at a crop: what
      // the cut hides is not shown again, even blurred.
      const outline = patch ? cutOutlineOf(surface) : null;
      if (outline) {
        const toBox = group.getTransform().copy().invert();
        const own = outline.map((p) => toBox.point(p));
        const held = new Konva.Group({ name: 'blur-fill', clipFunc: (ctx) => traceOutline(ctx, own), listening: false });
        node.name('');
        held.add(node);
        group.add(held);
        node.cache();
        held.moveToTop();
        return;
      }
      group.add(node);
      if (patch) node.cache();
      node.moveToTop();
    };
    paint();
    if (!live) return group;

    bindShapePick(group, s);
    group.on('dragstart', () => {
      dragMoved = true;
      group.getParent()?.moveToTop();
    });
    // The patch is rebuilt as the box is moved and as it is turned, so what it
    // shows is always the ground it is standing on rather than a picture of
    // where it started. A resize waits for the release: the box's own size only
    // changes there, and until then the scale is doing the work.
    group.on('dragmove', paint);
    group.on('transform', paint);
    group.on('dragend', () => {
      s.x = group.x();
      s.y = group.y();
      landShape(s);
      dirty = true;
    });
    group.on('transformend', () => {
      s.w = Math.max(4, Math.abs(s.w * group.scaleX()));
      s.h = Math.max(4, Math.abs(s.h * group.scaleY()));
      s.x = group.x();
      s.y = group.y();
      s.rotation = group.rotation();
      group.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return group;
  }

  function makeIconNode(s, scale) {
    const entry = iconByName(s.name);
    const placed = s.size ?? ICON_SIZE_DEFAULT;
    const size = placed / scale; // drawn inside the surface's scale
    const origin = iconOrigin(s.name, size);
    const group = new Konva.Group({
      id: s.id, x: s.x, y: s.y, rotation: s.rotation ?? 0, draggable: true,
    });
    // A stroked glyph is mostly holes, so a press has to land on the box rather
    // than on a 2px line. Invisible to the eye, not to the hit canvas.
    group.add(new Konva.Rect({
      x: origin.x, y: origin.y, width: size, height: size, fill: '#000', opacity: 0,
    }));
    // The badge disc and the symbol come from `lib/proofStamp.js`. A name this
    // build does not know keeps its box, so it can still be picked and deleted.
    if (entry) for (const node of stampNodes(Konva, s, { size, scale, origin })) group.add(node);
    bindShapePick(group, s);
    group.on('dragstart', () => {
      dragMoved = true;
      group.getParent()?.moveToTop();
    });
    group.on('dragend', () => {
      s.x = group.x();
      s.y = group.y();
      landShape(s);
      dirty = true;
    });
    group.on('transformend', () => {
      // Uniform by construction: the transformer keeps the ratio and offers
      // corners only, so either axis answers for the new side.
      s.size = Math.max(ICON_SIZE_MIN, Math.abs(placed * group.scaleX()));
      s.x = group.x();
      s.y = group.y();
      s.rotation = group.rotation();
      group.scale({ x: 1, y: 1 });
      dirty = true;
    });
    return group;
  }

  // ---- view cones ------------------------------------------------------------

  /** A colour at an opacity, for the stops of a gradient that fades it out. */
  function tint(color, alpha) {
    return (fillPaint(color, 1) ?? color).replace(/, 1\)$/, `, ${Math.max(0, Math.min(1, alpha))})`);
  }

  /**
   * A view cone: a wedge from the camera along its line of sight, fading with
   * distance, its two edges fading the same way, and the camera on a badge where
   * it stood, sized on its own (`badge`). The cone is built
   * pointing up and turned to its line of sight, and kept to its picture: a field
   * of view running out over the page says nothing. The badge stays whole even at
   * the picture's edge, upright on the page, `turn` being the picture's own turn.
   */
  function makeConeNode(s, k, turn = 0, { live = true, image = null, outline = null } = {}) {
    const fov = s.fov ?? lensFov('1');
    const reach = Math.max(1 / k, s.reach ?? 100);
    const width = s.strokeWidth ?? 4;
    const fill = s.fillOpacity ?? 0.35;
    const node = new Konva.Group({
      ...(live ? { id: s.id, draggable: true } : { listening: false }),
      x: s.x, y: s.y,
    });
    const kept = new Konva.Group(image ? { clip: { x: -s.x, y: -s.y, width: image[0], height: image[1] } } : {});
    const group = new Konva.Group({ rotation: s.rotation ?? 0 });
    // and to what its picture's cut keeps, on a cut one
    const shown = outline ? new Konva.Group({ clipFunc: (ctx) => traceOutline(ctx, outline.map((p) => ({ x: p.x - s.x, y: p.y - s.y }))) }) : null;
    if (shown) {
      shown.add(group);
      kept.add(shown);
    } else {
      kept.add(group);
    }
    node.add(kept);
    // Konva's wedge starts along +x and runs clockwise; the cone is centred on up.
    group.add(new Konva.Wedge({
      radius: reach, angle: fov, rotation: -90 - fov / 2,
      fillRadialGradientStartPoint: { x: 0, y: 0 }, fillRadialGradientStartRadius: 0,
      fillRadialGradientEndPoint: { x: 0, y: 0 }, fillRadialGradientEndRadius: reach,
      fillRadialGradientColorStops: [0, tint(s.color, fill), 0.6, tint(s.color, fill * 0.45), 1, tint(s.color, 0)],
    }));
    const dash = dashPattern(s.dash, width);
    for (const side of [-fov / 2, fov / 2]) {
      const end = along(side);
      group.add(new Konva.Line({
        points: [0, 0, end.x * reach, end.y * reach],
        strokeWidth: width / k, lineCap: 'round', listening: false,
        strokeLinearGradientStartPoint: { x: 0, y: 0 },
        strokeLinearGradientEndPoint: { x: end.x * reach, y: end.y * reach },
        strokeLinearGradientColorStops: [0, tint(s.color, 1), 1, tint(s.color, 0.12)],
        ...(dash ? { dash: dash.map((v) => v / k) } : {}),
      }));
    }
    // the camera itself, upright on the page whichever way it looks, at its own size
    const radius = badgeOf(s) / 2 / k;
    const ink = glyphInk(s.color, 1);
    const camera = iconByName('camera');
    const badge = new Konva.Group({ rotation: -turn });
    badge.add(new Konva.Circle({ radius, fill: s.color, stroke: ink, strokeWidth: 1.5 / k }));
    if (camera) {
      const side = radius * 1.25;
      const scale = side / ICON_BOX;
      const glyph = new Konva.Path({
        data: camera.path, scaleX: scale, scaleY: scale,
        stroke: ink, strokeWidth: (1.8 / k) / scale, lineJoin: 'round', listening: false,
      });
      // centred on what it draws: the glyph sits low in its own box, under the
      // hump of the viewfinder, and centring the box left it off the badge's middle
      const drawn = glyph.getSelfRect();
      glyph.offset({ x: drawn.x + drawn.width / 2, y: drawn.y + drawn.height / 2 });
      badge.add(glyph);
    }
    node.add(badge);
    if (!live) return node;
    bindShapePick(node, s);
    node.on('dragstart', () => { dragMoved = true; });
    node.on('dragend', () => {
      s.x = node.x();
      s.y = node.y();
      landShape(s);
      dirty = true;
    });
    return node;
  }

  /**
   * A cone's handles: the far end aims it and sets how far it reaches, each edge
   * sets how wide it opens, and an edge brought near a phone lens settles on it.
   * The cone follows the pointer while a handle is held.
   */
  function drawConeHandles(s, frame, look) {
    const node = docLayer.findOne(`#${s.id}`);
    const k = frame.box.scale;
    let preview = null;
    const show = (draft) => {
      preview?.destroy();
      preview = makeConeNode(draft, k, frame.rotation, { live: false, image: frame.image, outline: frame.outline });
      node?.getParent()?.add(preview);
      node?.hide();
      docLayer.batchDraw();
    };
    const own = (handle) => pageToSurface(handle.position(), frame);
    const { end, left, right } = coneHandles(s);
    const aim = new Konva.Circle({ ...look, ...surfaceToPage(end, frame) });
    const aimed = () => {
      const at = own(aim);
      return { rotation: bearingTo(s, at), reach: Math.max(8 / k, Math.hypot(at.x - s.x, at.y - s.y)) };
    };
    aim.on('dragmove', () => show({ ...s, ...aimed() }));
    aim.on('dragend', () => { Object.assign(s, aimed()); dirty = true; });
    endHandles.add(aim);
    for (const at of [left, right]) {
      const edge = new Konva.Rect({
        ...look, width: look.radius * 1.6, height: look.radius * 1.6,
        offsetX: look.radius * 0.8, offsetY: look.radius * 0.8, ...surfaceToPage(at, frame),
      });
      edge.on('dragmove', () => show({ ...s, ...fovFromEdge(s, own(edge)) }));
      edge.on('dragend', () => { Object.assign(s, fovFromEdge(s, own(edge))); dirty = true; });
      endHandles.add(edge);
    }
    // The camera's own size, from a small diamond on its rim: the badge is
    // upright on the page, so the rim is read in page pixels, whatever the line.
    const camera = surfaceToPage(s, frame);
    const rim = Math.SQRT1_2 * (badgeOf(s) / 2);
    const side = look.radius * 1.3;
    const size = new Konva.Rect({
      ...look, name: 'cone-badge-size', width: side, height: side, offsetX: side / 2, offsetY: side / 2,
      rotation: 45, x: camera.x + rim, y: camera.y + rim,
    });
    const sized = () => {
      const p = size.position();
      const across = 2 * Math.hypot(p.x - camera.x, p.y - camera.y);
      return Math.round(Math.min(CONE_BADGE_MAX, Math.max(CONE_BADGE_MIN, across)));
    };
    size.on('dragmove', () => show({ ...s, badge: sized() }));
    size.on('dragend', () => { s.badge = sized(); coneBadge = s.badge; dirty = true; });
    endHandles.add(size);
  }

  /** The lens of the picked cone, or of the next one; a lens sets the width it opens to. */
  function setLens(patch) {
    if ('lens' in patch) coneLens = patch.lens;
    if ('upright' in patch) coneUpright = patch.upright;
    const s = editableShape;
    if (s?.kind !== 'cone') return;
    if ('lens' in patch) s.lens = patch.lens;
    if ('upright' in patch) s.upright = patch.upright;
    if (s.lens) s.fov = lensFov(s.lens, !!s.upright);
    dirty = true;
  }

  // ---- callouts and zoom insets: from a picture out onto the page -----------

  // A leader's label sits on a dark plate, which reads over any imagery.
  const CALLOUT_PLATE = 'rgba(13, 17, 23, 0.88)';

  /**
   * Where a callout's parts are on the page: its point, and its label's box
   * measured off the words and held inside the document.
   */
  function calloutLayout(s, frame, doc = measureDoc()) {
    const tip = surfaceToPage({ x: s.x, y: s.y }, frame);
    const fontSize = s.fontSize ?? CALLOUT_FONT;
    const bubble = s.tail === 'bubble';
    const text = new Konva.Text({
      text: s.text || ' ', fontSize, fontFamily: proofFace(), fontStyle: markWeight(),
      fill: bubble ? glyphInk(s.color, 1) : s.color, listening: false,
    });
    const pad = textBoxPad(fontSize);
    const w = text.width() + pad * 2;
    const h = text.height() + pad * 2;
    return {
      tip, text, pad, bubble, fontSize,
      rect: calloutBox(tip, s, w, h, doc.width, doc.height),
      radius: bubble ? Math.min(h / 2, pad * 1.6) : 3,
    };
  }

  /**
   * A callout: its label on the page, tied to its point by a leader or a tail.
   *
   * The label is the node the selection holds, and dragging it moves the label
   * alone: the point stays on its pixel and has its own handle. Everything here
   * is in page pixels and upright, over every picture.
   */
  function addCalloutNodes(parent, s, frame, doc) {
    const { tip, text, pad, bubble, fontSize, rect, radius } = calloutLayout(s, frame, doc);
    const { line, dot } = calloutInk(fontSize, s.strokeWidth);
    const pointer = new Konva.Group({ listening: false });
    const drawPointer = (box) => {
      pointer.destroyChildren();
      if (bubble) {
        const tail = bubbleTail(tip, box, Math.max(6, fontSize * 0.35), radius);
        if (tail) pointer.add(new Konva.Line({ points: tail, closed: true, fill: s.color }));
        return;
      }
      const near = nearestOnRect(tip, box);
      if (near) {
        pointer.add(new Konva.Line({
          points: [tip.x, tip.y, near.x, near.y], stroke: s.color, strokeWidth: line, lineCap: 'round',
        }));
      }
      pointer.add(new Konva.Circle({ x: tip.x, y: tip.y, radius: dot, fill: s.color }));
    };
    drawPointer(rect);
    const node = new Konva.Group({ id: s.id, x: rect.x, y: rect.y, draggable: true });
    node.add(new Konva.Rect({
      width: rect.w, height: rect.h, cornerRadius: radius,
      fill: bubble ? s.color : CALLOUT_PLATE,
      ...(bubble ? {} : { stroke: s.color, strokeWidth: line }),
    }));
    text.position({ x: pad, y: pad });
    node.add(text);
    bindShapePick(node, s);
    node.on('dblclick dbltap', (e) => {
      e.cancelBubble = true;
      startTextEdit(s);
    });
    node.on('dragstart', () => { dragMoved = true; });
    node.on('dragmove', () => drawPointer({ x: node.x(), y: node.y(), w: rect.w, h: rect.h }));
    node.on('dragend', () => {
      s.dx = node.x() + rect.w / 2 - tip.x;
      s.dy = node.y() + rect.h / 2 - tip.y;
      dirty = true;
    });
    parent.add(pointer, node);
  }

  /**
   * A zoom inset: a frame on a detail of its picture, the same pixels shown
   * bigger on the page, and two lines between them.
   *
   * The frame belongs to the picture and drags across it, or onto another one,
   * like a box. The enlargement is the node the selection holds: it drags and
   * resizes from its corners on its own, turned like its picture. It is drawn
   * from the picture's pixels and from the blur boxes over them, so a redaction
   * holds in the enlargement too.
   *
   * The marks drawn over the enlargement are its own (lib/insetMarks.js): they are
   * drawn in a group laid on it in its pixels, which follows it through a drag or
   * a resize. A locked inset takes no press: its frame lets the picture under it
   * answer, and its enlargement opens a marquee over the marks on it, so drawing
   * or picking there never moves it.
   */
  function addZoomNodes(parent, s, frame, doc, surface, entry) {
    const locked = isLocked(s);
    const lw = Math.max(1, (s.strokeWidth ?? 4) / 2);
    const pattern = dashPattern(s.dash, lw);
    const dashed = pattern ? { dash: pattern, lineCap: s.dash === 'dot' ? 'round' : 'butt' } : {};
    const own = [[s.x, s.y], [s.x + s.w, s.y], [s.x + s.w, s.y + s.h], [s.x, s.y + s.h]];
    const corners = own.map(([x, y]) => surfaceToPage({ x, y }, frame));
    const centre = surfaceToPage({ x: s.x + s.w / 2, y: s.y + s.h / 2 }, frame);
    const iw = s.iw;
    const ih = insetHeight(s);
    const placed = insetBox(centre, s, doc.width, doc.height);
    const turn = frame.rotation;
    const radians = (turn * Math.PI) / 180;
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    const links = new Konva.Group({ listening: false });
    const drawLinks = (cx, cy, scale = 1) => {
      links.destroyChildren();
      const hw = (iw * scale) / 2;
      const hh = (ih * scale) / 2;
      const inset = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
        .map(([x, y]) => ({ x: cx + x * cos - y * sin, y: cy + x * sin + y * cos }));
      // which way the inset lies, read in the picture's own turn
      const ox = cx - centre.x;
      const oy = cy - centre.y;
      const towards = { x: ox * cos + oy * sin, y: -ox * sin + oy * cos };
      for (const [a, b] of insetConnectors(corners, inset, towards)) {
        links.add(new Konva.Line({
          points: [a.x, a.y, b.x, b.y], stroke: s.color, strokeWidth: Math.max(1, lw * 0.6), opacity: 0.9,
        }));
      }
    };
    drawLinks(placed.x + iw / 2, placed.y + ih / 2);

    const outline = new Konva.Line({
      name: 'zoom-frame', points: corners.flatMap((p) => [p.x, p.y]), closed: true,
      stroke: s.color, strokeWidth: lw, hitStrokeWidth: Math.max(lw * 3, 10), draggable: !locked,
      listening: !locked, ...dashed,
    });
    bindShapePick(outline, s);
    outline.on('dragstart', () => { dragMoved = true; });
    outline.on('dragend', () => {
      const before = { panel: s.panel, x: s.x, y: s.y, w: s.w, h: s.h };
      const step = pageStepOnSurface(outline.x(), outline.y(), frame);
      s.x += step.dx;
      s.y += step.dy;
      outline.position({ x: 0, y: 0 });
      landShape(s);
      // the marks drawn over the enlargement keep to what they were drawn on
      proof.shapes = reframedInsetMarks(proof.shapes, s.id, before, s, s.panel === before.panel);
      dirty = true;
    });

    const node = new Konva.Group({
      id: s.id, x: placed.x + iw / 2, y: placed.y + ih / 2, rotation: turn, draggable: !locked,
    });
    const view = new Konva.Group({ clip: { x: -iw / 2, y: -ih / 2, width: iw, height: ih } });
    view.add(new Konva.Rect({
      x: -iw / 2, y: -ih / 2, width: iw, height: ih, fill: 'rgba(20, 22, 26, 0.92)',
    }));
    const k = iw / s.w;
    // what the picture's cut hides, the enlargement does not show either
    const pixels = new Konva.Group({
      x: -iw / 2 - s.x * k, y: -ih / 2 - s.y * k, scaleX: k, scaleY: k,
      ...(frame.outline ? { clipFunc: (ctx) => traceOutline(ctx, frame.outline) } : {}),
    });
    // only the part of the frame that is over the picture has pixels to show
    const x0 = Math.max(0, s.x);
    const y0 = Math.max(0, s.y);
    const x1 = Math.min(frame.image[0], s.x + s.w);
    const y1 = Math.min(frame.image[1], s.y + s.h);
    if (surface?.img && x1 > x0 && y1 > y0) {
      const crop = surface.crop ?? { x: 0, y: 0 };
      pixels.add(new Konva.Image({
        image: surface.img, x: x0, y: y0, width: x1 - x0, height: y1 - y0,
        crop: { x: crop.x + x0, y: crop.y + y0, width: x1 - x0, height: y1 - y0 },
      }));
      for (const blur of proof.shapes.filter((b) => b.kind === 'blur' && b.panel === s.panel)) {
        pixels.add(makeBlurNode(blur, surface, { live: false }));
      }
    }
    view.add(pixels);
    node.add(view);
    // the border, and the whole inset as something to press; a locked one is a
    // ground to open a marquee on (see onPointerDown), never the inset itself
    node.add(new Konva.Rect({
      x: -iw / 2, y: -ih / 2, width: iw, height: ih, fill: 'transparent', stroke: s.color, strokeWidth: lw, ...dashed,
      ...(locked ? { name: 'inset-hold' } : {}),
    }));
    if (!locked) bindShapePick(node, s);
    // The marks drawn over the enlargement, in its own pixels, laid on it: a sibling
    // rather than a child, so the selection frame and its handles hug the
    // enlargement alone, and kept on it through a drag and a resize.
    const onInset = entry ? surfaceFrame(entry) : null;
    const marks = new Konva.Group({ x: node.x(), y: node.y(), rotation: turn });
    if (onInset) {
      const k = onInset.box.scale;
      const surfaceMarks = new Konva.Group({
        id: `pg-${s.id}`, x: (-onInset.image[0] / 2) * k, y: (-onInset.image[1] / 2) * k, scaleX: k, scaleY: k,
      });
      for (const mark of proof.shapes.filter((x) => x.panel === s.id)) addSurfaceShape(surfaceMarks, mark, onInset.box, entry.item);
      marks.add(surfaceMarks);
    }
    const follow = () => marks.setAttrs({ x: node.x(), y: node.y(), scaleX: node.scaleX(), scaleY: node.scaleY() });
    node.on('dragstart', () => { dragMoved = true; });
    node.on('dragmove', () => {
      drawLinks(node.x(), node.y());
      follow();
    });
    node.on('transform', () => {
      drawLinks(node.x(), node.y(), Math.abs(node.scaleX()));
      follow();
    });
    node.on('dragend', () => {
      s.dx = node.x() - centre.x;
      s.dy = node.y() - centre.y;
      dirty = true;
    });
    node.on('transformend', () => {
      s.iw = Math.max(INSET_MIN, iw * Math.abs(node.scaleX()));
      s.dx = node.x() - centre.x;
      s.dy = node.y() - centre.y;
      node.scale({ x: 1, y: 1 });
      dirty = true;
    });
    parent.add(links, outline, node, marks);
  }

  /**
   * Give the picked label a pointer, take a callout's off, or change how it
   * reaches its point. A label and a callout are one mark with or without its
   * pointer, so neither has to be typed again to become the other. With nothing
   * picked, it sets how the next callout is drawn.
   */
  function setTail(tail) {
    if (tail !== 'none') calloutTail = tail;
    const s = tailShape;
    if (!s) return;
    const index = proof.shapes.findIndex((x) => x.id === s.id);
    const frame = frameOf(s.panel);
    if (index < 0 || !frame) return;
    if (s.kind === 'callout' && tail !== 'none') {
      s.tail = tail;
    } else if (s.kind === 'callout') {
      const { rect, text } = calloutLayout(s, frame);
      text.destroy();
      const origin = pageToSurface({ x: rect.x, y: rect.y }, frame);
      proof.shapes[index] = calloutToLabel(s, origin, normalizeSurfaceAngle(-frame.rotation));
    } else if (tail !== 'none') {
      // the point is the middle of the label, wherever it stood and however turned
      const fontSize = s.fontSize ?? 28;
      const probe = new Konva.Text({ text: s.text || ' ', fontSize, fontFamily: proofFace(), fontStyle: markWeight() });
      const pad = s.frame || s.bg ? textBoxPad(fontSize) : 0;
      const half = { x: (probe.width() / 2 + pad) / frame.box.scale, y: (probe.height() / 2 + pad) / frame.box.scale };
      probe.destroy();
      const turn = ((s.rotation ?? 0) * Math.PI) / 180;
      const point = {
        x: s.x + half.x * Math.cos(turn) - half.y * Math.sin(turn),
        y: s.y + half.x * Math.sin(turn) + half.y * Math.cos(turn),
      };
      proof.shapes[index] = labelToCallout(s, point, tail);
    } else {
      return;
    }
    dirty = true;
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
    const frame = frameOf(s.panel);
    if (!frame) return;
    if (s.kind === 'callout') {
      // over the words of the label, wherever on the page it was carried
      const { rect, pad, fontSize, text, bubble } = calloutLayout(s, frame);
      text.destroy();
      selectedIds = [s.id];
      textEdit = {
        font: proofFace(), weight: markWeight() === 'bold' ? 700 : 400,
        id: s.id,
        value: s.text ?? '',
        left: stage.x() + (rect.x + pad) * stage.scaleX(),
        top: stage.y() + (rect.y + pad) * stage.scaleY(),
        size: fontSize * stage.scaleX(),
        color: bubble ? glyphInk(s.color, 1) : s.color,
      };
      return;
    }
    // A boxed label insets its glyph by the padding the frame uses, so the
    // editor opens over the words instead of over the corner. The padding is
    // ink, in page pixels, along the label's own turn and its surface's.
    const inset = s.frame || s.bg ? textBoxPad(s.fontSize) : 0;
    const turn = (((s.rotation ?? 0) + frame.rotation) * Math.PI) / 180;
    const origin = surfaceToPage({ x: s.x, y: s.y }, frame);
    selectedIds = [s.id];
    textEdit = {
      font: proofFace(), weight: markWeight() === 'bold' ? 700 : 400,
      id: s.id,
      value: s.text ?? '',
      left: stage.x() + (origin.x + inset * (Math.cos(turn) - Math.sin(turn))) * stage.scaleX(),
      top: stage.y() + (origin.y + inset * (Math.sin(turn) + Math.cos(turn))) * stage.scaleY(),
      size: (s.fontSize ?? 28) * stage.scaleX(),
      color: s.color,
    };
  }

  /**
   * Open the editor over a page text drawn as `node`: a panel's caption or the
   * footer's credit line. One line each, set where it is printed and as wide.
   */
  function startLineEdit(node, edit) {
    const z = stage.scaleX();
    textEdit = {
      font: proofFace(), weight: 400,
      left: stage.x() + node.x() * z,
      top: stage.y() + node.y() * z,
      width: node.width() * z,
      align: node.align(),
      size: node.fontSize() * z,
      color: node.fill(),
      ...edit,
    };
  }

  /** Write on a panel's caption where it is printed. */
  function startCaptionEdit(panel) {
    const node = docLayer?.findOne(`#cap-${panel.id}`);
    if (!node) return;
    selectPanel(panel.id);
    startLineEdit(node, { field: 'caption', id: panel.id, value: panel.caption ?? '' });
  }

  /** Write the footer's credit line where it is printed: the band's last line, holding the whole line. */
  function startFooterEdit() {
    const lines = docLayer?.findOne('#proof-footer')?.getChildren();
    if (!lines?.length || proof.footerText === false) return;
    const node = lines[lines.length - 1];
    selectSig('footer');
    startLineEdit(node, { field: 'footer', id: null, value: footerLine(proof) });
  }

  function commitTextEdit(keep = true) {
    if (!textEdit) return;
    // A caption and a credit line are one line each. A credit line left empty
    // goes back to the one the panels give.
    if (textEdit.field === 'caption' || textEdit.field === 'footer') {
      const value = textEdit.value.replace(/\s*\n\s*/g, ' ').trim();
      const panel = proof.panels.find((p) => p.id === textEdit.id);
      if (keep && textEdit.field === 'caption' && panel && (panel.caption ?? '') !== value) {
        panel.caption = value;
        dirty = true;
      } else if (keep && textEdit.field === 'footer' && value !== footerLine(proof)) {
        proof.footer = value;
        dirty = true;
      }
      textEdit = null;
      return;
    }
    const s = proof.shapes.find((x) => x.id === textEdit.id);
    if (s && textEdit.field === 'tag') {
      // A tag left empty is no tag, and so is a new one let go with Escape.
      const value = keep ? textEdit.value : s.tag;
      if (!value?.trim() || (!keep && textEdit.fresh)) {
        delete s.tag;
        delete s.tagAt;
        dirty = true;
      } else if (s.tag !== value) {
        s.tag = value;
        dirty = true;
      }
    } else if (keep && s && s.text !== textEdit.value) {
      s.text = textEdit.value;
      dirty = true;
    }
    textEdit = null;
  }

  const focusSelect = (el) => {
    el.focus();
    el.select();
  };

  // ---- shape ops from the side panel -----------------------------------------------------

  // ---- clipboard (copy / paste / duplicate of the picked marks) ----------------
  // What is copied, where a paste puts it and how it steps on: lib/proofClipboard.js.
  let clipboard = null; // the last copy made here
  let clipOnSystem = false; // whether that copy reached the system clipboard
  /** Whether that copy is the last one the analyst made without leaving the window.
   *  What lets Ctrl+V tell marks just copied here from an older screenshot sitting
   *  in the system clipboard, when the copy could not be written there (see `onPaste`). */
  let shapeCopyFresh = false;
  // How many times the copy was pasted, by proof and by where, so each paste steps
  // on from the last; and where the last paste went, which the next one follows.
  let pasteRuns = new Map();
  let lastPaste = null;
  // Which proof is open: bumped as each one opens (see anchorHistory).
  let docKey = 0;
  // Whether the pointer is over the canvas, so a paste can go on the picture under it.
  let pointerOnCanvas = false;

  /** A copy of these marks, with what their pictures showed: the marks over a picked inset come along. */
  const copyOf = (ids) => makeCopy(proof.shapes, ids, { surfaces: surfacesOf(), frameOf, docKey, id: newId('c') });

  /** Copy the picked marks: kept here, and written to the system clipboard as marked text. */
  function copySelection(ids = selectedIds) {
    const copy = copyOf(ids);
    if (!copy) return;
    clipboard = copy;
    clipOnSystem = false;
    shapeCopyFresh = true;
    pasteRuns = new Map();
    lastPaste = null;
    writeSystemClip(copy);
  }

  async function writeSystemClip(copy) {
    try {
      await navigator.clipboard.writeText(clipText(copy));
      if (clipboard === copy) clipOnSystem = true;
    } catch {
      // refused or not offered: the copy here stands, under the older rule (see onPaste)
    }
  }

  // The composer only ever hears about its own copies, so losing focus is the one
  // signal that the system clipboard may have moved on since.
  $effect(() => {
    const release = () => (shapeCopyFresh = false);
    window.addEventListener('blur', release);
    return () => window.removeEventListener('blur', release);
  });

  $effect(() => {
    if (!containerEl) return;
    const enter = () => (pointerOnCanvas = true);
    const leave = () => (pointerOnCanvas = false);
    containerEl.addEventListener('pointerenter', enter);
    containerEl.addEventListener('pointerleave', leave);
    return () => {
      containerEl.removeEventListener('pointerenter', enter);
      containerEl.removeEventListener('pointerleave', leave);
    };
  });

  /**
   * The picture a paste goes on: the panel or overlay picked, else the picture or
   * inset under the pointer, else where the last paste of this copy went in this
   * proof. Null for where each mark was copied from.
   */
  function pasteTarget() {
    if (selectedPanelId) return selectedPanelId;
    if (selectedPasteId) return selectedPasteId;
    if (pointerOnCanvas && stage?.getPointerPosition()) {
      const hit = surfaceHitTest(surfacesOf().filter((x) => x.id !== PAGE), docPoint());
      if (hit) return hit.id;
    }
    return lastPaste?.docKey === docKey ? lastPaste.target : null;
  }

  /**
   * Add a copy's marks to the proof as one step, picked: on `target`, or where
   * each was copied from (lib/proofClipboard.pasteShapes). `runs` counts the
   * pastes so far, so a second one steps on from the first.
   */
  function pasteClip(copy = clipboard, target = pasteTarget(), runs = pasteRuns) {
    if (!copy) return;
    if (!hasProofCanvasContent(proof)) {
      toast('Add a panel before pasting marks', 'warn', 5000);
      return;
    }
    const added = pasteShapes(copy, {
      surfaces: surfacesOf(), frameOf, target, docKey, runs, newId: () => newId('s'), step: PASTE_STEP,
    });
    if (!added.length) return;
    if (runs === pasteRuns) lastPaste = { docKey, target };
    proof.shapes.push(...added);
    tool = 'select';
    selectedIds = added.map((s) => s.id);
    selectedPanelId = null;
    selectedPasteId = null;
    selectedSig = null;
    dirty = true;
  }

  /** The picked marks again, stepped down and right of them, without touching the clipboard. */
  function duplicateSelection(ids = selectedIds) {
    const copy = copyOf(ids);
    if (copy) pasteClip(copy, null, new Map());
  }

  const duplicateShape = (id) => duplicateSelection(id ? [id] : selectedIds);

  /**
   * Delete these annotations, and drop the legend notes left with nothing. A zoom
   * inset takes the marks drawn over it along, as a picture does, and lets go of
   * the lines that held to it.
   */
  function deleteShapes(ids) {
    const going = goingWith(proof.shapes, ids);
    const gone = proof.shapes.filter((s) => going.has(s.id));
    if (!gone.length) return;
    for (const s of gone) if (s.kind === 'zoom') letGoOfSurface(s.id);
    proof.shapes = proof.shapes.filter((s) => !going.has(s.id));
    for (const s of gone) proof.notes = notesAfterRemoval(proof.notes, proof.shapes, s);
    selectedIds = selectedIds.filter((x) => !going.has(x));
    dirty = true;
  }

  /** Delete every picked annotation. */
  const deleteSelected = () => deleteShapes(selectedIds);

  const deleteShape = (id) => deleteShapes([id]);

  /**
   * Move an element to a place in the order: `to` is the index it ends at.
   *
   * Forward is *later* in the array, since a panel's shapes are added in array
   * order and the last one drawn sits on top. The side list shows them
   * front-first, the way the Panels list above it does, so it speaks of forward
   * and backward rather than of the array's up and down.
   *
   * One order for the whole proof, crossing pictures: the list is one list, and
   * an arrow greyed out at a picture's edge read as a broken button rather than
   * as the rule it was enforcing. What an element is actually drawn over is
   * still decided inside its own picture — two marks on two panels are stacked
   * by the panels, not by this — and the row says which picture it is on so the
   * press that changes nothing is a press whose reason is on screen.
   */
  function moveShapeTo(from, to) {
    const last = proof.shapes.length - 1;
    if (from === to || from < 0 || to < 0 || from > last) return;
    const next = [...proof.shapes];
    const [s] = next.splice(from, 1);
    next.splice(Math.min(to, next.length), 0, s);
    proof.shapes = next;
    dirty = true;
  }

  const KIND_ICON = { rect: 'square', ellipse: 'circle', arrow: 'arrow', line: 'line', curve: 'curve', freehand: 'freehand', text: 'text', callout: 'calloutLeader', icon: 'pin', number: 'numbered', blur: 'blurBox', zoom: 'zoomInset', cone: 'viewCone' };
  const KIND_LABEL = { rect: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', curve: 'Curve', freehand: 'Freehand', text: 'Text', callout: 'Callout', icon: 'Symbol', number: 'Marker', blur: 'Blur box', zoom: 'Zoom inset', cone: 'View cone' };

  // Colour / stroke / fill live-edit everything in hand and always remember the
  // pick as the default for the next drawn one — the last value you touched
  // stays your working value. "In hand" means Select: with a drawing tool the
  // controls set defaults only, so picking a new colour between two strokes no
  // longer repaints the stroke that came before it (`editableShapes`).
  function setColor(c) {
    // A blur box hides what is under it rather than pointing at it, so it has no
    // colour to set — and it stays out of the legend for the same reason.
    const inked = editableShapes.filter((s) => s.kind !== 'blur');
    if (inked.length) {
      const before = [...new Set(inked.map((s) => s.color))];
      for (const s of inked) {
        // A marker belongs to its colour's series on its picture (see
        // nextMarkerNumber), so one moved to another colour takes the first
        // number free in the series it joins. Assigned before the colour, so a
        // family recoloured at once numbers itself in order rather than all
        // landing on the same number.
        if (s.kind === 'number' && s.color !== c) s.n = nextMarkerNumber(proof.shapes, c, s.panel);
        s.color = c;
      }
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
    if (editableShape?.kind === 'text' || editableShape?.kind === 'callout') {
      editableShape.fontSize = w;
      dirty = true;
      return;
    }
    for (const s of editableShapes) {
      // a font size is not a stroke width, and a callout's line follows its font
      if (s.kind === 'text' || s.kind === 'callout') continue;
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

  // Arrow-key nudge of the selected elements, in page pixels: a press steps the
  // same distance on every panel, whatever its resolution, size or turn.
  const NUDGE = {
    ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
  };
  function nudgeSelected(dx, dy) {
    if (!editableShapes.length) return;
    // a locked inset stays put, and the marks of an inset that moves follow it
    const moving = editableShapes.filter((s) => !isLocked(s));
    const insets = new Set(moving.filter((s) => s.kind === 'zoom').map((s) => s.id));
    for (const s of moving) {
      if (insets.has(s.panel)) continue;
      const frame = frameOf(s.panel);
      if (!frame) continue;
      const step = pageStepOnSurface(dx, dy, frame);
      const before = s.kind === 'zoom' ? { x: s.x, y: s.y, w: s.w, h: s.h } : null;
      Object.assign(s, s.ends ? nudgedLink(s, dx, dy, frameOf) : nudgeShape(s, step.dx, step.dy));
      if (before) proof.shapes = reframedInsetMarks(proof.shapes, s.id, before, s);
    }
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
    if (isTextTarget(e.target)) return;
    // Alt+←/→ go from slide to slide wherever the strip shows, and never reach the
    // browser, whose Back they are on Windows and Linux.
    if (e.altKey && !e.ctrlKey && !e.metaKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && stripShown) {
      e.preventDefault();
      stepSlide(e.key === 'ArrowLeft' ? -1 : 1);
      return;
    }
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
      uiLayer.batchDraw(); // a callout's draft line is drawn there
      return;
    }
    // Escape unwinds here as everywhere else: the marks go and the image keeps
    // its pixels. Clicking away or saving is what keeps the box instead.
    if (e.key === 'Escape' && cropSurfaceId) {
      discardSurfaceCrop();
      refreshCanvasUi();
      return;
    }
    // …and Enter keeps it, like a press off the image
    if (e.key === 'Enter' && cropSurfaceId) {
      e.preventDefault();
      endSurfaceCrop();
      refreshCanvasUi();
      return;
    }
    // clipboard / undo / save chords
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      // Ctrl+V is deliberately absent: the paste event decides between an image
      // in the system clipboard and copied marks (see onPaste).
      // Copying and duplicating stay open to a drawing tool: they read the picked
      // marks rather than changing them, and what they add lands in plain sight.
      // Words selected on the page are the browser's to copy.
      if (k === 'c' && selectedIds.length && !window.getSelection()?.toString()) { e.preventDefault(); copySelection(); }
      else if (k === 'd' && selectedIds.length) { e.preventDefault(); duplicateSelection(); }
      // the stacking order: a step with the arrow, all the way with Shift too
      else if ((k === 'arrowup' || k === 'arrowdown') && editableShapes.length) {
        e.preventDefault();
        const up = k === 'arrowup';
        restack(e.shiftKey ? (up ? 'front' : 'back') : (up ? 'forward' : 'backward'));
      }
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
    else if (e.key === 'n') tool = 'number';
    else if (e.key === 'b') tool = 'blur';
    else if (e.key === 'k') tool = 'callout';
    else if (e.key === 'z') tool = 'zoom';
    else if (e.key === 'o') tool = 'cone';
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
    // A box still under its crop marks belongs to the document, not to the view:
    // saving or copying from inside crop mode keeps it, like clicking away does.
    if (cropSurfaceId) {
      endSurfaceCrop();
      rebuild();
    }
    const { width, height } = measureDoc();
    // a published picture is exported at the size it was published
    const { pixelRatio } = proofExportOptions(width, height, { native: isPublishedProof(proof) });
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
      // a save asked under a press (Ctrl+S mid-drag) keeps the nodes in hand: the
      // handles come back now and the page is rebuilt once the press is over
      if (canvasRenderGate?.active) {
        refreshCanvasUi();
        canvasRenderGate.requestRebuild();
      } else rebuild();
    }
  }

  // Copy the composed PNG straight to the clipboard — for peer review in a
  // chat before publishing, without hunting the file in the case folder.
  let copying = $state(false);
  async function copyPng() {
    if (!hasProofCanvasContent(proof) || copying) return;
    copying = true;
    try {
      await fontReady;
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
      if (dirty || !savedName) await save({ then: exportProof });
      // A failed save leaves the proof dirty; a title collision opens the
      // overwrite prompt without binding a name. In either case there is no
      // confirmed PNG to copy yet.
      if (dirty || !savedName) return;
      const cid = caseState.current.id;
      const result = await api.post(`/api/cases/${cid}/proofs/${encodeURIComponent(savedName)}/export`);
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

  // The technical name a fresh proof files under, numbered past those already in the
  // case so two never clash ("Proof 2"). The header never shows it: its field stays
  // empty until the analyst names the proof, and the lists show its label. Called on reset.
  const freshTitle = () => nextName('proof', savedProofTitles());
  // A name cleared: the technical one the proof holds already, else a fresh one.
  const technicalTitle = () => (savedName && isDefaultName(savedName, 'proof') ? savedName : freshTitle());

  /** The header's field typed: the analyst's name, or, emptied, a technical one again. */
  function nameProof(text) {
    proof.title = text.trim() ? text : technicalTitle();
    dirty = true;
  }

  /** What the proof open is called where it is asked about: its name, else its label in the case's lists. */
  function openLabel() {
    const own = ownName(proof.title, 'proof');
    if (own) return own;
    const entry = [...(homeProofs ?? []), ...(openList ?? [])].find((one) => one.name === savedName);
    return entry ? proofLabel(entry) : 'this proof';
  }

  let overwritePrompt = $state(null); // { slug, andPost, then } when a save hits a named proof
  // { name, lat, lon } — the point a save carried, where the setting says to ask
  // first. Only ever set for a point the case does not already hold.
  let placeOffer = $state(null);
  let placeSaving = $state(false);
  // [{ id, label }] — points this save moved the proof off that nothing else in
  // the case holds. Asked about after the question above, never beside it.
  let orphanOffer = $state(null);
  // The proof both questions are about, named over them once the slides have moved on.
  let offersOf = $state(null);
  const offersOver = $derived(offersOf && offersOf.name !== savedName ? `${offersOf.title}: ` : '');
  /** What the proof just saved shares with the rest of the case: other geolocations on
   *  its site, what its account posted. Read once after a save, gone at the next edit. */
  let kin = $state(null);
  const kinWords = $derived(kin && kin.name === savedName && !dirty ? kinSentence(kin) : null);

  async function readKin(caseId, entityId, name) {
    if (!entityId) return;
    try {
      const answer = await api.get(`/api/cases/${caseId}/entities/${entityId}/kin`);
      kin = { ...answer, id: entityId, name };
    } catch {
      kin = null;
    }
  }

  function showKin() {
    if (!kin) return;
    uiState.openGraphEntity = kin.id;
    uiState.tool = 'graph';
  }
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

  /** And what it says about the date it stated for the footage. Counted past one,
   *  for the same reason. */
  function datedLabel(files) {
    const dated = files ?? [];
    if (dated.length === 1) return `Dated the material: ${dated[0]}`;
    return `Dated ${dated.length} files this proof rests on`;
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

  // The points a save or a post has to have looked at first, walked one at a time:
  // { rows, at, andPost, then } while it runs.
  let checking = $state(null);
  // What the dialog is asked about, read once per point. The dialog's props are
  // read again while it closes, after `checking` is already gone.
  const checkStep = $derived(
    checking
      ? {
          view: pointMapView(checking.rows[checking.at]),
          check: {
            step: checking.rows.length > 1 ? `${checking.at + 1} of ${checking.rows.length}` : '',
            label: proof.points[checking.rows[checking.at]]?.label ?? '',
          },
          later: !checking.andPost,
        }
      : null
  );

  async function save({ andPost = false, checked = false, then = null } = {}) {
    if (!hasProofCanvasContent(proof) || saving) return;
    // A point the imagery proposed is the middle of a capture until somebody looks.
    // A save files it on the case map and a post publishes it, so each one is shown
    // on the map first. `then` is what asked for the save, resumed once it lands.
    const rows = checked ? [] : uncheckedPoints(proof.points, proof.panels);
    if (rows.length) {
      checking = { rows, at: 0, andPost, then };
      return;
    }
    // The name in the header is the filename. A bound proof writes back over
    // itself, and renaming it moves the file — the backend refuses a rename onto
    // a name another proof holds. An unbound proof landing on a saved name is
    // the one case that can go either way, so it asks first.
    if (!savedName && savedProofNames().has(slugify(proof.title, 'proof'))) {
      overwritePrompt = { slug: slugify(proof.title, 'proof'), andPost, then };
      return;
    }
    // What asked for the save (a point into a layer, an export) goes on once it landed,
    // whatever the save moved after it: a scene's time written, the case read again.
    if ((await performSave(andPost)) && then) then();
  }

  /** The point on screen is right, or was moved: on to the next one, or the save. */
  function checkPick(point) {
    const { rows, at } = checking;
    movePoint(rows[at], point);
    if (at + 1 < rows.length) checking = { ...checking, at: at + 1 };
    else finishCheck();
  }

  /** Save now. `later` keeps the points left unchecked off the case map. */
  async function finishCheck(later = false) {
    const { andPost, then } = checking;
    checking = null;
    await save({ andPost, checked: true, then });
    if (later && !dirty) toast('Unchecked points stay off the case map until you check them.', 'warn', 5200);
  }

  /** Save the proof; true once it is saved. */
  async function performSave(andPost = false) {
    if (!hasProofCanvasContent(proof) || saving) return false;
    saving = true;
    // a slide saved on the way to another says so in a word, and what it kept off the map
    const slide = switching;
    const unchecked = slide ? uncheckedPoints(proof.points, proof.panels).length : 0;
    try {
      const c = await ensureCase();
      await fontReady;
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
      // the time a proof never saved was holding goes in now, through its own route, and
      // the scene the frames of one made by hand found is taken up the same way
      await scene.flush();
      await reloadCase();
      savedThumb = { name: result.name, thumb: result.thumb ?? null };
      if (!slide) toast(`Proof saved: ${result.png}`, 'ok');
      else if (unchecked) toast(`Saved ${ownName(result.title, 'proof') || 'the slide'} · ${unchecked === 1 ? '1 point' : `${unchecked} points`} still to check, kept off the map`, 'warn', 5200);
      else toast(`Saved ${ownName(result.title, 'proof') || 'the slide'}`, 'info', 1600);
      void readKin(c.id, result.id, result.name);
      // The points this proof carries. Filed already, or a question — the server
      // answers with nothing at all when the case already holds them, so
      // re-saving never asks twice.
      if (result.place?.filed?.length) toast(placedLabel(result.place.filed), 'ok', 2600);
      // The date went onto the footage as a statement of its own. Never asked —
      // dating a proof is dating what it rests on — but never silent either.
      if (result.dated?.length) toast(datedLabel(result.dated), 'ok', 2600);
      if (result.place?.asking?.length) {
        placeOffer = { name: result.name, points: result.place.asking };
      }
      // Corrected coordinates take the old point back. The place stays on the map
      // until the analyst says otherwise, so it is a question, not a cleanup.
      orphanOffer = result.orphans?.length ? result.orphans : null;
      offersOf = { name: result.name, title: result.title };
      if (andPost) {
        uiState.postProof = {
          title: result.title,
          // What the post is written from, when the proof carries one.
          description: proof.description,
          // The date and the clock the save read it on, for a post template with #date.
          when: proof.when,
          whenZone: result.when_zone ?? null,
          // the times it states in its video, for a post template with #timecode
          moments: scene.star ? scene.moments.map(({ start, end }) => ({ start, end: end ?? null })) : [],
          // every point, one per line: the post cites the first and carries the rest
          coordsText: coordsPostLines(proofCoordsLines(proof, prefs.coordFormat)).join('\n'),
          source: displayedSource,
          // the credits when the footer prints them, then the app, as the plate says it
          attribution: proof.footerCredits === true ? attributionLine(proof.panels) : footerLine(proof),
          png: result.png,
        };
        uiState.tool = 'post';
      }
      return true;
    } catch (e) {
      toast(`Save failed: ${e.message}${slide ? '. Still on this slide' : ''}`, 'danger', 6000);
      return false;
    } finally {
      saving = false;
    }
  }

  /** Open the list fresh: search and folder view reset. Deleting from the list
   *  refreshes through openProofList instead, which keeps them. */
  function openProofDialog() {
    proofQuery = '';
    proofVideo = '';
    proofBrowserOpen = false;
    proofBrowsePath = '';
    proofBrowseSelection = null;
    // the dialog opens on the press, its rows following when the case answers
    openList ??= [];
    openListLoading = true;
    return openProofList();
  }

  let openListLoading = $state(false);
  async function openProofList() {
    const caseId = caseState.current.id;
    try {
      // A saved proof is filed like any other entity, so its folder lives on the
      // catalog side; the proofs route only knows the files. Both are read at once.
      const [proofs, entities] = await Promise.all([
        api.get(`/api/cases/${caseId}/proofs`),
        fetchAllEntities(caseId, { types: ['proof'] }).catch(() => null),
      ]);
      // closed while it was read: it stays closed
      if (openList === null) return;
      const folders = new Map(
        (entities ?? []).map((entity) => [entity.attrs?.spec ?? '', entity.attrs?.folder ?? ''])
      );
      openList = proofs.map((entry) => ({ ...entry, folder: folders.get(entry.spec_path) ?? '' }));
    } catch (e) {
      openList = null;
      toast(`The saved proofs could not be read: ${e.message}`, 'warn');
    } finally {
      openListLoading = false;
    }
  }

  function matchesProofQuery(entry, query) {
    // by its label, the name given or the place, and its folder: a technical name finds nothing
    return matchesTerms([proofLabel(entry), entry.folder].filter(Boolean).join('\n'), query);
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
    if (confirm) requestOpenProof(entry);
  }

  function confirmProofBrowser() {
    const entry = proofBrowserEntries.find((item) => item.name === proofBrowseSelection);
    if (entry) requestOpenProof(entry);
  }

  // ---- deleting a saved proof ---------------------------------------------------------------
  // From the Open list, the header's ⋯ for the proof open, or a slide's menu: one question,
  // which for a proof of a video also asks what becomes of its scene. By default it goes back
  // to To geolocate, as a delete always gave it back; or it is removed with the proof. Either
  // way the proof goes to the Trash and comes back from there.
  let deleteTarget = $state(null); // `{ name, title, video }` pending deletion
  let deleteScene = $state('keep');
  let deleting = $state(false);

  function askDelete({ name, title, video = null }) {
    if (!name) return;
    deleteScene = 'keep';
    deleteTarget = { name, title: title || name, video: video || null };
  }

  /** Delete the proof asked about. The proof open goes to the next slide of its video, else home. */
  async function deleteSavedProof() {
    const target = deleteTarget;
    const caseId = caseState.current?.id;
    if (!target || !caseId || deleting) return;
    deleting = true;
    const open = proofStarted && savedName === target.name;
    // where to go once it is gone, read off the strip as it stands
    const current = open ? shownSlide : null;
    const next = current ? slideAfterDelete(strip, current.key) : null;
    try {
      const scene = target.video && deleteScene === 'drop' ? '?scene=drop' : '';
      const result = await api.del(`/api/cases/${caseId}/proofs/${encodeURIComponent(target.name)}${scene}`);
      deleteTarget = null;
      if (open) {
        // gone on purpose: no word that the saved proof was deleted behind the composer
        savedName = null;
        dirty = false;
        if (next) await openSlide(next);
        else resetDoc();
      } else if (slides.video) {
        readSlides();
      }
      deletedToast(caseId, result, target.title);
      await Promise.all([openList !== null ? openProofList() : null, reloadCase()]);
      if (sceneQueue.caseId === caseId && sceneQueue.files) readSceneQueue(caseId);
    } catch (e) {
      toast(e.message, 'danger');
    } finally {
      deleting = false;
    }
  }

  // The header's ⋯ for the proof open, and the menu it holds.
  let proofMenu = $state(null);

  /** Show the proof open in Inspect, on its passage: what a slide's menu does. */
  function showInInspect() {
    proofMenu = null;
    if (!scene.star || !savedName) return;
    uiState.inspectScene = { video: scene.star, slide: savedName };
    uiState.tool = 'inspect';
  }

  // Bumped by every open, so panels still streaming in for a proof the analyst
  // has moved on from stop writing into the document that replaced it. The open
  // list stays up while a proof loads, so clicking a second one is one gesture
  // away — and the merged result overwrote the second proof on Save.
  let openRun = 0;

  async function openProof(entry, { navigate = true } = {}) {
    const run = ++openRun;
    // A proof saved before ink moved to page pixels is converted on the way in.
    const spec = withInkOnPage(
      await api.get(`/api/cases/${caseState.current.id}/proofs/${encodeURIComponent(entry.name)}`),
    );
    if (run !== openRun) return;
    const style = normalizeProofStyle(spec);
    resetDoc();
    proofStarted = true;
    // Bind the opened proof's name up front, before the panel images load: a Save
    // or a slide switch that lands during the load has to write back over this
    // proof, not file a new one.
    savedName = entry.name;
    // a slide opened from the strip rewrites the step it is on, so Back leaves the series at once
    settlePlace('proof', place(), { navigate });
    proof.title = spec.title;
    proof.points = editablePoints(spec);
    proof.footerCoords = spec.footerCoords === true;
    proof.footerText = spec.footerText !== false;
    proof.footerCredits = spec.footerCredits === true;
    proof.sceneBadge = spec.sceneBadge === true;
    // What the proof states about its video, read as the spec holds it; never sent back
    // with a save (lib/composer.toSpec), only through its own route.
    scene.load(spec.scene);
    proof.sources = statedSources(spec.sources ?? spec.source ?? null);
    // Both are completed off the entity on the way out of the API, so a date or a
    // sentence edited from Details opens here as the case's answer rather than as
    // the copy this file was written with.
    proof.when = typeof spec.when === 'string' ? spec.when : '';
    proof.whenZone = typeof spec.whenZone === 'string' && spec.whenZone ? spec.whenZone : null;
    proof.description = typeof spec.description === 'string' ? spec.description : '';
    proof.material = normalizeMaterial(spec.material);
    proof.captionSize = style.captionSize;
    proof.legendSize = style.legendSize;
    proof.footerSize = style.footerSize;
    proof.footer = style.footer;
    proof.footerEnabled = style.footerEnabled;
    proof.footerColor = style.footerColor;
    proof.captionColor = style.captionColor;
    proof.footerAlign = style.footerAlign;
    proof.captionsEnabled = style.captionsEnabled;
    proof.font = style.font;
    proof.fontBold = style.fontBold;
    proof.bg = style.bg;
    proof.space = style.space;
    proof.layout = style.layout;
    proof.panelDirection = style.panelDirection;
    proof.signature = style.signature;
    proof.signatureText = style.signatureText;
    proof.azimutMark = style.azimutMark;
    proof.palette = style.palette;
    color = proof.palette[0];
    // Every picture asked for at once, then laid in the spec's order: a slide opens in
    // the time of its slowest picture rather than of all of them end to end.
    const caseId = caseState.current.id;
    const pictures = await Promise.all([
      ...spec.panels.map((p) => loadImage(fileUrl(caseId, p.src)).catch(() => null)),
      // Pasted images come from the proof's own assets folder — nothing in the
      // case points at them, so they are read by the name the spec carries.
      // Mirrors `layout.proof_assets_rel`: pasted images live beside the spec,
      // under `proofs/.meta/`, and not beside the exported picture. Asking one
      // folder up found nothing and read as an overlay the case had lost, on a
      // proof whose file was there the whole time.
      ...(spec.pastes ?? []).map((p) => loadImage(fileUrl(caseId, `proofs/.meta/${entry.name}.assets/${p.asset}`)).catch(() => null)),
      // A published picture is kept in the same folder, the same way.
      ...(spec.published ?? []).map((p) => loadImage(fileUrl(caseId, `proofs/.meta/${entry.name}.assets/${p.asset}`)).catch(() => null)),
    ]);
    if (run !== openRun) return;
    spec.panels.forEach((p, i) => {
      const img = pictures[i];
      if (!img) {
        toast(`Missing panel image: ${p.src}`, 'warn');
        return;
      }
      imgCache.set(p.src, img);
      proof.panels.push(hydratedSurface({
        ...p,
        id: p.id ?? newId('p'),
        row: p.row ?? 0,
      }, img));
    });
    (spec.pastes ?? []).forEach((p, i) => {
      const img = pictures[spec.panels.length + i];
      if (!img) {
        toast('An overlay of this proof is missing', 'warn');
        return;
      }
      pasteAssets.set(p.asset, { img, data: null, pending: false });
      proof.pastes.push(hydratedSurface({ ...p, id: p.id ?? newId('x') }, img));
    });
    // Kept even when its picture does not load: it is the whole proof, and a save that
    // dropped it would leave an empty one behind.
    const before = spec.panels.length + (spec.pastes ?? []).length;
    (spec.published ?? []).forEach((p, i) => {
      const img = pictures[before + i];
      if (img) pasteAssets.set(p.asset, { img, data: null, pending: false });
      else toast('The published picture of this proof is missing', 'warn');
      proof.published.push(hydratedSurface({ ...p }, img ?? null));
    });
    const validSurfaces = new Set([...proof.panels, ...proof.pastes, ...proof.published].map((s) => s.id).concat(PAGE));
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
    picker || newProofOpen || importOpen || openList !== null
      || replaceWithNewConfirm || exportPicker || overwritePrompt !== null
      || placeOffer !== null || orphanOffer !== null || deleteTarget !== null
      || sourcePick !== null || pointMap !== null || checking !== null || leaving !== null
      || slideChooser !== null
  );
  const editableShape = $derived(editableShapes.length === 1 ? editableShapes[0] : null);
  // The picked mark whose pointer the toolbar sets: a callout, or a label that
  // can be given one.
  const tailShape = $derived(
    editableShape?.kind === 'callout' || editableShape?.kind === 'text' ? editableShape : null,
  );
  // A line style means something to the marks drawn with a line, and nothing to
  // a label, a symbol or a blur, so the control follows what is picked or held.
  const showDash = $derived(
    editableShapes.length ? editableShapes.some((s) => DASHABLE.has(s.kind)) : DASHABLE.has(tool),
  );
  const activeDash = $derived(editableShape && DASHABLE.has(editableShape.kind) ? (editableShape.dash ?? 'solid') : lineStyle);
  const textBox = $derived(
    editableShape?.kind === 'text' ? { frame: !!editableShape.frame, bg: editableShape.bg ?? null } : null,
  );
  const pickedSurface = $derived(
    tool !== 'select' ? null
      : selectedPanelId ? proof.panels.find((p) => p.id === selectedPanelId)
        : selectedPasteId ? proof.pastes.find((p) => p.id === selectedPasteId) : null,
  );
  const activeTail = $derived(
    tailShape ? (tailShape.kind === 'callout' ? (tailShape.tail ?? 'leader') : 'none') : calloutTail,
  );
  // Every size the pick has beyond its main one, on its own slider, so words
  // and lines grow apart: a tag's words, a callout's line, a label's frame, and
  // a cone's camera, which is also the next cone's with the tool in hand.
  const moreSizes = $derived.by(() => {
    const s = editableShape;
    if (s?.kind === 'rect' && s.tag) {
      return [{ id: 'tag', label: 'Tag text', value: Math.round(tagSizeOf(s)), min: 8, max: 96 }];
    }
    if (s?.kind === 'callout') {
      const { line } = calloutInk(s.fontSize ?? CALLOUT_FONT, s.strokeWidth);
      return [{ id: 'line', label: 'Line', value: Math.round(line), min: 1, max: 16 }];
    }
    if (s?.kind === 'text' && s.frame) {
      return [{ id: 'frame', label: 'Frame', value: labelFrameOf(s), min: 1, max: 16 }];
    }
    if (s?.kind === 'cone' || (!editableShapes.length && tool === 'cone')) {
      return [{ id: 'camera', label: 'Camera', value: s ? badgeOf(s) : coneBadge, min: CONE_BADGE_MIN, max: CONE_BADGE_MAX }];
    }
    return [];
  });

  function setSize(id, value) {
    if (id === 'camera') coneBadge = value;
    const s = editableShape;
    if (id === 'tag' && s?.kind === 'rect') s.tagSize = value;
    else if (id === 'line' && s?.kind === 'callout') s.strokeWidth = value;
    else if (id === 'frame' && s?.kind === 'text') s.frameWidth = value;
    else if (id === 'camera' && s?.kind === 'cone') s.badge = value;
    else return;
    dirty = true;
  }

  // A picked panel answers for the captions, which all share one size and one
  // colour so a row of them reads as one line; the picked footer for itself.
  const pageText = $derived.by(() => {
    if (tool !== 'select' || selectedIds.length) return null;
    const tc = textColors(proof.bg ?? BG);
    if (selectedPanelId) {
      return { id: 'caption', label: 'Caption', size: proof.captionSize ?? CAPTION_SIZE, color: proof.captionColor ?? null, auto: tc.dim };
    }
    if (selectedSig === 'footer') {
      return { id: 'footer', label: 'Footer', size: proof.footerSize ?? FOOTER_SIZE, color: proof.footerColor ?? null, auto: tc.faint };
    }
    return null;
  });

  function setPageText(patch) {
    const which = pageText?.id;
    if (!which) return;
    if ('size' in patch) proof[`${which}Size`] = Math.max(8, Math.min(80, Math.round(patch.size)));
    if ('color' in patch) proof[`${which}Color`] = patch.color;
    dirty = true;
  }

  const fillableSelection = $derived(editableShapes.some((s) => canFill(s.kind)));
  // A solid symbol is a silhouette: there is no outline to widen, so the
  // control stays away rather than sitting there doing nothing.
  const solidIconOnly = $derived(
    editableShapes.length
      ? editableShapes.every((s) => s.kind === 'icon' && isSolidIcon(s.name))
      : tool === 'icon' && isSolidIcon(iconName),
  );
  // Neither a numbered marker nor a blur box is drawn with a line: one is sized
  // by its corner handles, the other by the box itself. Same rule as a solid
  // symbol — a control that would write nothing stays away.
  const strokeless = $derived(
    editableShapes.length
      ? editableShapes.every((s) => s.kind === 'number' || s.kind === 'blur')
      : tool === 'number' || tool === 'blur',
  );
  // A blur box is drawn from the picture's own pixels, so there is no ink in it
  // to choose. The swatch used to sit there taking a colour nothing read back.
  const colorless = $derived(
    editableShapes.length
      ? editableShapes.every((s) => s.kind === 'blur')
      : tool === 'blur',
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

  /**
   * Write the first row's coordinates down, if the field is still showing the
   * imagery's answer rather than one somebody typed.
   *
   * An empty field means "whatever the imagery says", and a save states only what
   * the proof holds: `statePoints` drops a row with no coordinates, and the whole
   * row goes with it. So naming that point, or calling it the camera, used to be
   * dropped too — the label was typed, the POST carried no point at all, and
   * nothing was filed. Anything that turns the row into a claim materialises the
   * answer first, which is what adding a second row already did.
   */
  function statePoint0() {
    if (proof.points[0].coords.trim()) return;
    // naming a point is not checking where it is
    if (pointProposed(proof.points, 0, proof.panels)) proof.points[0].proposed = true;
    proof.points[0].coords = displayedCoords;
  }

  /** Add a row. The first one is materialised first: that answer has to become the
   *  conclusion in writing before a second point can sit under it. */
  function addPoint() {
    if (proof.points.length >= MAX_POINTS) return;
    statePoint0();
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

  /** Each point's markers in the analyst's layers, and the layers it can join. */
  const pointPlaces = $derived(placesOf(proof.points.map((one, i) => (i === 0 ? displayedCoords : one.coords)), pointLayers.targets));
  const layerTargets = $derived(orderedTargets(pointLayers.targets, pointLayers.last(caseState.current?.id)));

  /** A point into a layer. The marker follows the proof as saved, so unsaved changes are saved first. */
  function addPointToLayer(i, choice) {
    const go = () => pointLayers.add(caseState.current?.id, savedName, i === 0 ? displayedCoords : proof.points[i].coords,
      choice.layer, choice.group, choice.style, choice.status);
    if (dirty || !savedName) save({ then: go }); else go();
  }
  /** The marker on the map, in its layer opened for editing. */
  async function openPointInLayer(place) {
    const row = addedLayers.rows.find((one) => one.name === place.layer.name && one.editable)
      ?? { name: place.layer.name, title: place.layer.title, editable: true };
    uiState.gotoCoords = { lat: place.marker.lat, lon: place.marker.lon, zoom: 17 };
    uiState.tool = 'satellite';
    if (personalLayers.editor?.name !== row.name) await personalLayers.open(row);
    personalLayers.select(place.marker.key);
  }

  /** A camera stood in one place, so lighting one point puts the others out. */
  function togglePov(i) {
    const on = !proof.points[i].pov;
    if (on) statePoint0(); // POV is a claim about the point: state it (see statePoint0)
    proof.points = proof.points.map((one, at) => ({ ...one, pov: on && at === i }));
    dirty = true;
  }

  /** How deep the map opens on a point. A building fits in the frame, which is
   *  what a proof's point is usually on. */
  const POINT_ZOOM = 17;

  /**
   * Where the map opens for one row: the point it already states, else the one
   * above it, else what the panels answer with, else wherever Settings opens the
   * map. A row added with `+` is empty by definition, and the point it was added
   * under is the only thing that says which ground it belongs on.
   */
  function pointMapView(i) {
    const above = proof.points.slice(0, i).map((one) => one.coords).reverse();
    for (const text of [i === 0 ? displayedCoords : proof.points[i].coords, ...above]) {
      const read = parseLatLon(text);
      if (read && !read.outOfBounds) return { lat: read.lat, lon: read.lon, zoom: POINT_ZOOM };
    }
    // The panels answer in numbers rather than in text, so this one reads in
    // whichever format the rows above were written in — MGRS included.
    const auto = autoCoords(proof.panels);
    return auto ? { ...auto, zoom: POINT_ZOOM } : { ...prefs.homeView };
  }

  /** The point the map handed back, written where the row reads it. */
  function movePoint(i, point) {
    proof.points[i].coords = formatCoords(point, prefs.coordFormat);
    proof.points[i].proposed = false;
    dirty = true;
  }

  /** Name a point. The first row's coordinates are written down with it, or the
   *  name is typed onto a row the save drops (see statePoint0). */
  function namePoint(i, value) {
    proof.points[i].label = value;
    if (i === 0) statePoint0();
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
    await readCaseMedia(caseId);
    await reloadCase();
  }

  /** The composer's own two readings of the case's media, read again. */
  async function readCaseMedia(caseId) {
    caseMedia = await api.get(`/api/cases/${caseId}/media`).catch(() => caseMedia);
    presentPaths = new Set([...caseMedia.map((one) => one.path), ...presentPaths]);
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

<!-- A scene of the strip still to prove, in place of a proof: nothing is started by landing on it. -->
{#snippet scenePage()}
  {#if pageTile}
    <DraftPage tile={pageTile} caseId={caseState.current?.id ?? ''} busy={chooserBusy}
      captures={(pageTile.row?.captures ?? []).map((path) => ({ path, thumb: thumbOf(path) }))}
      onaction={(action, extra) => slideAction(action, pageTile, extra)} />
  {/if}
{/snippet}

<!-- Geo Proof's home, in place of the canvas while no proof is open. -->
{#snippet homeView()}
  <ProofHome caseId={caseState.current?.id ?? ''} proofs={homeProofs} files={homeFiles} {live} {thumbOf}
    onnew={openNewProofDialog} onopen={requestOpenProof} onall={openProofDialog} onscene={makeFromHome} />
{/snippet}

<div class="tool">
  <!-- Narrower than its row (the case panel open on a laptop), the header shows the
       secondary buttons as icons, then a shorter name, Save and a dot for unsaved, rather
       than cut off Save and To Post. It is measured on its own width, so the unsaved badge
       coming and going never moves the canvas. -->
  <div class="tool-header" class:compact={headerW > 0 && headerW < HEADER_COMPACT}
    class:tight={headerW > 0 && headerW < HEADER_TIGHT} bind:clientWidth={headerW}>
    {#if !homeShown}
      <!-- the way back to the proofs of the case, from a proof or a scene's page -->
      <BackButton label="Proofs" title="Back to the proofs of this case" onclick={backToHome} guide="proof.home" />
    {/if}
    {#if proofStarted}
      <!-- the analyst's name, empty for none: a technical name never shows here -->
      <input
        class="input title-input"
        aria-label="Proof name"
        placeholder="Name (optional)"
        title="Name the proof. Left empty, it is listed by its place and date"
        value={ownName(proof.title, 'proof')}
        oninput={(event) => nameProof(event.currentTarget.value)}
      />
      {#if dirty}<span class="badge unsaved" title="Changes not saved"><span class="badge-word">unsaved</span></span>{/if}
      {#if savedName}
        <button class="btn btn-ghost btn-sm proof-more" aria-label="More for this proof" title="More for this proof"
          aria-haspopup="menu" aria-expanded={!!proofMenu} onclick={(event) => (proofMenu = proofMenu ? null : event.currentTarget)}>
          <Icon name="more" size={14} stroke={2.4} />
        </button>
      {/if}
    {/if}
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn btn-sm" onclick={openProofDialog} aria-label="Open proof" title="Open a saved proof">
        <Icon name="folderOpen" size={14} /> <span class="words">Open proof</span>
      </button>
    {/if}
    <button class="btn btn-sm" onclick={openNewProofDialog} aria-label="New proof" title="Start a new proof">
      <Icon name="plus" size={14} /> <span class="words">New proof</span>
    </button>
    <!-- Copy, Save and To Post have nothing to act on at home, so they wait for a proof. -->
    {#if !homeShown}
    <div class="export-split">
      <button
        class="btn btn-sm export-main"
        onclick={copyPng}
        disabled={!proofHasContent || copying}
        aria-label={copying ? 'Copying…' : 'Copy'}
        title="Copy the proof PNG"
      >
        <Icon name="copy" size={14} /> <span class="words">{copying ? 'Copying…' : 'Copy'}</span>
      </button>
      <button
        class="btn btn-sm export-toggle"
        onclick={toggleExportMenu}
        aria-label="More export options" title="More export options"
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
          {#if proofHasContent}
            <PutInNote offer={noteOffer} class="export-option put" onput={() => (exportMenuOpen = false)} />
          {/if}
          <div class="export-destination" title={exportDir || "The case's exports folder"}>
            Destination: {destinationLabel(exportDir)}
          </div>
        </div>
      {/if}
    </div>
    <button class="btn btn-ok btn-sm" data-guide="proof.save" onclick={() => save()} disabled={!proofHasContent || saving}>
      <Icon name="save" size={14} /> <span>{#if saving}Saving…{:else}Save<span class="fold-word">{' proof'}</span>{/if}</span>
    </button>
    <button class="btn btn-info btn-sm" data-guide="proof.save" onclick={() => save({ andPost: true })} disabled={!proofHasContent || saving}>
      <Icon name="post" size={14} /> To Post
    </button>
    {/if}
  </div>

  {#if proofMenu}
    <FloatingMenu anchor={proofMenu} width={220} label="This proof" onclose={() => (proofMenu = null)}>
      {#if scene.star}
        <button type="button" class="fm-item" title="Open its video in Inspect on its scene" onclick={showInInspect}>
          <Icon name="inspect" size={14} /><span class="fm-grow">Show in Inspect</span></button>
        <div class="fm-sep"></div>
      {/if}
      <button type="button" class="fm-item danger" title="Send it to the Trash, from where it can be restored"
        onclick={() => { proofMenu = null; askDelete({ name: savedName, title: openLabel(), video: sceneOwned }); }}>
        <Icon name="trash" size={14} /><span class="fm-grow">Delete…</span></button>
    </FloatingMenu>
  {/if}

  {#if kinWords}
    <!-- What the save just joined: the site this point shares with other geolocations,
         the account behind the footage. Said here because this is where the analyst is,
         not in a graph they would have to think of opening. -->
    <div class="kin">
      <Icon name="link" size={13} />
      <span>{kinWords}</span>
      <button class="btn btn-ghost btn-xs" onclick={showKin}>See in the graph</button>
      <button class="btn btn-ghost btn-xs" aria-label="Dismiss" title="Dismiss" onclick={() => (kin = null)}>
        <Icon name="x" size={12} />
      </button>
    </div>
  {/if}

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
      showStroke={!solidIconOnly && !strokeless}
      showColor={!colorless}
      {iconName}
      setIconName={(name) => { iconName = name; tool = 'icon'; }}
      {strokeW}
      {setColor}
      {setStroke}
      {setFill}
      {showDash}
      {activeDash}
      {setDash}
      {textBox}
      {setTextBox}
      surfaceBorder={pickedSurface ? (pickedSurface.frame ?? null) : undefined}
      setSurfaceBorder={(patch) => pickedSurface && setFrame(pickedSurface, patch)}
      frameWidthMax={FRAME_WIDTH_MAX}
      showLens={tool === 'cone' || editableShape?.kind === 'cone'}
      activeLens={editableShape?.kind === 'cone'
        ? { lens: editableShape.lens ?? null, upright: !!editableShape.upright, fov: editableShape.fov }
        : { lens: coneLens, upright: coneUpright, fov: lensFov(coneLens, coneUpright) }}
      {setLens}
      {moreSizes}
      {setSize}
      {pageText}
      {setPageText}
      showTag={editableShape?.kind === 'rect'}
      activeTag={editableShape?.tag ? (editableShape.tagAt ?? 'tl') : 'none'}
      {setTagAt}
      showTail={tool === 'callout' || !!tailShape}
      tailNone={!!tailShape}
      {activeTail}
      {setTail}
      {fit}
      layout={proof.layout}
      {setLayoutMode}
      bind:guide
      tweetGuides={TWEET_GUIDES}
      panelCount={proof.panels.length}
      {applyMagic}
      {asPublished}
    />
    {/if}

    <ProofContextMenu menu={ctxMenu} onclose={() => (ctxMenu = null)} />
    <!-- The canvas and, under it, the slides of its video: the toolbar and the side
         column keep their full height, as Map plate's docks do over its play bar. -->
    <div class="stage">
      <ProofCanvas
        bind:containerEl
        {tool}
        bind:textEdit
        {focusSelect}
        {commitTextEdit}
        {proofHasContent}
        {openPicker}
        page={pageTile ? scenePage : null}
        home={homeShown ? homeView : null}
      />
      {#if openingTitle}
        <p class="opening" role="status" dir="auto">Opening {openingTitle}…</p>
      {/if}
      {#if stripShown}
        <ProofSlides
          tiles={strip}
          video={slides.video}
          title={mediaTitle(slides.video)}
          caseId={caseState.current?.id ?? ''}
          gone={slides.gone}
          bind:folded={slides.folded}
          {heading}
          dirty={proofStarted && dirty}
          onpick={switchSlide}
          onnew={newSlide}
          onstep={stepSlide}
          onvideo={() => { if (proofStarted && scene.star) pickSideTab('scene'); }}
          onaction={slideAction}
          onexport={exportSlides}
          onpost={postSlides}
        />
      {/if}
    </div>

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
        <ProofSideTabs tabs={sideTabList} current={sideShown} needs={proofTabNeeds} onpick={pickSideTab} />
        <!-- The base facts, filled once: where, from where, what and when. -->
        <div class="side-scroll" role="tabpanel" id="proof-pane-proof" aria-labelledby="proof-tab-proof" hidden={sideShown !== 'proof'}>
          <!-- Coordinates + source, auto-filled from the panels, overridable. A ! flags
               a value the analyst still needs to supply, and the tab says so too. -->
          <div class="meta-field" data-guide="proof.coords">
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
                <!-- Six decimals is a tenth of a metre, and nobody moves a corner
                     of a building by editing digits — so the map is one press from
                     the field, inside the same box, the way the date beside it
                     opens its calendar. -->
                <!-- A point the imagery proposed reads greyed until somebody checks it:
                     typed, or placed on the map. -->
                <div
                  class="field-with-act coords-field"
                  class:warn={i === 0 && !displayedCoords}
                  class:proposed={pointProposed(proof.points, i, proof.panels)}
                >
                  <input
                    class="input meta-input"
                    placeholder="lat, lon"
                    value={i === 0 ? displayedCoords : point.coords}
                    oninput={(e) => {
                      proof.points[i].coords = e.target.value;
                      proof.points[i].proposed = false;
                      dirty = true;
                    }}
                  />
                  <button
                    class="field-act"
                    class:check={pointProposed(proof.points, i, proof.panels)}
                    title={pointProposed(proof.points, i, proof.panels)
                      ? 'Not checked yet. Check it on the map'
                      : 'Move this point on the map'}
                    onclick={() => (pointMap = { row: i, view: pointMapView(i) })}
                  >
                    <Icon name="pin" size={13} />
                  </button>
                </div>
                <!-- The name and what the point means, in one box: nothing in the
                     composition can answer the second — a rooftop shot is recorded
                     somewhere it never shows, and a distant skyline is shown from
                     kilometres away. -->
                <div class="field-with-act label-field">
                  <input
                    class="input point-label"
                    placeholder="label"
                    value={point.label}
                    oninput={(e) => namePoint(i, e.target.value)}
                  />
                  <button
                    class="field-act"
                    class:on={point.pov}
                    title="Point of view"
                    onclick={() => togglePov(i)}
                  >
                    <Icon name="eye" size={13} />
                  </button>
                </div>
                <ProofPointMenu
                  index={i}
                  coords={i === 0 ? displayedCoords : point.coords}
                  proposed={pointProposed(proof.points, i, proof.panels)}
                  canSave={proofHasContent}
                  unsaved={dirty || !savedName}
                  busy={pointLayers.busy || saving}
                  caseId={caseState.current?.id ?? null}
                  targets={layerTargets}
                  held={new Set((pointPlaces.get(i) ?? []).map((place) => `${place.layer.name}|${place.marker.group ?? ''}`))}
                  onadd={(choice) => addPointToLayer(i, choice)}
                  oncreate={(title) => pointLayers.create(caseState.current?.id, savedName, title)}
                  oncheck={() => (pointMap = { row: i, view: pointMapView(i) })}
                  onraise={i > 0 ? () => raisePoint(i) : null}
                  onremove={i > 0 ? () => removePoint(i) : null}
                />
              </div>
              <LayerPlaces
                places={pointPlaces.get(i) ?? []}
                busy={pointLayers.busy}
                caseId={caseState.current?.id ?? null}
                onopen={openPointInLayer}
                onremove={(place) => pointLayers.remove(caseState.current?.id, savedName, place)}
              />
            {/each}
            {#if proof.points.length > 1}
              <div class="point-hint">Order decides the conclusion.</div>
            {/if}
          </div>
          <div class="meta-field" data-guide="proof.meta">
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
                <!-- The address itself, one press away in a tab of its own: a
                     source is read far more often than it is typed, and copying a
                     link into the browser to see what it points at is the long way
                     round. -->
                <div class="field-with-act source-field" class:warn={!displayedSource}>
                  <input
                    class="input meta-input"
                    placeholder="https://…"
                    value={row}
                    oninput={(e) => editSource(at, e.target.value)}
                  />
                  <a
                    class="field-act"
                    class:disabled={!openableSource(row)}
                    href={openableSource(row) || undefined}
                    target="_blank"
                    rel="noreferrer"
                    title={openableSource(row) ? 'Open this source in a new tab' : 'Not a web address'}
                    aria-disabled={!openableSource(row)}
                    onclick={(e) => { if (!openableSource(row)) e.preventDefault(); }}
                  >
                    <Icon name="external" size={13} />
                  </a>
                </div>
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

          <!-- One sentence about what the proof shows. It is the proof's notes, so
               the graph shows it and case search finds it, and it is what a post is
               written from instead of a filename. -->
          <div class="meta-field" data-guide="proof.meta">
            <div class="meta-head">
              <Icon name="note" size={13} />
              <span>Description</span>
              <span class="meta-optional">optional</span>
            </div>
            <textarea
              class="input meta-input desc-input"
              rows="2"
              maxlength="2000"
              placeholder="A formation of 13 helicopters heading east"
              value={proof.description}
              oninput={(e) => { proof.description = e.target.value; dirty = true; }}
            ></textarea>
          </div>

          <!-- When the material was taken. Not the day it was published and not the
               day it was filed — the case already holds both of those, read off the
               file. This is the analyst's answer, and it is what the Timeline shows
               the proof at. Nothing of it reaches the plate. -->
          <div class="meta-field" data-guide="proof.meta">
            <div class="meta-head">
              <Icon name="clock" size={13} />
              <span>Date</span>
              <span class="meta-optional">optional</span>
              <!-- Unlike the coordinates and the source, nothing fills this in and
                   nothing marks it missing. Both would be the same mistake: the date
                   a file carries is when it was uploaded or when a camera clock said
                   it was, and neither is when the thing happened. Offered, it would
                   be accepted without being read, and this date is stated for the
                   footage itself. So it is typed on purpose, or it stays unknown —
                   and the bin empties it back to unknown in one press. -->
              {#if proof.when.trim()}
                <button
                  class="meta-clear"
                  title="Clear the date"
                  onclick={() => { proof.when = ''; dirty = true; }}
                >
                  <Icon name="trash" size={12} />
                </button>
              {/if}
            </div>
            <!-- The calendar builds the common answer, a whole day, for the
                 analyst who would rather point at one than spell it; a month, a
                 range or a mark of doubt is still typed, which is what the
                 placeholder shows. -->
            <DateField
              id="proof-when"
              label="Date the material was taken"
              placeholder="dd/mm/yyyy · Oct 2025 · ~2025"
              calendar
              zone={proof.whenZone || pointZone || null}
              value={proof.when}
              onchange={(value) => { proof.when = value; dirty = true; }}
            />
            <!-- Which clock the date is read on. A day is that place's day, so the
                 default follows the first point and is named here rather than
                 assumed: without it the Timeline would put Kyiv's 12th on UTC's. -->
            {#if proof.when.trim()}
              <div class="when-zone">
                <span class="when-zone-label">Clock</span>
                <ClockField
                  value={proof.when}
                  clock={{ zone: proof.whenZone || pointZone || 'UTC', fixed: '' }}
                  here={pointZone ? [{ zone: pointZone, place: 'the point' }] : []}
                  onpick={pickClock}
                />
                {#if !proof.whenZone && !pointZone}
                  <p class="when-zone-note">No point yet, so the day is read in UTC.</p>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <!-- Where in its video the proof happens: only for a proof built on one. The
             player has the tab to itself, and is paused whenever the tab is left. -->
        {#if scene.videos.length}
          <div class="side-scroll" role="tabpanel" id="proof-pane-scene" aria-labelledby="proof-tab-scene" hidden={sideShown !== 'scene'}>
            <SceneBlock {scene} caseId={caseState.current?.id} color={sceneHue} active={sideShown === 'scene'} onaddframe={addSceneFrame} onsave={savedForClip} />
          </div>
        {/if}

        <!-- Where composing happens: the panels, the overlays, the annotations and the elements. -->
        <div class="side-scroll" role="tabpanel" id="proof-pane-layout" aria-labelledby="proof-tab-layout" hidden={sideShown !== 'layout'}>
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
            {openPicker}
            {movePanelZ}
            {scalePanel}
            openCrop={beginSurfaceCrop}
            resetCrop={resetSurfaceCrop}
            {removePanel}
            {movePasteZ}
            {removePaste}
            {pickImageFile}
            {featureList}
            {moveLegendColor}
            {setColor}
            {moveShapeTo}
            kindIcon={KIND_ICON}
            kindLabel={KIND_LABEL}
            {duplicateShape}
            {deleteShape}
            {setLocked}
            markDirty={() => (dirty = true)}
          />
        </div>

        <!-- The look: the house style, then the words, the footer and the signature. -->
        <div class="side-scroll" role="tabpanel" id="proof-pane-style" aria-labelledby="proof-tab-style" hidden={sideShown !== 'style'}>
          <!-- A picture as published keeps its own look: only the words of the marks
               drawn on it take a style. -->
          {#if asPublished}
            <div class="side-hint published-hint">Shown as it was published, so it has no background, margins, footer or signature.</div>
          {:else}
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
          {/if}

          <div class="meta-field">
            <div class="meta-head">
              <Icon name="text" size={13} />
              <span>Text</span>
            </div>
            <label class="size-row">
              <span>Font</span>
              <select
                class="input"
                value={proof.font ?? 'system'}
                onchange={(e) => { proof.font = e.currentTarget.value; dirty = true; }}
                aria-label="proof font"
              >
                {#each PROOF_FONTS as face (face.id)}
                  <option value={face.id}>{face.label}</option>
                {/each}
              </select>
            </label>
            <label class="sig-check">
              <input
                type="checkbox"
                checked={proof.fontBold !== false}
                onchange={(e) => { proof.fontBold = e.currentTarget.checked; dirty = true; }}
              />
              <span>Labels, callouts and tags in bold</span>
            </label>
            {#if !asPublished}
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
            <div class="side-hint">Off: added panels start blank. You can still type a caption on any panel.</div>
            <div class="size-row first">
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
            {#if scene.videos.length}
              <!-- Printed on the picture, like the coordinates below, so asked for. -->
              <label class="sig-check" title={PROOF_SCENE_HELP.badge}>
                <input
                  type="checkbox"
                  checked={proof.sceneBadge === true}
                  onchange={(e) => { proof.sceneBadge = e.currentTarget.checked; dirty = true; }}
                />
                <span>Scene time on the picture</span>
              </label>
              {#if proof.sceneBadge && !scene.moments.length}
                <div class="side-hint">The proof is about the whole video, which has no time to print.</div>
              {/if}
            {/if}
            {/if}
          </div>

          {#if !asPublished}
          <div class="meta-field">
            <div class="meta-head">
              <Icon name="alignBottom" size={13} />
              <span>Footer</span>
            </div>
            <label class="sig-check first">
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
              <div class="size-row first">
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
                <label class="sig-check" title="Adds the panels' imagery credits after the credit line">
                  <input
                    type="checkbox"
                    checked={proof.footerCredits === true}
                    onchange={(e) => { proof.footerCredits = e.currentTarget.checked; dirty = true; }}
                  />
                  <span>Imagery credits</span>
                </label>
                <label class="side-label" for="footer-text">Footer text</label>
                <textarea
                  id="footer-text"
                  class="input footer-input"
                  rows="2"
                  placeholder={footerLine({})}
                  bind:value={proof.footer}
                  oninput={() => (dirty = true)}
                ></textarea>
                <div class="side-hint">Leave empty for “Composed with Azimut”.</div>
              {/if}
              <div class="size-row first">
                <span>Footer alignment</span>
                <select class="input" bind:value={proof.footerAlign}
                  onchange={() => (dirty = true)}>
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                </select>
              </div>
            {:else}
              <div class="side-hint">The band under the panels is gone. Drop all margins for panels-only output.</div>
            {/if}
          </div>

          <div class="meta-field">
            <div class="meta-head">
              <Icon name="edit" size={13} />
              <span>Signature</span>
            </div>
            <label class="sig-check first">
              <input
                type="checkbox"
                disabled={!sigImg}
                checked={!!proof.signature && !!sigImg}
                onchange={(e) => {
                  proof.signature = e.currentTarget.checked ? newSignature() : null;
                  dirty = true;
                }}
              />
              <span>Logo</span>
            </label>
            {#if !sigImg}
              <div class="side-hint">Add a logo in Settings → Publishing to sign your proofs.</div>
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
              <div class="side-hint">Drag the logo on the canvas to nudge it off the corner.</div>
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
              <div class="side-hint">Add your account handle in Settings → Publishing to use it on proofs.</div>
            {:else if proof.signatureText}
              <div class="side-hint">Drag the account handle on the canvas to place it.</div>
            {/if}

            <label class="sig-check" title={PROOF_TEMPLATE_HELP.mark}>
              <input
                type="checkbox"
                checked={!!proof.azimutMark}
                onchange={(e) => {
                  proof.azimutMark = e.currentTarget.checked
                    ? newAzimutMark(proof.signature?.anchor ?? proof.signatureText?.anchor ?? 'br')
                    : null;
                  dirty = true;
                }}
              />
              <span>Azimut mark</span>
            </label>
            {#if proof.azimutMark}
              <div class="sig-anchors" title={PROOF_TEMPLATE_HELP.markCorner}>
                {#each SIG_ANCHORS as a (a.id)}
                  <button
                    class="sig-anchor"
                    class:active={proof.azimutMark.anchor === a.id}
                    onclick={() => { proof.azimutMark = { ...proof.azimutMark, anchor: a.id }; dirty = true; }}
                  >{a.label}</button>
                {/each}
              </div>
              <div class="size-row" title={PROOF_TEMPLATE_HELP.markSize}>
                <span>Size</span>
                <input class="size-slider" type="range" min="12" max={Math.max(96, proof.azimutMark.size)} step="1"
                  value={proof.azimutMark.size}
                  oninput={(e) => {
                    proof.azimutMark = { ...proof.azimutMark, size: Number(e.currentTarget.value) };
                    dirty = true;
                  }} />
                <span class="size-val">{proof.azimutMark.size}</span>
              </div>
              <MarkShowChoice
                value={proof.azimutMark.show}
                title={PROOF_TEMPLATE_HELP.markShow}
                onchange={(show) => { proof.azimutMark = { ...proof.azimutMark, show }; dirty = true; }}
              />
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
    templates={templatesState.proof}
    items={pickerItems}
    scenes={newProofScenes}
    loading={newProofLoading}
    creating={creatingProof}
    caseId={caseState.current?.id ?? ''}
    titleOf={fileTitle}
    {thumbOf}
    readScene={readNewProofScene}
    oncreate={requestNewProofCreation}
    onempty={requestEmptyProof}
    onimport={() => { closeNewProof(); importOpen = true; }}
    onclose={closeNewProof}
  />
{/if}

{#if pointMap}
  <PointMapDialog
    view={pointMap.view}
    onpick={(point) => movePoint(pointMap.row, point)}
    onclose={() => (pointMap = null)}
  />
{/if}

<!-- One point at a time, each on its own map: the dialog reads where it opens once. -->
{#if checkStep}
  {#key checking?.at}
    <PointMapDialog
      view={checkStep?.view}
      check={checkStep?.check}
      onpick={checkPick}
      onlater={checkStep?.later ? () => finishCheck(true) : null}
      onclose={() => (checking = null)}
    />
  {/key}
{/if}

{#if importOpen && caseState.current}
  <ImportProofDialog
    caseId={caseState.current.id}
    onclose={() => (importOpen = false)}
    oncreated={async (created) => {
      await reloadCase();
      requestOpenProof({ name: created.proof.name });
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
    oncancel={() => { replaceWithNewConfirm = false; newProofPlan = null; }}
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

{#if slideChooser}
  <ProofFrames
    scene={slideChooser.scene}
    frames={slideChooser.frames}
    filedIds={slideChooser.filedIds}
    capture={slideChooser.capture}
    captures={slideChooser.captures}
    collages={slideChooser.collages}
    busy={chooserBusy}
    onconfirm={confirmSlideFrames}
    oncancel={closeSlideChooser}
  />
{/if}

{#if leaving}
  <ConfirmDialog
    title="Leave this proof?"
    message="Its changes are not saved."
    confirmLabel="Leave without saving"
    cancelLabel="Keep editing"
    tone="danger"
    icon="reset"
    onconfirm={() => leaving.answer(true)}
    oncancel={() => leaving.answer(false)}
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
    onconfirm={async () => {
      const p = overwritePrompt;
      overwritePrompt = null;
      if ((await performSave(p.andPost)) && p.then) p.then();
      settleSave?.(false);
    }}
    oncancel={() => { overwritePrompt = null; settleSave?.(false); }}
  />
{/if}

<!-- The point this proof concludes on, offered once. The map is where it will be
     read, so the question names the coordinates rather than the file. -->
{#if placeOffer}
  <ConfirmDialog
    title={`${offersOver}${placeOffer.points.length === 1 ? 'Save this point as a place?' : 'Save these points as places?'}`}
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
    title={`${offersOver}${orphanOffer.length === 1 ? 'Delete the old place?' : 'Delete the old places?'}`}
    message={orphanOffer.length === 1
      ? `This proof no longer points at “${orphanOffer[0].label}”.`
      : `This proof no longer points at ${orphanOffer.length} saved places.`}
    detail="Nothing else in the case points there."
    impact={{ caseId: caseState.current?.id, ids: orphanOffer.map((place) => place.id) }}
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    icon="trash"
    busy={orphanDeleting}
    onconfirm={deleteOrphanPlaces}
    oncancel={() => (orphanOffer = null)}
  />
{/if}

{#if deleteTarget}
  <ConfirmDialog
    title="Delete this proof?"
    message={`“${deleteTarget.title}” will be removed from the case.`}
    detail="Moves the PNG and editable proof to the case trash."
    impact={{ caseId: caseState.current?.id, paths: [specPath('proof', deleteTarget.name)] }}
    restorable={RESTORABLE}
    confirmLabel="Delete"
    tone="default"
    icon="trash"
    busy={deleting}
    onconfirm={deleteSavedProof}
    oncancel={() => (deleteTarget = null)}
  >
    {#snippet children()}
      {#if deleteTarget.video}
        <!-- A proof of a video: its scene goes back to geolocate, as a delete always gave
             it back, or goes with it. -->
        <fieldset class="scene-choice">
          <legend>Its scene in {videoName(deleteTarget.video, mediaTitle)}</legend>
          <label><input type="radio" name="proof-scene" value="keep" bind:group={deleteScene} /> Goes back to To geolocate</label>
          <label><input type="radio" name="proof-scene" value="drop" bind:group={deleteScene} /> Is removed with it</label>
        </fieldset>
      {/if}
    {/snippet}
  </ConfirmDialog>
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
    {#if !openList.length && openListLoading}
      <p class="picker-hint" aria-busy="true">Reading the saved proofs…</p>
    {:else if !openList.length}
      <div class="empty"><p>No saved proofs in this case yet.</p></div>
    {:else}
      <div class="picker-stack">
        {#if proofBrowserOpen || openList.length > PICKER_SEARCH_MIN || listVideos.videos.length}
          <div class="picker-search">
            {#if proofBrowserOpen || openList.length > PICKER_SEARCH_MIN}
              <SearchInput bind:value={proofQuery} placeholder="Search proofs…" width="100%" />
            {/if}
            {#if listVideos.videos.length}
              <!-- The proofs of one video, or those on photos: a series is found as a series. -->
              <select class="input video-filter" aria-label="Video" title="Only the proofs of one video" bind:value={proofVideo}>
                <option value="">Every video</option>
                {#each listVideos.videos as one (one.video)}
                  <option value={one.video}>{one.name} · {one.count}</option>
                {/each}
                {#if listVideos.none}<option value={NO_VIDEO}>On no video · {listVideos.none}</option>{/if}
              </select>
            {/if}
            {#if proofBrowserOpen || openList.length > PICKER_SEARCH_MIN}
              <button
                class="btn btn-ghost btn-sm browse-btn"
                title={proofBrowserOpen ? 'Show every proof' : 'Browse folders'}
                onclick={toggleProofBrowser}
              >…</button>
            {/if}
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
            label={(entry) => proofLabel(entry)}
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
                <button class="open-row" onclick={() => requestOpenProof(entry)}>
                  {#if entry.thumb || entry.png}
                    <!-- the thumbnail of the export, or the export itself when
                         it could not be rendered; decoded off the main thread -->
                    <img src={fileUrl(caseState.current.id, entry.thumb ?? entry.png)} alt="" loading="lazy" decoding="async" />
                  {/if}
                  <div class="open-meta">
                    <span class="open-title">{proofLabel(entry)}</span>
                    <span class="open-sub">{entry.panels === 1 ? '1 panel' : `${entry.panels} panels`} · {entry.shapes === 1 ? '1 annotation' : `${entry.shapes} annotations`} · {entry.updated_at?.slice(0, 10)}</span>
                    {#if slideTag(entry)}
                      {@const tag = slideTag(entry)}
                      <span class="open-slide" style:--scene={tag.color} title={tag.text}><span class="open-dot" aria-hidden="true"></span><span class="open-video" dir="auto">{tag.name}</span>{#if tag.where}<span class="open-where">{` · ${tag.where}`}</span>{/if}</span>
                    {/if}
                  </div>
                </button>
                <button class="btn btn-ghost btn-sm open-del" title="Delete this saved proof" onclick={() => askDelete({ ...entry, title: proofLabel(entry) })}>
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
  /* the name gives way first, then the secondary buttons keep their icons alone */
  .tool-header .title-input { min-width: 140px; }
  /* Folded to no width rather than taken out, so the button keeps the height of its
     line of text and stands level with Save and To Post. */
  .tool-header.compact .words { display: inline-block; width: 0; margin-left: -7px; overflow: hidden; }
  /* Tighter still, the name keeps less room, Save proof its verb and the badge its dot. */
  .tool-header.tight .title-input { min-width: 88px; }
  .tool-header.tight .fold-word,
  .tool-header.tight .badge-word { display: inline-block; width: 0; overflow: hidden; vertical-align: bottom; }
  .tool-header.tight .unsaved { align-self: center; width: 8px; height: 8px; padding: 0; border-radius: 50%; background: var(--warn); }
  .spacer { flex: 1; }
  .proof-more { align-self: center; padding-inline: 5px; color: var(--text-2); }
  .scene-choice { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 0; border: 0; }
  .scene-choice legend { margin-bottom: 4px; padding: 0; color: var(--text-2); font-weight: 600; }
  .scene-choice label { display: flex; align-items: center; gap: 8px; color: var(--text-1); cursor: pointer; }
  .scene-choice input { margin: 0; accent-color: var(--accent); }
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
  /* The note's row is drawn by PutInNote, outside this component's scope. */
  .export-menu :global(.export-option.put) {
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
  .export-menu :global(.export-option.put:hover) {
    background: var(--bg-2);
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
  /* the canvas over the strip of its video's slides, between the toolbar and the side column */
  .stage {
    position: relative;
    flex: 1;
    display: flex;
    flex-direction: column;
    min-width: 0;
    min-height: 0;
  }
  /* what is opening, over the top of the canvas until its pictures are in */
  .opening {
    position: absolute;
    top: 14px;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 5px 12px;
    border-radius: 999px;
    background: var(--bg-2);
    border: 1px solid var(--border);
    color: var(--text-2);
    font-size: 12px;
    box-shadow: 0 2px 10px rgb(0 0 0 / 0.25);
    pointer-events: none;
    z-index: 5;
    max-width: 70%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .side {
    width: 300px;
    flex-shrink: 0;
    border-left: 1px solid var(--border);
    background: var(--bg-1);
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  /* One scroller per tab, so each keeps its place when the analyst comes back to it. */
  .side-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 12px;
  }
  .side-scroll[hidden] { display: none; }
  /* A tab's last field needs no gap under it. */
  .side-scroll > .meta-field:last-child { margin-bottom: 0; }
  /* The look's groups stand apart: the house style, the words, the footer, the signature. */
  #proof-pane-style > .meta-field + .meta-field { margin-top: 18px; }
  .meta-field { margin-bottom: 10px; }
  .when-zone { margin-top: 6px; display: grid; grid-template-columns: auto 1fr; align-items: center; gap: 4px 8px; }
  .when-zone-label { font-size: var(--fs-xs); color: var(--text-3); }
  .when-zone-note { grid-column: 2; margin: 0; font-size: var(--fs-xs); color: var(--text-3); }
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
  /* Said outright, because the panel's other headers carry a `!` when they are
     empty and a reader works the rule out from what is on screen: everything
     here is a blank waiting to be filled. These two are not. */
  .meta-optional {
    margin-left: -2px;
    font-size: var(--fs-xs);
    font-weight: 400;
    text-transform: none;
    letter-spacing: 0;
    color: var(--text-3);
  }
  .meta-reset {
    margin-left: auto;
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: var(--r-sm);
  }
  .meta-reset:hover { color: var(--text-1); background: var(--bg-2); }
  /* Empties an optional field rather than handing it back to what the panels say:
     nothing ever filled this one in. */
  .meta-clear {
    margin-left: auto;
    display: inline-flex;
    color: var(--text-3);
    padding: 1px;
    border-radius: var(--r-sm);
  }
  .meta-clear:hover { color: var(--danger, #e05c5c); background: var(--bg-2); }
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
  .meta-row .source-field { flex: 1; min-width: 0; }
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
  /* One point per row. A proof with a single point shows a coordinate field, a
     label and the marker — no cross, no arrow, nothing to move. */
  .point-row { display: flex; align-items: center; gap: 4px; }
  .point-row + .point-row { margin-top: 4px; }
  .point-row .meta-input { flex: 1; min-width: 0; }
  .point-row .coords-field { flex: 1; min-width: 0; }
  .coords-field.proposed .meta-input { color: var(--text-3); font-style: italic; }
  .coords-field .field-act.check { color: var(--warn, #e8a33d); }
  /* The name is as wide as a name needs to be; the coordinate takes the rest. */
  .point-row .label-field { width: 110px; flex: none; }
  .point-label { width: 100%; min-width: 0; font-size: var(--fs-xs); padding: 5px 8px; }
  .point-hint { margin-top: 5px; font-size: var(--fs-xs); color: var(--text-3); }
  .desc-input { resize: vertical; min-height: 44px; line-height: 1.35; }
  .size-row {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 8px;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
  .size-row span:first-child { min-width: 78px; white-space: nowrap; }
  .size-row select { flex: 1; min-width: 0; font-size: var(--fs-xs); padding: 4px 6px; }
  .size-slider { flex: 1; accent-color: var(--accent); }
  .size-val { min-width: 18px; text-align: right; color: var(--text-2); }
  .side-label {
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
  .side-hint { font-size: 11px; color: var(--text-3); margin-top: 5px; }
  .published-hint { margin: 0 0 12px; line-height: 1.45; }
  .sig-check {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-top: 12px;
    font-size: var(--fs-xs);
    cursor: pointer;
  }
  /* the first control under a group's heading, or the first row after a hint */
  .sig-check.first { margin-top: 2px; }
  .size-row.first { margin-top: 12px; }
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
  .open-meta { display: flex; flex: 1; flex-direction: column; gap: 2px; min-width: 0; }
  .open-title { font-weight: 600; font-size: var(--fs-sm); }
  .open-sub { font-size: var(--fs-xs); color: var(--text-3); }
  /* a proof of a video: its video and its place among the slides, in its scene's colour */
  .open-slide {
    display: flex; align-items: center; gap: 5px; min-width: 0; margin-top: 1px;
    color: color-mix(in srgb, var(--scene) 72%, var(--text-1)); font-size: var(--fs-xs); font-weight: 600;
    font-variant-numeric: tabular-nums; white-space: nowrap;
  }
  .open-dot { flex: none; width: 7px; height: 7px; border-radius: 50%; background: var(--scene); }
  /* a long name gives way, and where the slide stands stays in sight */
  .open-video { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  .open-where { flex: none; margin-left: -5px; white-space: pre; }
  .video-filter { flex: none; width: auto; max-width: 220px; }
  .kin {
    display: flex; align-items: center; gap: 8px; padding: 5px 14px;
    border-bottom: 1px solid var(--border); background: var(--accent-soft);
    color: var(--text-2); font-size: var(--fs-xs);
  }
  .kin span { flex: 1; min-width: 0; }
</style>
