/**
 * The site as the last read found it, kept for the session so that the hero, the checklist and the
 * panels of Settings › Website show the same thing without asking GitHub again.
 *
 * `runRead` is the Read the site press and the only way in: nothing here runs on mount, and the
 * answer is never stored on disk. `key` is the repository it was read from, so a read of another
 * repository is dropped (`forgetRead`) rather than shown under the wrong name. A delete takes its
 * folder out of the read at once (`dropFolder`), the way the next read would find it.
 */
import { readSite } from './githubPages.js';
import { siteReadOf, withoutFolder } from './websiteHub.js';

export const siteRead = $state({
  /** The read, `null` until one is pressed: see `siteReadOf` for its shape. */
  data: null,
  /** When it was read, on this computer's clock. */
  at: null,
  busy: false,
  /** What went wrong, in the server's words. */
  error: '',
  /** What the read found missing: `{ needs: 'repository' | 'pages', detail }`. */
  needs: null,
  /** The repository the read is of, `account/repo@branch`. */
  key: '',
});

/** Read the site once; a second press while one is running does nothing. */
export async function runRead(key = '') {
  if (siteRead.busy) return false;
  siteRead.busy = true;
  siteRead.error = '';
  siteRead.needs = null;
  try {
    const answer = await readSite();
    if (answer?.ok === false && answer.needs) {
      siteRead.needs = { needs: answer.needs === 'repository' ? 'repository' : 'pages', detail: String(answer.detail ?? '') };
      return false;
    }
    siteRead.data = siteReadOf(answer);
    siteRead.at = new Date();
    siteRead.key = key;
    return true;
  } catch (error) {
    siteRead.error = error.message;
    return false;
  } finally {
    siteRead.busy = false;
  }
}

/** A folder deleted from the site leaves the read. */
export function dropFolder(folder) {
  siteRead.data = withoutFolder(siteRead.data, folder);
}

/** Update the site wrote Azimut's home page: a site the read found with none has it now. */
export function homeWritten() {
  if (siteRead.data?.home === 'none') siteRead.data = { ...siteRead.data, home: 'azimut' };
}

/** Forget what was read: the repository changed, or GitHub was forgotten. */
export function forgetRead() {
  siteRead.data = null;
  siteRead.at = null;
  siteRead.error = '';
  siteRead.needs = null;
  siteRead.key = '';
}
