/**
 * The page guide/hero.mjs films: Satellite's globe (lib/globe) on a canvas of its own,
 * with the few things the film needs of it. A frame is handed back only once every
 * tile the view wants is drawn, so no ground ever arrives in patches on screen.
 */
import { createGlobe } from '/src/lib/globe/globe.js';

const globe = createGlobe(document.getElementById('globe'));

/** The view drawn in `imagery`, once it is complete. */
async function drawn(imagery, timeout) {
  globe.setImagery(imagery);
  return globe.snapshot({ timeout });
}

window.hero = {
  ready: Boolean(globe),
  place: (camera) => globe.setCamera(camera),
  /**
   * One frame as a PNG. `share` of the way from `under` to `over`: both drawn at the
   * same camera and laid one over the other, so one imagery dissolves into the next.
   */
  async frame({ under, over, share }, timeout) {
    const first = await drawn(share < 1 ? under : over, timeout);
    if (share <= 0 || share >= 1) return { png: first.canvas.toDataURL('image/png'), complete: first.complete };
    const second = await drawn(over, timeout);
    const out = document.createElement('canvas');
    out.width = first.canvas.width;
    out.height = first.canvas.height;
    const ctx = out.getContext('2d');
    ctx.drawImage(first.canvas, 0, 0);
    ctx.globalAlpha = share;
    ctx.drawImage(second.canvas, 0, 0);
    return { png: out.toDataURL('image/png'), complete: first.complete && second.complete };
  },
};
