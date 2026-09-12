// Reverse image search — a launcher, not a search. Azimut never queries these
// engines itself (no scraping, no keys, principle 4 "orchestrate, don't
// replace"): it opens each engine's search page and hands the analyst the
// image, either on the clipboard (paste engines) or as a saved file (drag
// engines). Case work is always a local file or a video frame, never a public
// image URL, so there is no by-URL path. Pure data, kept DOM-free so it tests.
//
// `paste: true` marks the engines whose search page accepts a pasted image
// (Ctrl+V); the rest are drag-and-drop only.
//
// `fill: true` marks the ones the capture extension can give the image to
// directly (extension/reverse.js), which is the same hand-off Publish makes to a
// composer and turns the two gestures above into none. It is what the engine's
// own uploader can be reached by, not a promise about how the search goes: the
// extension has to be installed, the switch in Settings on, and every refusal
// lands back on the clipboard road below.
const ENGINES = [
  { id: 'google', label: 'Google Lens', page: 'https://lens.google.com/', paste: true, fill: true },
  // Yandex has no paste target in practice — it wants a file, so it sits with
  // the drag engines.
  // Its home page, not its image search: the camera on `/images/` opens nothing
  // when pressed, while the home page keeps the picker that takes a file.
  { id: 'yandex', label: 'Yandex', page: 'https://yandex.com/', paste: false, fill: true },
  // Not `/visualsearch`: that one redirects to a Microsoft marketing page with
  // nothing to drop a file on. This is Bing's own search-by-image upload view.
  {
    id: 'bing',
    label: 'Bing',
    page: 'https://www.bing.com/images/search?view=detailv2&iss=sbiupload',
    paste: false,
    fill: true,
  },
  { id: 'tineye', label: 'TinEye', page: 'https://tineye.com/', paste: false, fill: true },
];

/**
 * The largest image the extension will carry into an engine's page, in bytes.
 *
 * Not a guess at what the engines take: it is the point where pushing the file
 * through the page, the worker and a second page costs more than the two
 * gestures it saves. Over it, the buttons do what they always did — copy, or
 * save and drag.
 */
export const MAX_HANDOFF_BYTES = 20 * 1024 * 1024;

/**
 * Each engine's search page. `paste` flags the ones that take a clipboard image
 * (Ctrl+V), so the tool can split the copy-and-open hand-off from the
 * save-and-drag one; `fill` flags the ones the extension can hand the image to
 * itself.
 */
export const UPLOAD_PAGES = ENGINES.map((e) => ({
  id: e.id,
  label: e.label,
  url: e.page,
  paste: e.paste,
  fill: e.fill,
}));
