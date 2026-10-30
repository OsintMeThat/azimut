/**
 * A picture kept inside a plate (a logo, a paper's picture), made small enough to
 * travel with it: at most `edge` pixels on its long side, and under the bound the
 * backend sets on one (`engine/mapplates.MAX_PICTURE_CHARS`), stepping down until
 * it fits. A PNG stays a PNG, so a logo keeps its see-through ground.
 */
export const MAX_PICTURE_CHARS = 280_000;

function load(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const picture = new Image();
    picture.onload = () => { URL.revokeObjectURL(url); resolve(picture); };
    picture.onerror = () => { URL.revokeObjectURL(url); reject(new Error('That file is not a picture this browser can read')); };
    picture.src = url;
  });
}

export async function shrinkPicture(file, { edge = 1400, limit = MAX_PICTURE_CHARS } = {}) {
  if (!/^image\/(png|jpeg|webp)$/.test(file?.type ?? '')) throw new Error('Pick a PNG, a JPEG or a WebP picture');
  const picture = await load(file);
  const type = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
  let side = Math.min(edge, Math.max(picture.naturalWidth, picture.naturalHeight));
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const scale = side / Math.max(picture.naturalWidth, picture.naturalHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(picture.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(picture.naturalHeight * scale));
    canvas.getContext('2d')?.drawImage(picture, 0, 0, canvas.width, canvas.height);
    const data = canvas.toDataURL(type, 0.86);
    if (data.length <= limit) return data;
    side = Math.round(side * 0.75);
  }
  throw new Error('That picture stays too large to keep in a plate');
}
