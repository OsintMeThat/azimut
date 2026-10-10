/**
 * The colours the Horizon tab marks its map with. The view reads the same
 * values as `--hz-*` custom properties (tools/Horizon.svelte), which a map's
 * shapes cannot; a test keeps the two in step.
 *
 * Amber is the lens (the eye, its cone, the strip's bracket, the caret), as
 * it is the selection everywhere else; the marked point says in sight or
 * hidden in green or red, grey while the app is still working it out; the
 * ground clicked in the view is a yellow crosshair.
 */
export const HZ = {
  lens: '#e8a33d',
  mark: '#ffd740',
  seen: '#69f0ae',
  hidden: '#ff5252',
  pending: '#c8c8c8',
};

/** How far a view's cone reaches on a map, in screen pixels, whatever the zoom. */
export const CONE_PX = 44;

/**
 * A viewpoint's cone as a map mark: the eye at the middle of a square, the
 * lens opening upward, so the map turns it to the view's heading
 * (`rotation`). Kept the same size on screen at every zoom, as marks are, so
 * a view far out still says which way it looked; the ground it took in is a
 * shape of its own. A whole turn is a ring. `dashed` draws the Horizon tab's
 * eye as it stands now, which no save has kept yet.
 *
 * @returns {{ html: string, size: [number, number] }}
 */
export function coneMark(fov, { radius = CONE_PX, dashed = false, colour = HZ.lens } = {}) {
  const side = radius * 2;
  const half = Math.min(180, Math.max(1, Number(fov) || 60) / 2);
  const dash = dashed ? ' stroke-dasharray="4 3"' : '';
  const fill = dashed ? 'none' : colour;
  const opacity = dashed ? 0 : 0.22;
  let outline;
  if (half >= 180) {
    outline = `<circle cx="${radius}" cy="${radius}" r="${radius - 1}"`;
  } else {
    const at = (deg) => {
      const rad = (deg * Math.PI) / 180;
      return `${round(radius + (radius - 1) * Math.sin(rad))} ${round(radius - (radius - 1) * Math.cos(rad))}`;
    };
    const large = half > 90 ? 1 : 0;
    outline = `<path d="M${radius} ${radius}L${at(-half)}A${radius - 1} ${radius - 1} 0 ${large} 1 ${at(half)}Z" stroke-linejoin="round"`;
  }
  // a dark rim under the amber, so the cone reads over snow and over shadow alike
  const rim = `${outline} fill="none" stroke="rgba(0,0,0,0.55)" stroke-width="3"${dash}/>`;
  const shape = `${outline} fill="${fill}" fill-opacity="${opacity}" stroke="${colour}" stroke-width="1.5"${dash}/>`;
  return {
    html: `<svg width="${side}" height="${side}" viewBox="0 0 ${side} ${side}" aria-hidden="true">${rim}${shape}</svg>`,
    size: [side, side],
  };
}

const round = (value) => Math.round(value * 100) / 100;
