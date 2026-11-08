/**
 * The vehicle models, loaded on demand: the first picker that opens or the first
 * proof that names one fetches them, once. `modelsNow()` is reactive, so a preview
 * drawn before they land draws itself when they do.
 */
let engine = $state.raw(null);
let loading = null;

export function loadModels() {
  loading ??= import('./modelEngine.js').then((mod) => {
    engine = mod;
    return mod;
  });
  return loading;
}

/** The engine, or null while it has not landed. */
export const modelsNow = () => engine;
