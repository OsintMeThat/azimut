/**
 * What Post's home shows with no post open (`PostHome.svelte`), as pure readings of two
 * lists the app already has: the drafts (`GET /cases/{id}/drafts`, newest first, each
 * with its kind, platform, post count and the proof or video it posts) and the proofs
 * (`GET /cases/{id}/proofs`, a proof of a video saying which video and which slide).
 *
 * **What has a post yet** is read off the drafts alone: a proof has one when a draft
 * names its picture, and a video's series when a video-thread draft names the video.
 * The drafts list reads every draft file anyway, so this costs no read of its own, and
 * a post deleted to the Trash gives its proof back to Ready to post at once.
 */
import { matchesTerms } from '../../lib/folderBrowse.js';
import { onVideo } from '../../lib/proofList.js';
import { videoName } from '../../lib/proofScene.js';
import { normalizePostKind, postKind, postTarget, STARTABLE_POST_KINDS } from '../../lib/post.js';

/** How many drafts the home lists before "All N drafts". */
export const DRAFTS_SHOWN = 6;

/** "1 post", "3 posts". */
export function postsWords(count) {
  const n = Number.isInteger(count) && count > 0 ? count : 1;
  return `${n} ${n === 1 ? 'post' : 'posts'}`;
}

/** The line under a draft's name: its platform, and its kind when it is not a geolocation. */
export function draftLine(draft) {
  const kind = normalizePostKind(draft?.kind);
  return [postTarget(draft?.target).label, kind === 'geolocation' ? '' : postKind(kind).label, postsWords(draft?.posts)]
    .filter(Boolean)
    .join(' · ');
}

/** The drafts the home shows: the last ones saved. */
export const recentDrafts = (drafts, shown = DRAFTS_SHOWN) => (drafts ?? []).slice(0, shown);

/** The drafts a search by name finds, in the list's order. */
export function findDrafts(drafts, query) {
  if (!String(query ?? '').trim()) return [];
  return (drafts ?? []).filter((draft) => matchesTerms([draft.title, draft.name].filter(Boolean).join('\n'), query));
}

/**
 * What waits for a post: the proofs on photos no draft names yet, newest first, and the
 * videos whose proofs make a series, each with its slides no draft names yet, in slide
 * order. A video stays while one of its slides waits or, where a video thread can be
 * started (`threads`), while its series has no thread yet: a series is never offered
 * twice and never lost while a slide still waits. A proof with no picture saved cannot
 * be posted and is left out.
 */
export function readyToPost(proofs, drafts, { threads = STARTABLE_POST_KINDS.includes('video') } = {}) {
  const posted = new Set((drafts ?? []).map((draft) => draft.proof).filter(Boolean));
  const threaded = new Set(
    (drafts ?? []).filter((draft) => normalizePostKind(draft.kind) === 'video' && draft.video).map((draft) => draft.video)
  );
  const photos = [];
  const videos = new Map();
  for (const row of proofs ?? []) {
    if (!row?.png) continue;
    if (!onVideo(row)) {
      if (!posted.has(row.png)) photos.push(row);
      continue;
    }
    const series = videos.get(row.video) ?? {
      video: row.video,
      title: videoName(row.video, row.video_title),
      slides: [],
      count: 0,
      threaded: threaded.has(row.video),
    };
    series.count += 1;
    if (!posted.has(row.png)) series.slides.push(row);
    videos.set(row.video, series);
  }
  const waiting = [...videos.values()]
    .filter((series) => series.slides.length || (threads && !series.threaded))
    .map((series) => ({ ...series, slides: series.slides.sort((a, b) => a.slide - b.slide) }));
  return { photos, videos: waiting };
}

/** The picture a draft card shows: its proof's thumbnail when the case still lists it. */
export function draftPicture(draft, proofs) {
  if (!draft?.proof) return null;
  const row = (proofs ?? []).find((one) => one.png === draft.proof);
  return row ? row.thumb ?? row.png : null;
}
