<script>
  /**
   * Where the Horizon tab stands now, on Satellite's map: its eye and, dashed,
   * the cone it looks through, turned to its heading with the map. Dashed
   * because no save has kept it; a saved view stands in the saved work, solid.
   * The cone keeps its size on screen at every zoom, as marks do, and a click
   * on the eye goes back to Horizon.
   */
  import { createSurface } from '../../lib/map/surface.js';
  import { coneMark, HZ } from '../../lib/horizon/marks.js';

  let {
    engine = null,
    /** `uiState.horizonEye`: `{ lat, lon, heading, fov, projection }`, or null. */
    eye = null,
    onopen = () => {},
  } = $props();

  let surface = null;

  $effect(() => {
    if (!engine) return;
    return () => {
      surface?.destroy();
      surface = null;
    };
  });

  $effect(() => {
    const at = eye;
    if (!engine) return;
    surface ??= createSurface(engine);
    if (!at || !Number.isFinite(at.lat) || !Number.isFinite(at.lon)) {
      surface.set([]);
      return;
    }
    const wide = at.projection === 'panorama' ? 360 : at.fov;
    surface.set([
      {
        id: 'cone',
        kind: 'marker',
        at,
        className: 'horizon-eye-cone',
        ...coneMark(wide, { dashed: true }),
        rotation: Number.isFinite(at.heading) ? at.heading : 0,
        keyboard: false,
      },
      {
        id: 'eye',
        kind: 'marker',
        at,
        className: 'horizon-eye-dot',
        html: `<span style="background:${HZ.lens}"></span>`,
        size: [12, 12],
        title: 'Where Horizon stands: click to go back to it',
        onClick: () => onopen(),
      },
    ]);
  });
</script>

<style>
  :global(.horizon-eye-cone) {
    pointer-events: none;
  }
  :global(.horizon-eye-dot) {
    cursor: pointer;
  }
  :global(.horizon-eye-dot > span) {
    display: block;
    width: 100%;
    height: 100%;
    border-radius: 50%;
    box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 1px 4px rgba(0, 0, 0, 0.5);
  }
</style>
