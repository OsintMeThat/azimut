<script>
  let { size = 32 } = $props();
</script>

<!-- The brand mark: a cartographic north arrow, split on the north–south axis
     with ink to the west and amber to the east. The split is the convention
     map north arrows have always used, which is why it carries the colour.
     The west flank goes through --brand-ink so it stays legible on both
     themes; the amber tracks --accent, which app.css pins across themes.
     The same two paths are in public/favicon.svg and are redrawn by
     packaging/icons/render_icons.py — move all three together. -->
<svg width={size} height={size} viewBox="0 0 24 24" aria-label="Azimut logo">
  <path fill="var(--brand-ink, #e3e3e3)" d="M12 1.8 5.8 21.4 12 16.4Z" />
  <path fill="#e8a33d" d="M12 1.8 18.2 21.4 12 16.4Z" />
</svg>

<style>
  svg {
    display: inline-block;
  }
</style>
