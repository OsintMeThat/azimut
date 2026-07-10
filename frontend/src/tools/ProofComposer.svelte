<script>
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import {
    ANNO_COLORS, PAD, TWEET_GUIDES,
    CAPTION_SIZE, LEGEND_SIZE, FOOTER_SIZE,
    BG, TEXT_MAIN, TEXT_DIM, TEXT_FAINT,
    layoutPanels, panelsBlockHeight, legendLineHeight, footerBand,
    attributionLine, docSize, offsetShape, autoLayoutRows,
    autoCoords, formatCoords, autoSource, resolveSourceUrls,
    toSpec, newId, loadImage, featureColors, notesFromShapes,
    copyShapeSpec,
  } from '../lib/composer.js';

  const SCALE_MIN = 0.4;
  const SCALE_MAX = 2.5;
  const SCALE_STEP = 0.1;

  const DRAW_TOOLS = [
    { id: 'select', icon: 'hand', label: 'Select / move' },
    { id: 'rect', icon: 'square', label: 'Box' },
    { id: 'ellipse', icon: 'circle', label: 'Ellipse' },
    { id: 'arrow', icon: 'arrow', label: 'Arrow' },
    { id: 'line', icon: 'line', label: 'Line' },
    { id: 'curve', icon: 'curve', label: 'Curve (click points, double-click to finish)' },
    { id: 'text', icon: 'text', label: 'Text' },
  ];

  // ---- document state -------------------------------------------------------
  // `notes` holds the legend text per color (annotations are written by color,
  // not per element); `shapes` are the drawn geometry bound to a panel.
  const proof = $state({
    title: 'Untitled proof', panels: [], shapes: [], notes: {},
    coordsText: '', source: '', // '' → auto-derived from panels; non-empty → manual override
    captionSize: CAPTION_SIZE, legendSize: LEGEND_SIZE, footerSize: FOOTER_SIZE, footer: '',
  });
  let advancedOpen = $state(false);
  let collapsed = $state({ panels: false, annotations: false, elements: false });
  let savedName = $state(null);
  let dirty = $state(false);
  let tool = $state('select');
  let color = $state(ANNO_COLORS[0]);
  let strokeW = $state(4);
  let guide = $state(null); // null | '16:9' | '4:5' — tweet centre-crop overlay
  let selectedId = $state(null);
  let picker = $state(false);
  let pickerItems = $state([]);
  let openList = $state(null); // list of saved proofs, null = closed
  let saving = $state(false);
  let proofFor = $state(undefined);

  // ---- konva ------------------------------------------------------------------
  let containerEl;
  let stage, docLayer, uiLayer, transformer, endHandles, guideGroup;
  let drawing = null; // {panel, node, start, box, kind}
  let pathDraft = null; // {panel, box, node, points:[]} — multi-click curve in progress

  onMount(() => {
    stage = new Konva.Stage({ container: containerEl, width: 100, height: 100 });
    docLayer = new Konva.Layer();
    uiLayer = new Konva.Layer();
    stage.add(docLayer, uiLayer);
    transformer = new Konva.Transformer({
      rotateEnabled: false,
      flipEnabled: false,
      anchorSize: 9,
      anchorCornerRadius: 3,
      anchorStroke: '#e8a33d',
      anchorFill: '#161e2e',
      borderStroke: '#e8a33d',
      borderDash: [4, 3],
      ignoreStroke: true,
    });
    guideGroup = new Konva.Group({ listening: false });
    uiLayer.add(guideGroup);
    uiLayer.add(transformer);
    endHandles = new Konva.Group();
    uiLayer.add(endHandles);

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

    return () => {
      resize.disconnect();
      stage.destroy();
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

  // rebuild canvas whenever the document changes
  $effect(() => {
    JSON.stringify([
      proof.panels.map((p) => [p.src, p.caption, p.row, p.scale]),
      proof.shapes,
      proof.notes,
      proof.captionSize, proof.legendSize, proof.footerSize, proof.footer,
      selectedId,
      guide,
    ]);
    if (stage) rebuild();
  });

  // Text-size options threaded into every layout/size computation.
  const textOpts = () => ({
    captionSize: proof.captionSize,
    legendSize: proof.legendSize,
    footerSize: proof.footerSize,
  });

  function resetDoc() {
    proof.title = 'Untitled proof';
    proof.panels = [];
    proof.shapes = [];
    proof.notes = {};
    proof.coordsText = '';
    proof.source = '';
    proof.captionSize = CAPTION_SIZE;
    proof.legendSize = LEGEND_SIZE;
    proof.footerSize = FOOTER_SIZE;
    proof.footer = '';
    savedName = null;
    selectedId = null;
    dirty = false;
  }

  // ---- panels ------------------------------------------------------------------

  function satPanelInput(s) {
    return {
      src: s.path,
      meta: {
        kind: 'satellite', attribution: s.attribution, lat: s.lat, lon: s.lon,
        zoom: s.zoom, provider: s.provider_label, date: s.fetched_at?.slice(0, 10),
      },
      caption: `${s.provider_label} · ${s.lat.toFixed(6)}, ${s.lon.toFixed(6)} · ${s.fetched_at?.slice(0, 10) ?? ''}`,
    };
  }

  function mediaPanelInput(m, mediaList = []) {
    // Trace the real source link through the derivation chain (a collage/frame
    // carries no URL of its own — follow it back to the downloaded original).
    // A file uploaded from disk has no URL, so it contributes no source.
    const byPath = new Map(mediaList.map((x) => [x.path, x]));
    const urls = resolveSourceUrls(m, byPath);
    return {
      src: m.path,
      meta: { kind: 'media', source_url: urls[0], source_urls: urls },
      caption: '',
    };
  }

  async function openPicker() {
    if (!caseState.current) {
      toast('Add media first — the composer works on case images', 'info');
      uiState.tool = 'media';
      return;
    }
    const [media, sats] = await Promise.all([
      api.get(`/api/cases/${caseState.current.id}/media`),
      api.get(`/api/cases/${caseState.current.id}/satellite`),
    ]);
    pickerItems = [
      ...sats.map((s) => ({
        ...satPanelInput(s),
        label: `${s.lat.toFixed(6)}, ${s.lon.toFixed(6)} · z${s.zoom}`,
        thumb: s.path,
        kind: 'satellite',
      })),
      ...media
        .filter((m) => m.kind === 'image')
        .map((m) => ({
          ...mediaPanelInput(m, media),
          label: m.filename,
          thumb: m.thumbnail ?? m.path,
          kind: 'media',
        })),
    ];
    picker = true;
  }

  async function addPanel(item) {
    try {
      const img = await loadImage(`/files/${caseState.current.id}/${item.src}`);
      // append to the current bottom row so new panels join the strip
      const row = proof.panels.length
        ? Math.max(...proof.panels.map((p) => p.row ?? 0))
        : 0;
      proof.panels.push({
        id: newId('p'),
        src: item.src,
        caption: item.caption ?? '',
        row,
        scale: 1,
        natural: [img.naturalWidth, img.naturalHeight],
        meta: item.meta ?? {},
        img,
      });
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
        await addPanel(satPanelInput(sat));
        continue;
      }
      const m = media.find((x) => x.path === path);
      if (m) await addPanel(mediaPanelInput(m, media));
    }
  }

  // Renumber rows to a dense 0..n-1 range after a move may have emptied one.
  function normalizeRows() {
    const order = [...new Set(proof.panels.map((p) => p.row ?? 0))].sort((a, b) => a - b);
    const remap = new Map(order.map((r, i) => [r, i]));
    for (const p of proof.panels) p.row = remap.get(p.row ?? 0);
  }

  // Swap a panel with its left/right neighbour *within the same row*.
  function movePanel(index, delta) {
    const row = proof.panels[index].row ?? 0;
    let target = index + delta;
    while (target >= 0 && target < proof.panels.length && (proof.panels[target].row ?? 0) !== row) {
      target += delta;
    }
    if (target < 0 || target >= proof.panels.length || (proof.panels[target].row ?? 0) !== row) return;
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

  const rowOf = (i) => proof.panels[i]?.row ?? 0;
  const canMoveLeft = (i) => proof.panels.slice(0, i).some((p) => (p.row ?? 0) === rowOf(i));
  const canMoveRight = (i) => proof.panels.slice(i + 1).some((p) => (p.row ?? 0) === rowOf(i));

  // Grow / shrink a single panel (its drawn elements scale with it, since they
  // live in the panel's natural pixel space and render at the panel box scale).
  function scalePanel(index, delta) {
    const p = proof.panels[index];
    const cur = p.scale ?? 1;
    const next = Math.round(Math.min(SCALE_MAX, Math.max(SCALE_MIN, cur + delta)) * 10) / 10;
    if (next === cur) return;
    p.scale = next;
    dirty = true;
    requestAnimationFrame(fit);
  }

  // "Magic" tweet fit: re-pack panels into rows so the composite lands closest
  // to the active tweet aspect (the toggled 16:9 / 4:5 guide, else 16:9) and
  // reset every panel to its default size.
  function applyMagic() {
    if (!proof.panels.length) return;
    const target = guide ? TWEET_GUIDES[guide] : TWEET_GUIDES['16:9'];
    const rows = autoLayoutRows(proof.panels, proof.shapes, proof.notes, textOpts(), target);
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
    dirty = true;
    requestAnimationFrame(fit);
  }

  // ---- view (zoom / pan / fit) ----------------------------------------------------

  function fit() {
    if (!stage || !containerEl || !containerEl.clientWidth) return;
    const { width, height } = docSize(proof.panels, proof.shapes, proof.notes, textOpts());
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
      const { width, height } = docSize(proof.panels, proof.shapes, proof.notes, textOpts());
      drawGuide(width, height);
    }
    stage.batchDraw();
  }

  // ---- drawing ----------------------------------------------------------------------

  function docPoint() {
    const p = stage.getPointerPosition();
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  }

  function panelAt(doc) {
    const boxes = layoutPanels(proof.panels, proof.captionSize);
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (doc.x >= b.x && doc.x <= b.x + b.w && doc.y >= b.y && doc.y <= b.y + b.h) {
        return { index: i, box: b, nx: (doc.x - b.x) / b.scale, ny: (doc.y - b.y) / b.scale };
      }
    }
    return null;
  }

  function onPointerDown(e) {
    if (tool === 'select') {
      const onEmpty = e.target === stage || e.target.name() === 'bg';
      stage.draggable(onEmpty);
      if (onEmpty) selectedId = null;
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
    if (kind === 'rect') {
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
    const n = points.length;
    if (n >= 4 && Math.hypot(points[n - 2] - points[n - 4], points[n - 1] - points[n - 3]) < 3) {
      points.length = n - 2;
    }
    if (commit && points.length >= 4) {
      const s = {
        id: newId('s'), panel: panel.id, kind: 'curve', color,
        strokeWidth: strokeW, points, tension: 0.5,
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
    const { width, height, legend, cols } = docSize(proof.panels, proof.shapes, proof.notes, textOpts());
    const boxes = layoutPanels(proof.panels, proof.captionSize);
    const capSize = proof.captionSize ?? CAPTION_SIZE;

    docLayer.add(
      new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: BG })
    );

    proof.panels.forEach((panel, i) => {
      const box = boxes[i];
      // Outer group is NOT clipped so an element can be dragged across panels;
      // only the image itself is clipped to the panel box (inner group).
      const group = new Konva.Group({
        id: `pg-${panel.id}`,
        x: box.x, y: box.y,
        scaleX: box.scale, scaleY: box.scale,
      });
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
          fill: TEXT_DIM, ellipsis: true, wrap: 'none', listening: false,
        }));
      }
    });

    // legend (numbered colored chips) laid out in `cols` columns, then footer.
    // Chip + text scale with the legend font size and stay vertically centred.
    const legendSize = proof.legendSize ?? 17;
    const lineH = legendLineHeight(legendSize);
    const r = Math.round(legendSize * 0.62);
    const numSize = Math.round(legendSize * 0.72);
    const legendTop = PAD + panelsBlockHeight(proof.panels, proof.captionSize) + 8;
    const colW = (width - PAD * 2 - (cols - 1) * PAD) / cols;
    legend.filter((l) => l.text).forEach((line, i) => {
      const col = i % cols;
      const rowN = Math.floor(i / cols);
      const cx = PAD + col * (colW + PAD);
      const cy = legendTop + rowN * lineH + lineH / 2;
      docLayer.add(new Konva.Circle({
        x: cx + r, y: cy, radius: r, fill: line.color, listening: false,
      }));
      docLayer.add(new Konva.Text({
        x: cx, y: cy - numSize * 0.62, width: r * 2, align: 'center',
        text: String(line.n), fontSize: numSize, fontStyle: 'bold',
        fill: '#0b0f17', listening: false,
      }));
      docLayer.add(new Konva.Text({
        x: cx + r * 2 + 8, y: cy - legendSize * 0.62, width: colW - (r * 2 + 8),
        text: line.text, fontSize: legendSize, fill: TEXT_MAIN,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
    });
    if (proof.panels.length) {
      const footerSize = proof.footerSize ?? 13;
      const footerText = proof.footer?.trim() || attributionLine(proof.panels);
      docLayer.add(new Konva.Text({
        x: PAD,
        y: height - PAD - footerBand(footerSize) + Math.round((footerBand(footerSize) - footerSize) / 2),
        width: width - PAD * 2,
        text: footerText,
        fontSize: footerSize, fill: TEXT_FAINT,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
    }

    // selection
    const selectedNode = selectedId ? docLayer.findOne(`#${selectedId}`) : null;
    transformer.nodes(selectedNode ? [selectedNode] : []);
    const cls = selectedNode?.className;
    transformer.rotateEnabled(cls === 'Text' || cls === 'Rect' || cls === 'Ellipse');
    transformer.enabledAnchors(
      cls === 'Rect' || cls === 'Ellipse'
        ? ['top-left', 'top-right', 'bottom-left', 'bottom-right', 'middle-left', 'middle-right', 'top-center', 'bottom-center']
        : cls === 'Text'
          ? ['top-left', 'top-right', 'bottom-left', 'bottom-right']
          : []
    );
    drawEndHandles(boxes);
    drawGuide(width, height);
    docLayer.batchDraw();
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
    const dim = 'rgba(9, 12, 20, 0.62)';
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
        radius: r, fill: '#161e2e', stroke: '#e8a33d', strokeWidth: 2 / stage.scaleX(),
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

  // On drop, re-bind a shape to whichever panel its anchor now sits over and
  // convert its coordinates into that panel's natural pixel space. Returns the
  // source/destination layout boxes so the caller can remap x/y or points.
  function rebindOnDrop(s, node) {
    const boxes = layoutPanels(proof.panels, proof.captionSize);
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
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i];
      if (dx >= b.x && dx <= b.x + b.w && dy >= b.y && dy <= b.y + b.h) { toIdx = i; break; }
    }
    s.panel = proof.panels[toIdx].id;
    return { fromBox, toBox: boxes[toIdx] };
  }

  // Doc→panel remap of a single x/y origin between two layout boxes.
  function remapXY(x, y, fromBox, toBox) {
    return {
      x: (fromBox.x + x * fromBox.scale - toBox.x) / toBox.scale,
      y: (fromBox.y + y * fromBox.scale - toBox.y) / toBox.scale,
    };
  }

  // `box` carries `scale` (natural→doc, grows with the panel) and `baseScale`
  // (that mapping at scale 1). Stroke width and arrow heads are normalised by
  // baseScale so they read the same across image resolutions yet still grow
  // proportionally when the panel is scaled up.
  function makeShapeNode(s, box) {
    const panelScale = box.baseScale;
    if (s.kind === 'text') {
      const node = new Konva.Text({
        id: s.id, x: s.x, y: s.y, text: s.text || ' ',
        fontSize: s.fontSize ?? 28, fontFamily: 'system-ui, sans-serif',
        fontStyle: 'bold', fill: s.color, rotation: s.rotation ?? 0, draggable: true,
      });
      node.on('pointerdown', (e) => {
        if (tool === 'select') {
          e.cancelBubble = true;
          selectedId = s.id;
        }
      });
      node.on('dragstart', () => node.getParent()?.moveToTop());
      node.on('dragend', () => {
        const { fromBox, toBox } = rebindOnDrop(s, node);
        const p = toBox ? remapXY(node.x(), node.y(), fromBox, toBox) : { x: node.x(), y: node.y() };
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
    } else if (s.kind === 'curve') {
      node = new Konva.Line({
        points: s.points, tension: s.tension ?? 0.5,
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
      }
    });
    node.on('dragstart', () => node.getParent()?.moveToTop());
    node.on('dragend', () => {
      if (s.kind === 'rect' || s.kind === 'ellipse') {
        const { fromBox, toBox } = rebindOnDrop(s, node);
        const p = toBox ? remapXY(node.x(), node.y(), fromBox, toBox) : { x: node.x(), y: node.y() };
        s.x = p.x;
        s.y = p.y;
      } else {
        // arrow / line / curve: fold the drag offset into every vertex, then
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

  // ---- shape ops from the side panel -----------------------------------------------------

  // ---- clipboard (copy / paste / duplicate of a single element) ---------------
  let clipboard = null; // detached deep copy of a shape spec (no id)

  function copyShape(id = selectedId) {
    const s = proof.shapes.find((x) => x.id === id);
    if (!s) return;
    clipboard = copyShapeSpec(s);
  }

  // Paste the clipboard as a fresh element, nudged down-right so it doesn't hide
  // the original. Points-based kinds (line/arrow/curve) shift every vertex.
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

  const KIND_ICON = { rect: 'square', ellipse: 'circle', arrow: 'arrow', line: 'line', curve: 'curve', text: 'text' };
  const KIND_LABEL = { rect: 'Box', ellipse: 'Ellipse', arrow: 'Arrow', line: 'Line', curve: 'Curve', text: 'Text' };

  // Color / stroke controls act on the selected shape when there is one
  // (live edit), otherwise they set the defaults for the next drawn shape.
  function setColor(c) {
    if (selectedShape) {
      const oldColor = selectedShape.color;
      selectedShape.color = c;
      // carry the legend note over if this color is otherwise unused
      if (proof.notes[oldColor] && !proof.notes[c] &&
          !proof.shapes.some((s) => s !== selectedShape && s.color === oldColor)) {
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

  function onKeydown(e) {
    if (uiState.tool !== 'proof') return;
    if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;
    if (pathDraft && (e.key === 'Enter' || e.key === 'Escape')) {
      finishPath(e.key === 'Enter');
      return;
    }
    // clipboard: copy / paste / duplicate the selected element
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === 'c' && selectedId) { e.preventDefault(); copyShape(); }
      else if (k === 'v' && clipboard) { e.preventDefault(); pasteShape(); }
      else if (k === 'd' && selectedId) { e.preventDefault(); duplicateShape(); }
      return; // don't fall through to the single-letter tool shortcuts
    }
    if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
      deleteShape(selectedId);
    } else if (e.key === 'Escape') {
      selectedId = null;
      tool = 'select';
    } else if (e.key === 'v') tool = 'select';
    else if (e.key === 'r') tool = 'rect';
    else if (e.key === 'e') tool = 'ellipse';
    else if (e.key === 'a') tool = 'arrow';
    else if (e.key === 'l') tool = 'line';
    else if (e.key === 'c') tool = 'curve';
    else if (e.key === 't') tool = 'text';
    else if (e.key === 'f') fit();
  }

  // ---- persistence -------------------------------------------------------------------------

  function exportPng() {
    const { width, height } = docSize(proof.panels, proof.shapes, proof.notes, textOpts());
    const prevScale = stage.scale();
    const prevPos = stage.position();
    const prevSize = { w: stage.width(), h: stage.height() };
    transformer.nodes([]);
    stage.scale({ x: 1, y: 1 });
    stage.position({ x: 0, y: 0 });
    stage.width(width);
    stage.height(height);
    const pixelRatio = Math.min(Math.max(1800 / width, 0.75), 2);
    const dataUrl = docLayer.toDataURL({ x: 0, y: 0, width, height, pixelRatio });
    stage.scale(prevScale);
    stage.position(prevPos);
    stage.width(prevSize.w);
    stage.height(prevSize.h);
    rebuild();
    return dataUrl;
  }

  async function save({ andPost = false } = {}) {
    if (!proof.panels.length || saving) return;
    saving = true;
    try {
      const c = await ensureCase();
      const dataUrl = exportPng();
      const result = await api.post(`/api/cases/${c.id}/proofs`, {
        name: savedName,
        title: proof.title,
        spec: toSpec(proof),
        png_base64: dataUrl.split(',')[1],
      });
      savedName = result.name;
      dirty = false;
      await reloadCase();
      toast(`Proof saved — ${result.png}`, 'ok');
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

  async function openProof(entry) {
    const spec = await api.get(`/api/cases/${caseState.current.id}/proofs/${entry.name}`);
    resetDoc();
    proof.title = spec.title;
    proof.coordsText = spec.coordsText ?? '';
    proof.source = spec.source ?? '';
    proof.captionSize = spec.captionSize ?? CAPTION_SIZE;
    proof.legendSize = spec.legendSize ?? LEGEND_SIZE;
    proof.footerSize = spec.footerSize ?? FOOTER_SIZE;
    proof.footer = spec.footer ?? '';
    for (const p of spec.panels) {
      try {
        const img = await loadImage(`/files/${caseState.current.id}/${p.src}`);
        proof.panels.push({ ...p, id: p.id ?? newId('p'), row: p.row ?? 0, img });
      } catch {
        toast(`Missing panel image: ${p.src}`, 'warn');
      }
    }
    const validPanels = new Set(proof.panels.map((p) => p.id));
    proof.shapes = (spec.shapes ?? []).filter((s) => validPanels.has(s.panel));
    // legend text lives in `notes` (per color); migrate old per-shape comments
    proof.notes = spec.notes ?? notesFromShapes(proof.shapes);
    savedName = entry.name;
    openList = null;
    dirty = false;
    requestAnimationFrame(fit);
  }

  const selectedShape = $derived(proof.shapes.find((s) => s.id === selectedId));
  const activeColor = $derived(selectedShape?.color ?? color);
  const featureList = $derived(featureColors(proof.shapes));

  // Coordinates + source shown above the panels: a manual override wins, else
  // the value auto-derived from the panels (reactive — deleting the first
  // satellite panel falls back to the next, adding media fills the source).
  const displayedCoords = $derived(proof.coordsText.trim() || formatCoords(autoCoords(proof.panels)));
  const displayedSource = $derived(proof.source.trim() || autoSource(proof.panels));
</script>

<svelte:window onkeydown={onKeydown} />

<div class="tool">
  <div class="tool-header">
    <h2>Proof Composer</h2>
    <input class="input title-input" bind:value={proof.title} onchange={() => (dirty = true)} />
    {#if dirty}<span class="badge">unsaved</span>{/if}
    <div class="spacer"></div>
    {#if caseState.current}
      <button class="btn" onclick={openProofList}><Icon name="folderOpen" size={15} /> Open</button>
    {/if}
    <button class="btn" onclick={openPicker}><Icon name="plus" size={15} /> Add panel</button>
    <button class="btn btn-primary" onclick={() => save()} disabled={!proof.panels.length || saving}>
      <Icon name="check" size={15} /> {saving ? 'Saving…' : 'Save'}
    </button>
    <button class="btn" onclick={() => save({ andPost: true })} disabled={!proof.panels.length || saving}>
      <Icon name="post" size={15} /> To Post
    </button>
  </div>

  <div class="body">
    <!-- left: drawing toolbar -->
    <div class="toolbar">
      {#each DRAW_TOOLS as t (t.id)}
        <button
          class="tb-btn"
          class:active={tool === t.id}
          title="{t.label} ({t.id === 'select' ? 'v' : t.id[0]})"
          onclick={() => (tool = t.id)}
        >
          <Icon name={t.icon} size={18} />
        </button>
      {/each}
      <div class="tb-sep"></div>
      {#each ANNO_COLORS as c (c)}
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
        class:active={!ANNO_COLORS.includes(activeColor)}
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
      {#if !proof.panels.length}
        <div class="empty overlay-empty">
          <div class="empty-icon"><Icon name="proof" size={42} /></div>
          <h3>Compose a proof</h3>
          <p>
            Add panels — frames, photos, satellite crops — then draw colored shapes to match
            features. <strong>Same color = same feature</strong> across panels.
          </p>
          <button class="btn btn-primary" onclick={openPicker}>
            <Icon name="plus" size={15} /> Add your first panel
          </button>
        </div>
      {/if}
    </div>

    <!-- right: panels & annotations -->
    <aside class="side">
      <div class="side-scroll">
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
              <span class="meta-warn" title="A source is a link — add media downloaded from a URL, or paste one">
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

        <button class="side-title collapsible" style="margin-top: 14px" onclick={() => (collapsed.panels = !collapsed.panels)}>
          <span><Icon name={collapsed.panels ? 'chevronRight' : 'chevronDown'} size={13} /> Panels <span class="count">{proof.panels.length}</span></span>
        </button>
        {#if !collapsed.panels}
        {#each proof.panels as panel, i (panel.id)}
          <div class="panel-row card">
            <div class="panel-thumb">
              <img src={`/files/${caseState.current?.id}/${panel.src}`} alt="" />
              <span class="row-badge" title="Row (top→bottom)">R{(panel.row ?? 0) + 1}</span>
            </div>
            <input
              class="input cap-input"
              placeholder="Caption…"
              bind:value={panel.caption}
              onchange={() => (dirty = true)}
            />
            <div class="panel-actions">
              <button class="btn btn-ghost btn-sm" disabled={!canMoveLeft(i)} title="Move left in row" onclick={() => movePanel(i, -1)}>←</button>
              <button class="btn btn-ghost btn-sm" disabled={!canMoveRight(i)} title="Move right in row" onclick={() => movePanel(i, 1)}>→</button>
              <button class="btn btn-ghost btn-sm" disabled={(panel.row ?? 0) === 0} title="Move up a row" onclick={() => movePanelRow(i, -1)}>↑</button>
              <button class="btn btn-ghost btn-sm" title="Move down a row" onclick={() => movePanelRow(i, 1)}>↓</button>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto" title="Remove panel" onclick={() => removePanel(i)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
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
          </div>
        {/each}
        {/if}

        <!-- Annotations: one legend note per color (feature), not per element -->
        <button class="side-title collapsible" style="margin-top: 14px" onclick={() => (collapsed.annotations = !collapsed.annotations)}>
          <span><Icon name={collapsed.annotations ? 'chevronRight' : 'chevronDown'} size={13} /> Annotations <span class="count">{featureList.length}</span></span>
        </button>
        {#if !collapsed.annotations}
        {#if !featureList.length}
          <div class="none">Draw on the panels with the box, ellipse, arrow or line tools. Same color = same feature.</div>
        {/if}
        {#each featureList as c, i (c)}
          <div class="anno-row" class:active={activeColor === c}>
            <button
              class="chip-num"
              style:background={c}
              title="Select this color"
              onclick={() => setColor(c)}
            >{i + 1}</button>
            <input
              class="input comment-input"
              placeholder={`Feature ${i + 1} — legend text…`}
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

        <!-- Advanced: text sizes + editable footer (the trickier knobs) -->
        <button class="adv-toggle" onclick={() => (advancedOpen = !advancedOpen)} style="margin-top: 14px">
          <Icon name={advancedOpen ? 'chevronDown' : 'chevronRight'} size={13} />
          Advanced — text &amp; footer
        </button>
        {#if advancedOpen}
          <div class="adv-body">
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
            <div class="adv-hint">Leave empty to keep the automatic imagery / source attribution.</div>
          </div>
        {/if}
      </div>
    </aside>
  </div>
</div>

{#if picker}
  <Modal title="Add a panel" onclose={() => (picker = false)} width="720px">
    {#if !pickerItems.length}
      <div class="empty">
        <p>No images in this case yet — import media or capture satellite imagery first.</p>
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
          <button class="open-row" onclick={() => openProof(entry)}>
            {#if entry.png}
              <img src={`/files/${caseState.current.id}/${entry.png}`} alt="" loading="lazy" />
            {/if}
            <div class="open-meta">
              <span class="open-title">{entry.title}</span>
              <span class="open-sub">{entry.panels} panels · {entry.shapes} annotations · {entry.updated_at?.slice(0, 10)}</span>
            </div>
          </button>
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
  .tb-btn.active { color: var(--accent); background: var(--accent-soft); }
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
    transition: transform 0.12s var(--ease);
    flex-shrink: 0;
  }
  .color-btn:hover { transform: scale(1.15); }
  .color-btn.active {
    border-color: var(--text-1);
    box-shadow: 0 0 0 2px var(--bg-1), 0 0 0 3.5px var(--text-3);
  }
  .color-pick {
    display: flex;
    align-items: center;
    justify-content: center;
    color: #0b0f17;
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
  .meta-input { width: 100%; font-size: var(--fs-xs); padding: 5px 8px; }
  .meta-input.warn { border-color: color-mix(in srgb, var(--warn, #e8a33d) 55%, transparent); }
  .panel-row {
    padding: 8px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .panel-thumb { position: relative; }
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
    border-radius: 999px;
    font-size: 10px;
    font-weight: 700;
    color: var(--text-1);
    background: rgba(9, 12, 20, 0.72);
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
  .cap-input { font-size: var(--fs-xs); padding: 5px 8px; }
  .panel-actions { display: flex; gap: 2px; }
  .panel-scale {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
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
  .chip-num {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 700;
    color: #0b0f17;
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
