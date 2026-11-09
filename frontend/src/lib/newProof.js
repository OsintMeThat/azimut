/**
 * New proof's window: where the case's pictures come from, and what a scene to prove
 * brings in (`tools/proof/NewProofDialog.svelte`).
 *
 * A picture of the case comes from one place, read off what the app already knows of
 * it: a satellite capture (`isSatelliteMedia`), a frame or a collage Inspect cut from
 * one video (`lib/proofScene.frameOrigin`), a collage of several files, a map or screen
 * grab the app drew (the extension's screenshots, Compare, Horizon), or a photo brought
 * in. A collage of one video counts under its video and under Collages too.
 *
 * The scenes still to prove are the queue's (`GET /scenes/queue`), each a colour dot,
 * a name, its time and its file, as the To-do words them (`lib/sceneQueue.js`).
 */
import { fileStem } from './proofScene.js';
import { captureCount, isPicture, openScenes, queueColor, queueName, queueTime, queueState } from './sceneQueue.js';

/** The sources a new proof picks from, in the order the window lists them. */
export const SOURCES = [
  { id: 'all', label: 'All', icon: 'grid' },
  { id: 'satellite', label: 'Satellite', icon: 'satellite' },
  { id: 'videos', label: 'Videos', icon: 'video' },
  { id: 'collages', label: 'Collages', icon: 'layers' },
  { id: 'screenshots', label: 'Screenshots', icon: 'screen' },
  { id: 'photos', label: 'Photos', icon: 'image' },
];

/** Pictures the app drew of a place that are not satellite imagery: a map grab, a Compare render, a Horizon view. */
const DRAWN = new Set(['screenshot', 'compare', 'horizon']);

/**
 * Where one picture of the panel list comes from. Each item carries `kind` (`satellite`
 * or `media`), `origin` (`{ video, time }` for one cut from a video, else null),
 * `collage` and `sourceType`, as `fetchPanelItems` reads them.
 */
export function sourceOf(item) {
  if (item?.kind === 'satellite') return 'satellite';
  if (item?.origin?.video) return 'videos';
  if (item?.collage) return 'collages';
  if (DRAWN.has(item?.sourceType)) return 'screenshots';
  return 'photos';
}

/** Whether a picture shows under a source. A collage of one video is under both. */
export function inSource(item, id) {
  if (id === 'all') return true;
  if (id === 'collages') return !!item?.collage;
  return sourceOf(item) === id;
}

/** The sources with what each holds, the empty ones left out. All is always there. */
export function proofSources(items) {
  const list = items ?? [];
  return SOURCES
    .map((source) => ({ ...source, count: list.filter((item) => inSource(item, source.id)).length }))
    .filter((source) => source.id === 'all' || source.count > 0);
}

/** The case's folders the pictures are filed in, sorted, each with its depth. */
export function pictureFolders(items) {
  const found = new Set();
  for (const item of items ?? []) {
    const parts = String(item?.folder ?? '').split('/').filter(Boolean);
    for (let i = 1; i <= parts.length; i += 1) found.add(parts.slice(0, i).join('/'));
  }
  return [...found]
    .sort((a, b) => a.localeCompare(b))
    .map((path) => ({ path, name: path.split('/').pop(), depth: path.split('/').length - 1 }));
}

/** Whether a picture is filed in this folder or one under it. */
export const inFolder = (item, folder) => {
  const at = String(item?.folder ?? '');
  return !folder || at === folder || at.startsWith(`${folder}/`);
};

/**
 * The Videos source, one block per video: its frames in clip order, then its
 * collages, the video last worked on first. `titleOf(path)` is what the case calls
 * the video, its file name without the extension when it says nothing.
 */
export function videoBlocks(items, titleOf = () => '') {
  const blocks = new Map();
  for (const item of items ?? []) {
    const video = item?.origin?.video;
    if (!video) continue;
    if (!blocks.has(video)) {
      blocks.set(video, { video, title: titleOf(video) || fileStem(video), frames: [], collages: [], latest: '' });
    }
    const block = blocks.get(video);
    (item.collage ? block.collages : block.frames).push(item);
    if (String(item.added_at ?? '') > block.latest) block.latest = String(item.added_at ?? '');
  }
  const byTime = (a, b) => (a.origin.time ?? 0) - (b.origin.time ?? 0);
  return [...blocks.values()]
    .map((block) => ({ ...block, frames: block.frames.sort(byTime), collages: block.collages.sort(byTime) }))
    .sort((a, b) => b.latest.localeCompare(a.latest) || a.title.localeCompare(b.title));
}

/**
 * The scenes still to prove, as New proof lists them: the abandoned left out, by file
 * in the queue's order. Each `{ key, video, id, title, name, time, color, state, picture, row }`.
 */
export function scenesToProve(files, live = null) {
  return openScenes(files).flatMap((file) => file.scenes.map((scene) => ({
    key: `${file.video}#${scene.id}`,
    video: file.video,
    id: scene.id,
    title: file.title || fileStem(file.video),
    name: queueName(scene),
    time: queueTime(scene),
    color: queueColor(scene),
    state: queueState(scene, live?.video === file.video && live?.id === scene.id),
    captures: captureCount(scene),
    picture: isPicture(scene),
    row: { ...scene, video: file.video },
  })));
}

// -- the pictures picked, in panel order ------------------------------------------------

/** The pick with `key` added at the end, or taken out when it is there. */
export const togglePick = (picked, key) => (picked.includes(key) ? picked.filter((one) => one !== key) : [...picked, key]);

/** The pick with the picture at `from` moved to `to`, both clamped to the list. */
export function movePick(picked, from, to) {
  const list = [...picked];
  if (from < 0 || from >= list.length) return list;
  const [one] = list.splice(from, 1);
  list.splice(Math.max(0, Math.min(list.length, to)), 0, one);
  return list;
}

/**
 * A scene's material as one list of pictures, in the order its proof lays them: a
 * picture marked to geolocate first, the frames and collages in clip order, then the
 * captures it gathered, in the order they came. `material` is what Make the proof reads
 * (`frames`, `collages`, `captures`, `picture`, and `capture` for a scene holding no
 * frame yet, drawn at its start as `startFrame`). A frame not in the case yet is keyed
 * by its id, the rest by their path.
 */
export function sceneMaterial(material) {
  const picture = material?.picture?.path ? [{ key: material.picture.path, group: 'picture', picture: material.picture }] : [];
  const start = material?.capture
    ? material.startFrame ?? { id: 'start', time: material.capture.time, path: null, url: '' }
    : null;
  const frames = start
    ? [{ key: 'frame:start', frame: start, at: start.time, group: 'frames' }]
    : (material?.frames ?? []).map((f) => ({ key: f.path || `frame:${f.id}`, frame: f, at: f.time, group: 'frames' }));
  const collages = (material?.collages ?? []).map((c) => ({ key: c.path, at: c.start ?? 0, group: 'collages', collage: c }));
  const timed = [...frames, ...collages].sort((a, b) => a.at - b.at);
  const seen = new Set([...picture, ...timed].map((one) => one.key));
  const captures = (material?.captures ?? [])
    .filter((c) => c?.path && !seen.has(c.path))
    .map((c) => ({ key: c.path, group: 'captures', capture: c }));
  return [...picture, ...timed, ...captures];
}
