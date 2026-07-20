<script>
  /**
   * A faithful, interactive miniature of a proof drawn from a style template,
   * with two average-screenshot stand-ins. It reuses the composer's real layout
   * maths so the footer and signatures show at their true size *relative to
   * the panels* — impossible to judge from number fields. The real signature
   * logo is loaded; if none is saved the box says to add one in Settings. Click
   * the logo or the @handle to select it, then drag to move or pull a corner to
   * resize — the change is written back into the template.
   *
   * `style` is the template's style blob (bindable). `logoMissing` is set true
   * when the signature is on but no logo file exists.
   */
  import { onMount } from 'svelte';
  import Konva from 'konva';
  import {
    layoutPanels, docSize, footerBand,
    signatureBox, signatureOffset, signaturePairPositions, anchoredPos, anchoredOffset,
    normalizeProofStyle, textColors, attributionLine, loadImage,
    BG, CAPTION_SIZE, FOOTER_SIZE, SIG_SCALE, SIG_TEXT_SIZE,
  } from '../lib/composer.js';
  import { prefs } from '../lib/state.svelte.js';

  let { style = $bindable(), logoMissing = $bindable(false) } = $props();

  // Equal-size stand-ins make spacing, orientation and signature scale easy to
  // compare without one panel's aspect ratio distorting the preview.
  const FAKE_PANELS = [
    { id: 'a', natural: [1600, 900], row: 0, caption: 'Ground photo' },
    { id: 'b', natural: [1600, 900], row: 0, caption: 'Satellite' },
  ];

  let host = $state(null);
  let cw = $state(340);
  let stage;
  let layer;
  let sigImg = null; // the real logo, loaded once; null → none saved
  let selected = null; // 'logo' | 'text' | null — what the transformer holds

  // The logo's true aspect, from the loaded file (fallback keeps the box sane).
  function logoAspect() {
    return sigImg ? [sigImg.naturalWidth, sigImg.naturalHeight] : [220, 88];
  }

  // Panels honour the template's caption default: off → no captions (and, the
  // band collapsing with them, no empty strip under the panels).
  function panels(safeStyle) {
    const withCaptions = safeStyle.captionsEnabled;
    const vertical = safeStyle.panelDirection === 'vertical';
    return FAKE_PANELS.map((p, i) => ({
      ...p,
      row: vertical ? i : 0,
      caption: withCaptions ? p.caption : '',
    }));
  }

  function render() {
    if (!stage || !cw) return;
    layer.destroyChildren();
    const safeStyle = normalizeProofStyle(style);
    const space = safeStyle.space;
    const bg = safeStyle.bg ?? BG;
    const tc = textColors(bg);
    const text = {
      captionSize: safeStyle.captionSize ?? CAPTION_SIZE,
      footerSize: safeStyle.footerSize ?? FOOTER_SIZE,
      footerEnabled: safeStyle.footerEnabled,
    };
    const pnls = panels(safeStyle);
    const { width, height } = docSize(pnls, [], {}, text, [], 'grid', space);
    const boxes = layoutPanels(pnls, text.captionSize, 'grid', space);
    const scale = cw / width;
    stage.size({ width: Math.round(width * scale), height: Math.round(height * scale) });
    stage.scale({ x: scale, y: scale });

    layer.add(new Konva.Rect({ name: 'bg', x: 0, y: 0, width, height, fill: bg }));

    boxes.forEach((box, i) => {
      layer.add(new Konva.Rect({
        x: box.x, y: box.y, width: box.w, height: box.h, name: 'bg',
        fillLinearGradientStartPoint: { x: 0, y: 0 },
        fillLinearGradientEndPoint: { x: box.w, y: box.h },
        fillLinearGradientColorStops: [0, '#3b4a63', 1, '#1e2637'],
        cornerRadius: 4,
      }));
      layer.add(new Konva.Text({
        x: box.x, y: box.y + box.h / 2 - box.h * 0.05, width: box.w, align: 'center',
        text: `${pnls[i].natural[0]} × ${pnls[i].natural[1]} px`,
        fontSize: box.h * 0.065, fill: 'rgba(255,255,255,0.55)',
        fontFamily: 'system-ui, sans-serif', listening: false,
      }));
      const cap = pnls[i].caption;
      if (cap?.trim()) {
        layer.add(new Konva.Text({
          x: box.x + 2, y: box.y + box.h + 9, width: box.w - 4, text: cap,
          fontSize: text.captionSize, fill: tc.dim,
          fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
        }));
      }
    });

    // footer
    if (text.footerEnabled) {
      const fs = text.footerSize;
      layer.add(new Konva.Text({
        x: space.pad, y: height - space.pad - footerBand(fs) + Math.round((footerBand(fs) - fs) / 2),
        width: width - space.pad * 2, text: safeStyle.footer?.trim() || attributionLine(pnls),
        align: safeStyle.footerAlign === 'right' ? 'right' : 'left',
        fontSize: fs, fill: safeStyle.footerColor || tc.faint,
        fontFamily: 'system-ui, sans-serif', ellipsis: true, wrap: 'none', listening: false,
      }));
    }

    let logoNode = null;
    let textNode = null;
    const st = safeStyle.signatureText && prefs.signatureHandle?.trim() ? safeStyle.signatureText : null;
    const pendingTextNode = st ? new Konva.Text({
      text: prefs.signatureHandle.trim(), fontSize: st.size ?? SIG_TEXT_SIZE, fontStyle: 'bold',
      fontFamily: 'system-ui, sans-serif', fill: st.color ?? '#ffffff',
      opacity: st.opacity ?? 1, draggable: true,
    }) : null;
    const baseLogoBox = safeStyle.signature
      ? signatureBox(safeStyle.signature, width, height, logoAspect())
      : null;
    const pair = pendingTextNode
      ? signaturePairPositions(
          safeStyle.signature, st, width, height, baseLogoBox,
          pendingTextNode.width(), pendingTextNode.height(),
        )
      : null;

    // logo — the real file at its true signatureBox size, or an "add one" prompt
    if (safeStyle.signature) {
      const box = pair?.logo ?? baseLogoBox;
      const g = new Konva.Group({ x: box.x, y: box.y, opacity: safeStyle.signature.opacity, draggable: true });
      if (sigImg) {
        g.add(new Konva.Image({ image: sigImg, width: box.w, height: box.h }));
      } else {
        g.add(new Konva.Rect({
          width: box.w, height: box.h, cornerRadius: 6,
          fill: 'rgba(255,255,255,0.9)', stroke: 'rgba(0,0,0,0.25)', strokeWidth: 1,
        }));
        g.add(new Konva.Text({
          width: box.w, height: box.h, padding: box.h * 0.12, align: 'center', verticalAlign: 'middle',
          text: 'Add a logo in\nSettings → Preferences', fontSize: box.h * 0.16, fill: '#111',
          fontFamily: 'system-ui, sans-serif',
        }));
      }
      g.on('click tap', () => selectEl('logo'));
      g.on('dragend', () => {
        const placement = signatureOffset(safeStyle.signature, width, height, logoAspect(), g.x(), g.y());
        style.signature = { ...safeStyle.signature, ...placement };
      });
      g.on('transformend', () => {
        const scale = (safeStyle.signature.scale ?? SIG_SCALE) * g.scaleX();
        style.signature = { ...safeStyle.signature, scale: Math.max(0.03, Math.min(0.6, scale)) };
      });
      layer.add(g);
      logoNode = g;
    }

    // Text handle — its value is app-wide in Settings, while the template
    // supplies only the opt-in slot and its placement.
    if (st && pendingTextNode) {
      const node = pendingTextNode;
      const tw = node.width();
      const th = node.height();
      node.position(pair?.handle ?? anchoredPos(st, width, height, tw, th));
      node.on('click tap', () => selectEl('text'));
      node.on('dragend', () => {
        const placement = anchoredOffset(st, width, height, tw, th, node.x(), node.y());
        style.signatureText = { ...st, ...placement };
      });
      node.on('transformend', () => {
        const size = Math.round((st.size ?? SIG_TEXT_SIZE) * node.scaleX());
        style.signatureText = { ...st, size: Math.max(12, Math.min(300, size)) };
      });
      layer.add(node);
      textNode = node;
    }

    // transformer on the selected element — corner resize, no rotation
    const picked = selected === 'logo' ? logoNode : selected === 'text' ? textNode : null;
    if (picked) {
      const tr = new Konva.Transformer({
        rotateEnabled: false, keepRatio: true, ignoreStroke: true,
        enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        anchorSize: 9, borderStroke: '#4c9ffe', anchorStroke: '#4c9ffe',
      });
      layer.add(tr);
      tr.nodes([picked]);
    }

    layer.draw();
  }

  function selectEl(which) {
    selected = which;
    render();
  }

  onMount(() => {
    stage = new Konva.Stage({ container: host, width: cw, height: 120 });
    layer = new Konva.Layer();
    stage.add(layer);
    // click empty space (a background rect or the stage) to deselect
    stage.on('click tap', (e) => {
      if (e.target === stage || e.target.name() === 'bg') {
        if (selected) { selected = null; render(); }
      }
    });
    const ro = new ResizeObserver(() => {
      const w = host?.clientWidth;
      if (w && Math.abs(w - cw) > 1) cw = w;
    });
    if (host) {
      cw = host.clientWidth || cw;
      ro.observe(host);
    }
    // load the real signature once; a missing file flips logoMissing for the editor
    loadImage('/api/settings/signature.png')
      .then((img) => { sigImg = img; logoMissing = false; render(); })
      .catch(() => { sigImg = null; logoMissing = true; render(); });
    render();
    return () => {
      ro.disconnect();
      stage?.destroy();
    };
  });

  // Re-render whenever the template style or the container width changes.
  $effect(() => {
    JSON.stringify([
      style.bg, style.space, style.captionSize, style.footerSize,
      style.footer, style.footerEnabled, style.footerColor, style.footerAlign, style.captionsEnabled,
      style.panelDirection,
      style.signature, style.signatureText,
    ]);
    prefs.signatureHandle;
    cw;
    if (stage) render();
  });
</script>

<div class="preview-frame">
  <div class="hint">Drag the logo or account handle to move or resize it; mock panels show their source dimensions.</div>
  <div class="canvas" bind:this={host}></div>
</div>

<style>
  .preview-frame {
    position: sticky;
    top: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .hint { font-size: 11px; color: var(--text-3); line-height: 1.3; }
  .canvas {
    border: 1px solid var(--border);
    border-radius: 8px;
    overflow: hidden;
    background: var(--bg-2);
    line-height: 0;
  }
</style>
