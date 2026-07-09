<script>
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import { api } from '../lib/api.js';
  import { caseState, uiState, ensureCase, reloadCase, toast } from '../lib/state.svelte.js';
  import Icon from '../components/Icon.svelte';
  import Modal from '../components/Modal.svelte';
  import {
    ANNO_COLORS, PAD, CAPTION_H, LEGEND_LINE_H, FOOTER_H,
    BG, TEXT_MAIN, TEXT_DIM, TEXT_FAINT,
    layoutPanels, attributionLine, docSize, toSpec, newId, loadImage,
    featureColors, notesFromShapes,
  } from '../lib/composer.js';

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
  const proof = $state({ title: 'Untitled proof', panels: [], shapes: [], notes: {}, coords: null });
  let savedName = $state(null);
  let dirty = $state(false);
  let tool = $state('select');
  let color = $state(ANNO_COLORS[0]);
  let strokeW = $state(4);
  let selectedId = $state(null);
  let picker = $state(false);
  let pickerItems = $state([]);
  let openList = $state(null); // list of saved proofs, null = closed
  let saving = $state(false);
  let proofFor = $state(undefined);

  // ---- konva ------------------------------------------------------------------
  let containerEl;
  let stage, docLayer, uiLayer, transformer, endHandles;
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
      proof.panels.map((p) => [p.src, p.caption]),
      proof.shapes,
      proof.notes,
      selectedId,
    ]);
    if (stage) rebuild();
  });

  function resetDoc() {
    proof.title = 'Untitled proof';
    proof.panels = [];
    proof.shapes = [];
    proof.notes = {};
    proof.coords = null;
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

  function mediaPanelInput(m) {
    return {
      src: m.path,
      meta: { kind: 'media', source_url: m.source?.webpage_url ?? m.source?.url },
      caption: m.source?.title ?? m.filename,
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
          ...mediaPanelInput(m),
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
      proof.panels.push({
        id: newId('p'),
        src: item.src,
        caption: item.caption ?? '',
        natural: [img.naturalWidth, img.naturalHeight],
        meta: item.meta ?? {},
        img,
      });
      if (item.meta?.lat != null && !proof.coords) {
        proof.coords = { lat: item.meta.lat, lon: item.meta.lon };
      }
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
      if (m) await addPanel(mediaPanelInput(m));
    }
  }

  function movePanel(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= proof.panels.length) return;
    const [panel] = proof.panels.splice(index, 1);
    proof.panels.splice(target, 0, panel);
    dirty = true;
  }

  function removePanel(index) {
    const panel = proof.panels[index];
    proof.shapes = proof.shapes.filter((s) => s.panel !== panel.id);
    proof.panels.splice(index, 1);
    selectedId = null;
    dirty = true;
    requestAnimationFrame(fit);
  }

  // ---- view (zoom / pan / fit) ----------------------------------------------------

  function fit() {
    if (!stage || !containerEl || !containerEl.clientWidth) return;
    const { width, height } = docSize(proof.panels, proof.shapes, proof.notes);
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
    stage.batchDraw();
  }

  // ---- drawing ----------------------------------------------------------------------

  function docPoint() {
    const p = stage.getPointerPosition();
    return { x: (p.x - stage.x()) / stage.scaleX(), y: (p.y - stage.y()) / stage.scaleY() };
  }

  function panelAt(doc) {
    const boxes = layoutPanels(proof.panels);
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
          strokeWidth: strokeW / hit.box.scale, lineCap: 'round', lineJoin: 'round',
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
    const sw = strokeW / hit.box.scale;
    const common = { stroke: color, strokeWidth: sw, listening: false };
    let node;
    if (tool === 'rect') {
      node = new Konva.Rect({ x: hit.nx, y: hit.ny, width: 1, height: 1, cornerRadius: 2, ...common });
    } else if (tool === 'ellipse') {
      node = new Konva.Ellipse({ x: hit.nx, y: hit.ny, radiusX: 1, radiusY: 1, ...common });
    } else {
      node = new Konva.Arrow({
        points: [hit.nx, hit.ny, hit.nx, hit.ny],
        pointerLength: tool === 'arrow' ? 14 / hit.box.scale : 0,
        pointerWidth: tool === 'arrow' ? 14 / hit.box.scale : 0,
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
    const { width, height, legend } = docSize(proof.panels, proof.shapes, proof.notes);
    const boxes = layoutPanels(proof.panels);

    docLayer.add(
      new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: BG })
    );

    proof.panels.forEach((panel, i) => {
      const box = boxes[i];
      const group = new Konva.Group({
        id: `pg-${panel.id}`,
        x: box.x, y: box.y,
        scaleX: box.scale, scaleY: box.scale,
        clip: { x: 0, y: 0, width: panel.natural[0], height: panel.natural[1] },
      });
      if (panel.img) {
        group.add(new Konva.Image({
          image: panel.img, width: panel.natural[0], height: panel.natural[1], listening: false,
        }));
      }
      for (const s of proof.shapes.filter((x) => x.panel === panel.id)) {
        group.add(makeShapeNode(s, box.scale));
      }
      docLayer.add(group);
      if (panel.caption?.trim()) {
        docLayer.add(new Konva.Text({
          x: box.x + 2, y: box.y + box.h + 9,
          width: box.w - 4, text: panel.caption,
          fontSize: 17, fontFamily: 'system-ui, sans-serif',
          fill: TEXT_DIM, ellipsis: true, wrap: 'none', listening: false,
        }));
      }
    });

    // legend (numbered colored chips) + attribution footer
    let y = PAD + (proof.panels.length ? boxes[0].h : 0) + CAPTION_H + 8;
    for (const line of legend.filter((l) => l.text)) {
      docLayer.add(new Konva.Circle({
        x: PAD + 11, y: y + 11, radius: 10, fill: line.color, listening: false,
      }));
      docLayer.add(new Konva.Text({
        x: PAD + 4, y: y + 5, width: 14, align: 'center',
        text: String(line.n), fontSize: 13, fontStyle: 'bold',
        fill: '#0b0f17', listening: false,
      }));
      docLayer.add(new Konva.Text({
        x: PAD + 30, y: y + 3, width: width - PAD * 2 - 30,
        text: line.text, fontSize: 17, fill: TEXT_MAIN,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
      y += LEGEND_LINE_H;
    }
    if (proof.panels.length) {
      docLayer.add(new Konva.Text({
        x: PAD, y: height - FOOTER_H - PAD + 8,
        width: width - PAD * 2,
        text: attributionLine(proof.panels),
        fontSize: 12.5, fill: TEXT_FAINT,
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
    docLayer.batchDraw();
    uiLayer.batchDraw();
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

  function makeShapeNode(s, panelScale) {
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
      node.on('dragend', () => {
        s.x = node.x();
        s.y = node.y();
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
    node.on('dragend', () => {
      if (s.kind === 'rect' || s.kind === 'ellipse') {
        s.x = node.x();
        s.y = node.y();
      } else {
        // arrow / line / curve: fold the drag offset back into every vertex
        const dx = node.x(), dy = node.y();
        s.points = s.points.map((v, i) => (i % 2 === 0 ? v + dx : v + dy));
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
    const { width, height } = docSize(proof.panels, proof.shapes, proof.notes);
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
          coords: proof.coords,
          attribution: attributionLine(proof.panels),
          png: result.png,
          sources: proof.panels.map((p) => p.meta?.source_url).filter(Boolean),
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
    proof.coords = spec.coords ?? null;
    for (const p of spec.panels) {
      try {
        const img = await loadImage(`/files/${caseState.current.id}/${p.src}`);
        proof.panels.push({ ...p, id: p.id ?? newId('p'), img });
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
        <div class="side-title">Panels <span class="count">{proof.panels.length}</span></div>
        {#each proof.panels as panel, i (panel.id)}
          <div class="panel-row card">
            <img src={`/files/${caseState.current?.id}/${panel.src}`} alt="" />
            <input
              class="input cap-input"
              placeholder="Caption…"
              bind:value={panel.caption}
              onchange={() => (dirty = true)}
            />
            <div class="panel-actions">
              <button class="btn btn-ghost btn-sm" disabled={i === 0} title="Move left" onclick={() => movePanel(i, -1)}>←</button>
              <button class="btn btn-ghost btn-sm" disabled={i === proof.panels.length - 1} title="Move right" onclick={() => movePanel(i, 1)}>→</button>
              <button class="btn btn-ghost btn-sm" style="margin-left:auto" title="Remove panel" onclick={() => removePanel(i)}>
                <Icon name="trash" size={13} />
              </button>
            </div>
          </div>
        {/each}

        <!-- Annotations: one legend note per color (feature), not per element -->
        <div class="side-title" style="margin-top: 14px">
          Annotations <span class="count">{featureList.length}</span>
        </div>
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

        <!-- Elements: every drawn shape, for quick select / delete -->
        <div class="side-title" style="margin-top: 14px">
          Elements <span class="count">{proof.shapes.length}</span>
        </div>
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
            <button class="btn btn-ghost btn-sm" title="Delete" onclick={(e) => { e.stopPropagation(); deleteShape(s.id); }}>
              <Icon name="trash" size={13} />
            </button>
          </div>
        {/each}
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
  .count { color: var(--text-3); }
  .panel-row {
    padding: 8px;
    margin-bottom: 8px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .panel-row img {
    width: 100%;
    max-height: 90px;
    object-fit: cover;
    border-radius: var(--r-sm);
    background: var(--bg-2);
  }
  .cap-input { font-size: var(--fs-xs); padding: 5px 8px; }
  .panel-actions { display: flex; gap: 2px; }
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
