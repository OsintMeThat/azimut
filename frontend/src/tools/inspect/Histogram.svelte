<script>
  import { histogram } from '../../lib/inspectPlayer.js';
  import { INSPECT_HELP } from '../../lib/inspectHelp.js';

  // The picture's tones as it reads on screen, redrawn as the sliders move: the
  // image at `url`, or the video's current frame, through the same CSS `filter`
  // the viewer applies and inside the crop. It is worked out from a copy a couple
  // of hundred pixels wide, which is plenty for a histogram and costs nothing.
  //
  // `tick` changes when the video shows a new frame.
  let { url = null, video = null, filter = '', crop = null, tick = 0 } = $props();

  const SIDE = 200;
  const H = 72;

  let canvas = $state();
  let clipped = $state(null); // { black, white } shares of the pixels
  let image = null;
  let imageUrl = null;
  let timer = null;
  let last = 0;

  function load(src) {
    if (image && imageUrl === src) return Promise.resolve(image);
    return new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => {
        image = im;
        imageUrl = src;
        resolve(im);
      };
      im.onerror = reject;
      im.src = src;
    });
  }

  async function compute() {
    const off = document.createElement('canvas');
    const ctx = off.getContext?.('2d', { willReadFrequently: true });
    if (!ctx || !canvas) return;
    let el;
    let sw;
    let sh;
    if (video) {
      el = video;
      sw = video.videoWidth;
      sh = video.videoHeight;
    } else if (url) {
      try {
        el = await load(url);
      } catch {
        return;
      }
      sw = el.naturalWidth;
      sh = el.naturalHeight;
    }
    if (!el || !sw || !sh) return;
    const sx = crop ? crop.x * sw : 0;
    const sy = crop ? crop.y * sh : 0;
    const cw = crop ? crop.w * sw : sw;
    const ch = crop ? crop.h * sh : sh;
    const scale = Math.min(1, SIDE / Math.max(cw, ch));
    off.width = Math.max(1, Math.round(cw * scale));
    off.height = Math.max(1, Math.round(ch * scale));
    ctx.filter = filter || 'none';
    try {
      ctx.drawImage(el, sx, sy, cw, ch, 0, 0, off.width, off.height);
      draw(histogram(ctx.getImageData(0, 0, off.width, off.height).data), off.width * off.height);
    } catch {
      /* a frame not decoded yet: the next one draws it */
    }
  }

  function draw(h, total) {
    const ctx = canvas.getContext?.('2d');
    if (!ctx) return;
    const ratio = window.devicePixelRatio || 1;
    const W = canvas.clientWidth || 280;
    canvas.width = W * ratio;
    canvas.height = H * ratio;
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // A pile of pure black or white would flatten everything else, so the scale
    // is set by the tones between and the ends are allowed to run off the top.
    let peak = 1;
    for (const channel of [h.r, h.g, h.b]) for (let i = 1; i < 255; i += 1) peak = Math.max(peak, channel[i]);
    ctx.globalCompositeOperation = 'lighter';
    for (const [channel, color] of [[h.r, 'rgba(230,70,70,0.75)'], [h.g, 'rgba(70,210,110,0.75)'], [h.b, 'rgba(90,140,240,0.75)']]) {
      ctx.beginPath();
      ctx.moveTo(0, H);
      channel.forEach((v, i) => ctx.lineTo((i / 255) * W, H - Math.min(1, v / peak) * H));
      ctx.lineTo(W, H);
      ctx.fillStyle = color;
      ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    clipped = { black: h.l[0] / total, white: h.l[255] / total };
  }

  // Slider drags and playback both ask far more often than a histogram needs.
  function schedule() {
    clearTimeout(timer);
    const wait = Math.max(0, (video ? 200 : 60) - (Date.now() - last));
    timer = setTimeout(() => {
      last = Date.now();
      compute();
    }, wait);
  }

  $effect(() => {
    void url; void video; void filter; void crop?.x; void crop?.y; void crop?.w; void crop?.h; void tick;
    if (canvas) schedule();
  });

  $effect(() => () => clearTimeout(timer));

  const pct = (share) => (share >= 0.001 ? `${(share * 100).toFixed(share < 0.1 ? 1 : 0)}%` : '');
</script>

<div class="hist" title={INSPECT_HELP.histogram}>
  <canvas bind:this={canvas} style:height={`${H}px`} aria-label="Histogram"></canvas>
  {#if clipped && (pct(clipped.black) || pct(clipped.white))}
    <p class="clip">
      {#if pct(clipped.black)}<span>{pct(clipped.black)} pure black</span>{/if}
      {#if pct(clipped.white)}<span>{pct(clipped.white)} pure white</span>{/if}
    </p>
  {/if}
</div>

<style>
  .hist {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  canvas {
    width: 100%;
    background: var(--bg-0);
    border-radius: var(--r-sm);
  }
  .clip {
    display: flex;
    gap: 10px;
    margin: 0;
    font-size: var(--fs-xs);
    color: var(--text-3);
  }
</style>
