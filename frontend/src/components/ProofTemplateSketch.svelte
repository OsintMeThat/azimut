<script>
  /**
   * A proof template drawn small, for its row in Settings › Templates: the page in
   * its colour and proportions, the two sample pictures where the layout puts them,
   * the captions and the footer as lines of ink, and the signature in its corner.
   * Measured with the composer's own layout, and drawn as plain shapes, so a list
   * of fifty costs no canvas and no picture.
   */
  import { docSize, footerLines, layoutPanels, normalizeProofStyle, normSpace, textColors } from '../lib/composer.js';
  import { sampleProof } from '../lib/proofSample.js';
  import { AMBER } from '../lib/brandMark.js';

  let { data, width = 52, height = 36 } = $props();

  const look = $derived(normalizeProofStyle(data));
  const proof = $derived(sampleProof(look, { legend: false }));
  const printed = $derived(proof.footerEnabled !== false ? footerLines(proof) : []);
  const page = $derived(docSize(
    proof.panels, proof.shapes, proof.notes,
    { captionSize: proof.captionSize, legendSize: proof.legendSize, footerSize: proof.footerSize,
      footerEnabled: proof.footerEnabled !== false, footerLines: printed.length },
    proof.legendOrder, proof.layout, proof.space,
  ));
  const boxes = $derived(layoutPanels(proof.panels, proof.captionSize, proof.layout, proof.space));
  const ink = $derived(textColors(proof.bg));
  const pad = $derived(normSpace(proof.space).pad);
  const corner = (anchor, w, h) => {
    const m = Math.max(pad, 20);
    return { x: anchor?.endsWith('l') ? m : page.width - m - w, y: anchor?.startsWith('t') ? m : page.height - m - h };
  };
  const PICTURES = ['#9a9893', '#56704f'];
</script>

<svg class="pts-sketch" viewBox="0 0 {page.width} {page.height}" {width} {height} aria-hidden="true">
  <rect width={page.width} height={page.height} fill={proof.bg} stroke="var(--border)" stroke-width="1" vector-effect="non-scaling-stroke" />
  {#each boxes as box, i (i)}
    <rect x={box.x} y={box.y} width={box.w} height={box.h} fill={PICTURES[i]} />
    {#if proof.panels[i].caption}
      <rect x={box.x + 2} y={box.y + box.h + 10} width={box.w * 0.55} height={Math.max(8, proof.captionSize * 0.55)}
        rx="3" fill={proof.captionColor || ink.dim} opacity="0.8" />
    {/if}
  {/each}
  {#each printed as line, i (i)}
    {@const size = proof.footerSize}
    {@const w = (page.width - pad * 2) * (i === printed.length - 1 ? 0.42 : 0.3)}
    <rect x={proof.footerAlign === 'right' ? page.width - pad - w : pad}
      y={page.height - pad - (size + 12) * (printed.length - i) + 6} width={w} height={Math.max(8, size * 0.6)}
      rx="3" fill={proof.footerColor || ink.faint} opacity="0.85" />
  {/each}
  {#if proof.signatureText}
    {@const at = corner(proof.signatureText.anchor, proof.signatureText.size * 4, proof.signatureText.size)}
    <rect x={at.x} y={at.y} width={proof.signatureText.size * 4} height={proof.signatureText.size * 0.7}
      rx="3" fill={proof.signatureText.color ?? '#ffffff'} opacity="0.9" />
  {/if}
  {#if proof.signature}
    {@const side = Math.min(page.width, page.height) * (proof.signature.scale ?? 0.08)}
    {@const at = corner(proof.signature.anchor, side, side + (proof.signatureText?.anchor === proof.signature.anchor ? proof.signatureText.size * 1.6 : 0))}
    <circle cx={at.x + side / 2} cy={at.y + side / 2} r={side / 2} fill={ink.faint} opacity="0.9" />
  {/if}
  {#if proof.azimutMark}
    {@const size = proof.azimutMark.size * 1.6}
    {@const show = proof.azimutMark.show}
    {@const arrow = show !== 'name' ? size * 0.52 : 0}
    {@const word = show !== 'logo' ? size * 2.2 : 0}
    {@const at = corner(proof.azimutMark.anchor, arrow + word + (arrow && word ? size * 0.2 : 0), size)}
    {#if arrow}
      <path d="M{at.x + size * 0.26} {at.y} L{at.x + size * 0.52} {at.y + size} L{at.x + size * 0.26} {at.y + size * 0.78} Z" fill={AMBER} />
      <path d="M{at.x + size * 0.26} {at.y} L{at.x} {at.y + size} L{at.x + size * 0.26} {at.y + size * 0.78} Z" fill={ink.main} />
    {/if}
    {#if word}
      <rect x={at.x + arrow + (arrow ? size * 0.2 : 0)} y={at.y + size * 0.3} width={word} height={size * 0.4} rx="2" fill={ink.main} />
    {/if}
  {/if}
</svg>

<style>
  .pts-sketch {
    display: block;
    flex-shrink: 0;
  }
</style>
