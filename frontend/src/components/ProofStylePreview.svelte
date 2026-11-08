<script module>
  import Konva from 'konva';
  import { loadImage, normalizeProofStyle } from '../lib/composer.js';
  import { drawPage } from '../lib/proofPage.js';
  import { SAMPLE_SCENE, loadSamplePictures, sampleProof } from '../lib/proofSample.js';
  import { sceneBadges } from '../lib/proofScene.js';
  import { prefs } from '../lib/state.svelte.js';
  import { loadProofFont } from '../lib/proofFonts.js';
  import '../lib/proofFontFaces.js';

  // The sample pictures are read once a session, and only when a template is shown.
  let pictures = null;
  export function samplePictures() {
    pictures ??= loadSamplePictures(loadImage).catch(() => null);
    return pictures;
  }
  /** The analyst's logo as it stands now, or null: one added since the last look shows. */
  export function signatureLogo() {
    return loadImage('/api/settings/signature.png').catch(() => null);
  }
  /**
   * A template drawn still on the sample, `width` pixels wide: the card of a start.
   * Built off screen and let go once it is a picture, a JPEG since a page is opaque.
   */
  export async function stillOf(style, { width = 320, legend = true, logo = null } = {}) {
    const pics = await samplePictures();
    const proof = sampleProof(normalizeProofStyle(style), { pictures: pics, legend });
    await loadProofFont(proof.font);
    const stage = new Konva.Stage({ container: document.createElement('div'), width: 1, height: 1 });
    const layer = new Konva.Layer();
    stage.add(layer);
    const badges = sceneBadges(proof.sceneBadge, SAMPLE_SCENE.frames, SAMPLE_SCENE.star, SAMPLE_SCENE.moments);
    const page = drawPage(Konva, layer, proof, {
      logo, handle: prefs.signatureHandle ?? '', coordFormat: prefs.coordFormat, badges,
    });
    const scale = width / page.width;
    stage.size({ width: Math.round(page.width * scale), height: Math.round(page.height * scale) });
    stage.scale({ x: scale, y: scale });
    layer.draw();
    const url = stage.toDataURL({ mimeType: 'image/jpeg', quality: 0.86, pixelRatio: Math.min(2, window.devicePixelRatio || 1) });
    stage.destroy();
    return { url, aspect: page.width / page.height };
  }
</script>

