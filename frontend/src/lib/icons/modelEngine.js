/**
 * The heavy half of the icon library, as one chunk: the model geometry, the solver
 * and the painter. Everything else reaches it through `loadModels.svelte.js`, so the
 * app's first load carries none of it.
 */
export { MODEL_IDS, modelById } from './models.js';
export { drawModel, drawnBox, modelSvg } from './paint.js';
