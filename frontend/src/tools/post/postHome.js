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
import {
  normalizePostKind, POST_KINDS, POST_STATES, postKind, postStateLabel, postTarget, STARTABLE_POST_KINDS,
} from '../../lib/post.js';

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

/** Where a listed draft stands, as `GET /drafts` says (`api/drafts.py`): a draft when it says nothing. */
export function draftState(draft) {
  return ['opened', 'posted', 'changed'].includes(draft?.state) ? draft.state : 'draft';
}

/** The pill a card wears: its state, an opened one naming the site it was opened on. */
export function draftPill(draft) {
  const state = draftState(draft);
  return { state, label: postStateLabel(state, draft?.site ?? draft?.target) };
}

/**
 * The home's two parts of drafts: **in progress**, what has not gone out or was changed
 * since, newest first as the list gives them; and **posted**, the latest to go out first.
 */
export function homeDrafts(drafts) {
  const progress = [];
  const posted = [];
  for (const draft of drafts ?? []) (draftState(draft) === 'posted' ? posted : progress).push(draft);
  posted.sort((a, b) => String(b.posted?.at ?? b.updated_at ?? '').localeCompare(String(a.posted?.at ?? a.updated_at ?? '')));
  return { progress, posted };
}

/** A posted link as a card prints it: the address without its scheme. */
export const shortLink = (url) => String(url ?? '').replace(/^https?:\/\//, '');

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

/**
 * The picture a draft card shows, read off the lists the app already has: its proof's
 * thumbnail when the case still lists the proof, else the thumbnail of the first file it
 * carries (`picture`, from `GET /drafts`), or that file itself when it is an image. A
 * video with no thumbnail yet, or a file the case no longer lists, shows the kind's icon.
 *
 * `media` maps a case path to its `/media` row (`kind`, `thumbnail`).
 */
export function draftPicture(draft, proofs, media = new Map()) {
  const path = draft?.picture ?? draft?.proof;
  if (!path) return null;
  const row = (proofs ?? []).find((one) => one.png === path);
  if (row) return row.thumb ?? row.png;
  const item = media.get(path);
  if (!item) return null;
  return item.thumbnail ?? (item.kind === 'image' ? path : null);
}

/**
 * What the Open list can narrow by, from the posts it lists: the kinds and the states
 * they hold, each with how many, in the order New post and the pills give them.
 */
export function postFacets(drafts) {
  const count = (key) => {
    const counts = new Map();
    for (const draft of drafts ?? []) counts.set(key(draft), (counts.get(key(draft)) ?? 0) + 1);
    return counts;
  };
  const kinds = count((draft) => normalizePostKind(draft?.kind));
  const states = count(draftState);
  return {
    kinds: POST_KINDS.filter((kind) => kinds.has(kind.id)).map((kind) => ({ id: kind.id, label: kind.label, count: kinds.get(kind.id) })),
    states: POST_STATES.filter((state) => states.has(state.id)).map((state) => ({ id: state.id, label: state.label, count: states.get(state.id) })),
  };
}

/** The posts the Open list shows: those of the kind and the state picked ('' for every one) a search finds. */
export function filterPosts(drafts, { query = '', kind = '', state = '' } = {}) {
  return (drafts ?? []).filter((draft) =>
    (!kind || normalizePostKind(draft?.kind) === kind)
    && (!state || draftState(draft) === state)
    && (!String(query).trim() || matchesTerms([draft.title, draft.name].filter(Boolean).join('\n'), query)));
}
