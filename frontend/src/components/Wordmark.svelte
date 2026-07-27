<script>
  let { height = 13 } = $props();
</script>

<!-- AZIMUT, drawn rather than set: five of the six letters are pure straight
     lines, so the construction lives here instead of in a licensed font.
     Cap height 100, stroke 15, butt caps and mitre joins. The A's apex is cut
     flat: a mitred point there goes thin and sharp next to the squared-off M,
     U and T. Letter positions carry pair kerning, not uniform spacing — evenly
     spaced, the T's centred stem leaves a hole and it reads "AZIMU T". -->
<svg {height} viewBox="-7.5 -7.5 503.3 115" aria-label="Azimut">
  <g
    fill="none"
    stroke="var(--brand-ink, #e3e3e3)"
    stroke-width="15"
    stroke-linecap="butt"
    stroke-linejoin="miter"
  >
    <path d="M0 100 25 0h13.3l25 100" />
    <path d="M13 69h37.3" />
    <path transform="translate(96.3 0)" d="M0 7.5h58L0 92.5h58" />
    <path transform="translate(193.3 0)" d="M0 0v100" />
    <path transform="translate(232.3 0)" d="M0 100V0l38 58 38-58v100" />
    <path transform="translate(347.3 0)" d="M0 0v69a31 31 0 0 0 62 0V0" />
    <path transform="translate(430.3 0)" d="M0 7.5h58M29 7.5V100" />
  </g>
</svg>

<style>
  svg {
    display: inline-block;
  }
</style>
