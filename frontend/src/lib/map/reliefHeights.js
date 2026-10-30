/**
 * The relief's heights read in the browser, from the tiles the app serves
 * (`/api/terrain/tiles`): what a plate's contour lines and summits are drawn
 * from (`lib/plate/heights.js`).
 */
import { terrarium } from '../horizon/mesh/geo.js';

/**
 * The heights of one relief tile in the browser: the image the app serves,
 * decoded without any colour conversion, which would change the heights.
 *
 * @param {string} template `/api/terrain/tiles/{z}/{x}/{y}`
 */
export function browserHeights(template) {
  return async (z, x, y) => {
    const url = template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
    const response = await fetch(url);
    if (!response.ok) return null;
    const bitmap = await createImageBitmap(await response.blob(), {
      colorSpaceConversion: 'none',
      premultiplyAlpha: 'none',
    });
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    return terrarium(data, canvas.width * canvas.height);
  };
}
