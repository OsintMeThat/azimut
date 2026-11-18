/**
 * The GitHub Pages site a note's web folder is published to (`api/publishing.py`,
 * `engine/githubpages.py`).
 *
 * Reading, saving and forgetting the account, the repository, the branch and the token
 * stay on this machine. Only presses reach GitHub: Test connection, Create the
 * repository, Turn on Pages, Publish, and the watch of the page being built after a
 * publish, which asks for a bounded time. The token goes up once, when typed, and never
 * comes back: the server answers whether one is kept and its last four characters.
 */
import { api } from './api.js';
import { asSvg, drawDiagrams } from './notesExport.js';
import { DEFAULT_BRANCH, DEFAULT_REPO, siteBase } from './githubPagesSetup.js';
import { webLink } from './wordpressSetup.js';

/** The site as Settings shows it: `{ account, repo, branch, site, base, token: { set, hint } }`. */
export async function readGitHub() {
  const answer = await api.get('/api/publishing');
  return readState(answer?.github);
}

export function readState(state) {
  const account = String(state?.account ?? '');
  const repo = String(state?.repo || DEFAULT_REPO);
  const site = webLink(state?.site) ? String(state.site) : '';
  return {
    account,
    repo,
    branch: String(state?.branch || DEFAULT_BRANCH),
    site,
    base: account ? siteBase(account, repo, site) : '',
    token: { set: Boolean(state?.token?.set), hint: String(state?.token?.hint ?? '') },
  };
}

/** Save what changed; a token left empty keeps the one kept. */
export async function saveGitHub(patch) {
  return readState(await api.put('/api/publishing/github', patch));
}

/** Forget the token and the account on this machine. */
export async function forgetGitHub() {
  return readState(await api.del('/api/publishing/github'));
}

/** Who the token is, whether the repository is there and whether Pages serves it. */
export function testGitHub() {
  return api.post('/api/publishing/github/test');
}

/** Make the repository on GitHub: `{ ok, repository }`, or `{ ok: false, detail, manual }`. */
export function createRepository() {
  return api.post('/api/publishing/github/repository');
}

/** Turn Pages on for the branch: `{ ok, base }`, or `{ ok: false, detail, manual }`. */
export function turnOnPages() {
  return api.post('/api/publishing/github/pages');
}

/** Whether Pages has built a commit: `{ state: 'built' | 'building' | 'errored', detail }`. */
export function buildState(commit, { signal } = {}) {
  return api.post('/api/publishing/github/build', { commit }, { signal });
}

/**
 * Publish a note's public edition to the site under `shortName`. Its Mermaid diagrams
 * are drawn here as SVG first, as a web folder holds them. The answer is either
 * `{ published: true, address, repository, commit, … }` or `{ published: false, needs, detail }`
 * when the repository is missing or Pages is off, nothing written.
 */
export async function publishNote(caseId, noteId, { shortName, roundPov = false, changes = '', offlineMaps = false, ...drawing } = {}) {
  const note = noteId || 'case';
  const { diagrams: pending } = await api.post(`/api/cases/${caseId}/notes/pdf/diagrams`, { notes: [note], edition: 'public' });
  const diagrams = pending?.length ? await drawDiagrams(pending, { toPng: asSvg, ...drawing }) : {};
  const answer = await api.post(`/api/cases/${caseId}/notes/${note}/github`, {
    short_name: shortName, diagrams, round_pov: Boolean(roundPov), changes: String(changes ?? '').trim().slice(0, 300),
    offline_maps: Boolean(offlineMaps),
  });
  return answer?.published ? { ...answer, address: webLink(answer.address) } : answer;
}

/** How long the dialog watches a page being built, and how often it asks. */
export const WATCH_MS = 150_000;
export const WATCH_EVERY_MS = 5_000;

/**
 * Ask after a commit's build until Pages has built it, it failed, or `WATCH_MS` passed:
 * `built`, `errored` (with GitHub's words) or `slow`. A failed ask counts as building.
 */
export async function watchBuild(commit, { signal, every = WATCH_EVERY_MS, within = WATCH_MS, ask = buildState,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), now = () => Date.now() } = {}) {
  const until = now() + within;
  while (!signal?.aborted) {
    try {
      const answer = await ask(commit, { signal });
      if (answer?.state === 'built') return { state: 'built' };
      if (answer?.state === 'errored') return { state: 'errored', detail: String(answer.detail ?? '') };
    } catch (error) {
      if (error?.name === 'AbortError') break;
    }
    if (now() + every > until) return { state: 'slow' };
    await wait(every);
  }
  return { state: 'stopped' };
}
