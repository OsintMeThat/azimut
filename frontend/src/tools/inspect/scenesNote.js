/**
 * A video's scenes as they go into a note: a table, one row per scene in the order
 * they come in the clip, as the server reads them (`GET /cases/{id}/scenes?video=`).
 * A row gives the scene's time, its title, where it was geolocated, the day its proof
 * states and the proof itself. A scene still to geolocate is a row that says so.
 *
 * Everything is cited by id, never by path: the video, the places and the proofs are
 * chips, so a rename moves nothing and the PDF numbers them as sources.
 */
import { api } from '../../lib/api.js';
import { postDate } from '../../lib/post.js';
import { isAbandoned, sceneMoments, sceneTitle, unplaced, WHOLE_VIDEO } from '../../lib/scenes.js';
import { NOTE_ROWS, cutLine, tableChip, toMarkdown } from '../../lib/sheetExport.js';
import { LEFT_WHY, timecode } from '../../lib/videoThread.js';
import { pointCoords } from '../proof/proofNote.js';

/** What a scene with no place says where its place would be. */
export const NOT_YET = 'Not geolocated yet';

/** A scene's time: `[0:15]`, `[0:00–0:07]`, several side by side, or Whole video. */
export const sceneTimecode = (scene) => timecode(sceneMoments(scene)) || WHOLE_VIDEO;

/** One point: the case place it sits on as a chip, else its coordinates, and where the camera stood said so. */
function pointCell(point) {
  const where = pointCoords(point?.coords ?? '');
  const said = point?.place_id ? tableChip(point.place_id, point.place_label || point.label || where) : where;
  return said && point?.pov ? `${said} (point of view)` : said;
}

/** Where a scene was geolocated: each point of its proof, or why there is none. */
export function scenePlace(scene) {
  if (isAbandoned(scene)) return LEFT_WHY.abandoned;
  if (scene?.kind !== 'proof' || unplaced(scene)) return NOT_YET;
  const points = (scene.points ?? []).map(pointCell).filter(Boolean);
  return points.length ? points.join(' · ') : NOT_YET;
}

/** One scene as a row: time, title, place, date and proof. */
function sceneRow(scene) {
  const proof = scene.kind === 'proof';
  return [
    sceneTimecode(scene),
    sceneTitle(scene),
    { markdown: scenePlace(scene) },
    proof ? postDate(scene.when, scene.when_zone) : '',
    { markdown: proof && scene.proof_id ? tableChip(scene.proof_id, sceneTitle(scene)) : '' },
  ];
}

/**
 * The scenes the server read (`{ video_id, scenes }`) as a table for a note, under the
 * video's chip; '' when the video has none. `title` is what the case calls the video.
 */
export function scenesTable(read, { title = '', limit = NOTE_ROWS } = {}) {
  const scenes = read?.scenes ?? [];
  if (!scenes.length) return '';
  const shown = scenes.slice(0, limit);
  const video = read.video_id ? tableChip(read.video_id, title || read.video_id) : title;
  const said = [video ? `Scenes of ${video}` : ''].filter(Boolean);
  const cut = cutLine({ kept: shown.length, total: scenes.length, noun: 'scenes', narrow: '' }).trim();
  return toMarkdown(
    { columns: ['Time', 'Scene', 'Place', 'Date', 'Proof'], rows: shown.map(sceneRow) },
    cut ? [...said, cut] : said,
  );
}

/**
 * The scenes of the video open in Inspect, offered to a pinned note as a table. `video`
 * is the file open (`{ path, title?, filename? }`), or null for a picture; `scenes` how
 * many it lists. No offer for a video with none.
 */
export function scenesOffer({ caseId, video, scenes = 0, get = api.get }) {
  if (!caseId || !video?.path || !scenes) return null;
  return {
    id: 'scenes',
    label: 'The scenes of this video',
    hint: 'As a table',
    icon: 'table',
    put: async ({ signal } = {}) => {
      const read = await get(`/api/cases/${caseId}/scenes?video=${encodeURIComponent(video.path)}`, signal ? { signal } : undefined);
      const text = scenesTable(read, { title: video.title || video.filename || video.path.split('/').pop() });
      if (!text) throw new Error('No scene of this video is saved yet');
      return { text };
    },
  };
}
