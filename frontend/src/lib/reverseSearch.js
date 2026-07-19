// Reverse image search — a launcher, not a search. Azimut never queries these
// engines itself (no scraping, no keys, principle 4 "orchestrate, don't
// replace"): it opens each engine's search page and hands the analyst the
// image, either on the clipboard (paste engines) or as a saved file (drag
// engines). Case work is always a local file or a video frame, never a public
// image URL, so there is no by-URL path. Pure data, kept DOM-free so it tests.
//
// `paste: true` marks the engines whose search page accepts a pasted image
// (Ctrl+V); the rest are drag-and-drop only.
const ENGINES = [
  { id: 'google', label: 'Google Lens', page: 'https://lens.google.com/', paste: true },
  // Yandex's page has no paste target in practice — it wants a file, so it sits
  // with the drag engines.
  { id: 'yandex', label: 'Yandex', page: 'https://yandex.com/images/', paste: false },
  { id: 'bing', label: 'Bing', page: 'https://www.bing.com/visualsearch', paste: false },
  { id: 'tineye', label: 'TinEye', page: 'https://tineye.com/', paste: false },
];

/**
 * Each engine's search page. `paste` flags the ones that take a clipboard image
 * (Ctrl+V), so the tool can split the copy-and-open hand-off from the
 * save-and-drag one.
 */
export const UPLOAD_PAGES = ENGINES.map((e) => ({
  id: e.id,
  label: e.label,
  url: e.page,
  paste: e.paste,
}));
