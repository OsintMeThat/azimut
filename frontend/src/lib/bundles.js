import { api } from './api.js';

export function inspectBundle(file, password = '') {
  const body = new FormData();
  body.append('file', file);
  if (password) body.append('password', password);
  return api.post('/api/cases/bundles/inspect', body);
}

/** Import a checked upload; `keepFlagged` imports what the check flagged too, which is never the default. */
export function startBundleImport(uploadId, password = '', keepFlagged = false) {
  return api.post('/api/cases/bundles/import', {
    upload_id: uploadId,
    password: password || null,
    keep_flagged: keepFlagged === true,
  });
}

// -- what an import leaves out (`engine/filescreen.py`): named before, said after -------------------

const plural = (count, one) => `${count} ${one}${count === 1 ? '' : 's'}`;

/** The line over the files a bundle's check flagged: what they are, and that they stay out by default. */
export function flaggedSaid(count) {
  const one = count === 1;
  return `${plural(count, 'file')} could run as a program or ${one ? 'is' : 'are'} not what ${one ? 'its' : 'their'} name says. `
    + `The import leaves ${one ? 'it' : 'them'} out.`;
}
export const KEEP_FLAGGED = 'Import them too';
export const KEEP_FLAGGED_HELP = 'Keep these files in the case: only for a bundle from someone you trust';

/** What a finished import says: the case, and what it left out, the first few by name. */
export function importedSaid(name, job) {
  const left = Array.isArray(job?.left_out) ? job.left_out : [];
  const count = Number.isInteger(job?.left_out_count) ? job.left_out_count : left.length;
  if (!count) return `Imported “${name}”`;
  const named = left.slice(0, 3).map((item) => item.name).join(', ');
  return `Imported “${name}”, leaving out ${plural(count, 'file')}: ${named}${count > 3 ? '…' : ''}`;
}

export function discardBundleUpload(uploadId) {
  if (!uploadId) return Promise.resolve();
  return api.del(`/api/cases/bundles/uploads/${uploadId}`);
}

export function startBundleExport(caseId, password = '') {
  return api.post(`/api/cases/${caseId}/bundle/export`, {
    password: password || null,
  });
}

export function readBundleJob(caseId, jobId) {
  return api.get(`/api/cases/${caseId}/bundle/jobs/${jobId}`);
}

export function bundleDownloadUrl(caseId, jobId) {
  return `/api/cases/${encodeURIComponent(caseId)}/bundle/jobs/${encodeURIComponent(jobId)}/download`;
}

export function downloadBundle(caseId, jobId) {
  const link = document.createElement('a');
  link.href = bundleDownloadUrl(caseId, jobId);
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}

function aborted() {
  const error = new Error('Bundle job cancelled');
  error.name = 'AbortError';
  return error;
}

function wait(delay, signal) {
  if (signal?.aborted) return Promise.reject(aborted());
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    };
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      reject(aborted());
    };
    const timer = setTimeout(finish, delay);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function waitForBundle(caseId, jobId, options = {}) {
  const config = typeof options === 'number' ? { pause: options } : options;
  const {
    pause = 500,
    maxPause = 5000,
    timeout = 24 * 60 * 60 * 1000,
    signal,
  } = config;
  const deadline = Date.now() + timeout;
  let delay = pause;
  while (true) {
    if (signal?.aborted) throw aborted();
    if (Date.now() >= deadline) throw new Error('Bundle job timed out');
    const job = await readBundleJob(caseId, jobId);
    if (['ready', 'failed', 'cancelled'].includes(job.state)) return job;
    await wait(delay, signal);
    delay = Math.min(maxPause, Math.max(pause, Math.round(delay * 1.5)));
  }
}