<script>
  /**
   * A template laid on the sample proof and drawn as the composer draws a page
   * (`lib/proofPage.js`): the pictures, their captions and marks, the legend, the
   * footer, the logo, the handle and the Azimut mark, at their true size against
   * the page. The page is fitted whole into the room it is given.
   *
   * With `interactive`, the logo and the handle are dragged into place and resized
   * from their corners, and the new placement is written back into `style`.
   *
   * `logoMissing` turns true when the style signs with a logo and none is saved.
   */
  import { onMount } from 'svelte';
  import { SIG_SCALE, SIG_TEXT_SIZE, anchoredOffset, signatureOffset } from '../lib/composer.js';
  import { closeStrandedGesture } from '../lib/konvaGesture.js';

  let {
    style = $bindable(),
    legend = true,
    interactive = false,
    logoMissing = $bindable(false),
    label = 'Sample proof',
  } = $props();

  let host = $state(null);
  let room = $state({ w: 0, h: 0 });
  let loaded = $state(null); // { pictures, logo } once read
  let selected = null; // 'logo' | 'text' | null, what the transformer holds
  let stage;
  let layer;

  function render() {
    if (!stage || !room.w) return;
    layer.destroyChildren();
    const proof = sampleProof(normalizeProofStyle(style), { pictures: loaded?.pictures, legend });
    const badges = sceneBadges(proof.sceneBadge, SAMPLE_SCENE.frames, SAMPLE_SCENE.star, SAMPLE_SCENE.moments);
    const page = drawPage(Konva, layer, proof, {
      logo: loaded?.logo ?? null, handle: prefs.signatureHandle ?? '', coordFormat: prefs.coordFormat, badges,
    });
    const scale = Math.min(room.w / page.width, (room.h || Infinity) / page.height);
    stage.size({ width: Math.max(1, Math.round(page.width * scale)), height: Math.max(1, Math.round(page.height * scale)) });
    stage.scale({ x: scale, y: scale });
    if (interactive) wire(page, proof);
    layer.draw();
  }

  /** The logo and the handle, draggable and resizable, their placement written back. */
  function wire(page, proof) {
    const { width, height } = page;
    if (page.logo) {
      const node = page.logo;
      node.draggable(true);
      node.on('click tap', () => pick('logo'));
      node.on('dragend', () => {
        style.signature = { ...proof.signature, ...signatureOffset(proof.signature, width, height, page.logoNatural, node.x(), node.y()) };
      });
      node.on('transformend', () => {
        const scale = (proof.signature.scale ?? SIG_SCALE) * node.scaleX();
        style.signature = { ...proof.signature, scale: Math.max(0.03, Math.min(0.6, scale)) };
      });
    }
    if (page.handle) {
      const node = page.handle;
      const st = proof.signatureText;
      const [tw, th] = [node.width(), node.height()];
      node.draggable(true);
      node.on('click tap', () => pick('text'));
      node.on('dragend', () => {
        style.signatureText = { ...st, ...anchoredOffset(st, width, height, tw, th, node.x(), node.y()) };
      });
      node.on('transformend', () => {
        const size = Math.round((st.size ?? SIG_TEXT_SIZE) * node.scaleX());
        style.signatureText = { ...st, size: Math.max(12, Math.min(300, size)) };
      });
    }
    const held = selected === 'logo' ? page.logo : selected === 'text' ? page.handle : null;
    if (held) {
      const transformer = new Konva.Transformer({
        rotateEnabled: false, keepRatio: true, ignoreStroke: true,
        enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
        anchorSize: 9, borderStroke: '#4c9ffe', anchorStroke: '#4c9ffe',
      });
      layer.add(transformer);
      transformer.nodes([held]);
    }
  }

  function pick(which) {
    selected = which;
    render();
  }

  onMount(() => {
    stage = new Konva.Stage({ container: host, width: 1, height: 1 });
    layer = new Konva.Layer();
    stage.add(layer);
    stage.on('click tap', (event) => {
      if ((event.target === stage || event.target.name() === 'bg') && selected) {
        selected = null;
        render();
      }
    });
    const measure = () => {
      const box = host?.parentElement?.getBoundingClientRect();
      if (box && (Math.abs(box.width - room.w) > 1 || Math.abs(box.height - room.h) > 1)) {
        room = { w: box.width, h: box.height };
      }
    };
    const observer = new ResizeObserver(measure);
    if (host?.parentElement) observer.observe(host.parentElement);
    measure();
    // A release the page never sees leaves Konva resizing the signature under a bare
    // pointer, and the size it settles on never reaches the template. Each render
    // builds a new transformer, so the live one is read when the gesture is closed.
    const closeStranded = () => {
      if (!stage) return;
      closeStrandedGesture({ transformer: layer.findOne('Transformer'), stage, isDragging: () => Konva.isDragging() });
    };
    const settle = () => requestAnimationFrame(closeStranded);
    window.addEventListener('pointerup', settle, true);
    window.addEventListener('pointercancel', settle, true);
    window.addEventListener('blur', settle);
    let alive = true;
    Promise.all([samplePictures(), signatureLogo()]).then(([pics, sig]) => {
      if (alive) loaded = { pictures: pics, logo: sig };
    });
    return () => {
      alive = false;
      observer.disconnect();
      window.removeEventListener('pointerup', settle, true);
      window.removeEventListener('pointercancel', settle, true);
      window.removeEventListener('blur', settle);
      stage?.destroy();
      stage = null;
    };
  });

  $effect(() => {
    logoMissing = Boolean(loaded) && !loaded.logo && Boolean(style?.signature);
  });

  // Drawn again whenever the style, the room, the pictures or the handle change.
  $effect(() => {
    JSON.stringify(style);
    void [legend, room.w, room.h, loaded, prefs.signatureHandle, prefs.coordFormat];
    if (stage) render();
  });

  // A canvas measures with the face it has, so the page is drawn again once it is in.
  $effect(() => {
    const face = style?.font;
    loadProofFont(face).then(() => { if (stage && face === style?.font) render(); });
  });
</script>

<div class="psp" role={interactive ? 'group' : 'img'} aria-label={label}>
  <div class="psp-page" class:ready={Boolean(loaded)} bind:this={host}></div>
</div>

<style>
  .psp {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
  }
  .psp-page {
    line-height: 0;
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.25), 0 10px 30px rgba(0, 0, 0, 0.28);
    border-radius: 2px;
    overflow: hidden;
    opacity: 0;
    transition: opacity 0.18s var(--ease, ease);
  }
  .psp-page.ready { opacity: 1; }
</style>
