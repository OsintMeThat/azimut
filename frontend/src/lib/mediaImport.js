/**
 * Upload a batch of files into the case, one request each, so one refusal does
 * not lose the rest. Shared by the Media Library's Import and Files' Import here.
 *
 * Does not reload the case or toast: the caller says what landed, and where.
 */
import { api } from './api.js';

/** `{ landed, filed, duplicates, failed }`: paths, their entities, the count of
 *  bytes the case already held, and `{ name, message }` for each refusal. */
export async function uploadFiles(caseId, files, sourceUrl = '') {
  const landed = [];
  const filed = [];
  const failed = [];
  let duplicates = 0;
  for (const file of files) {
    const form = new FormData();
    form.append('file', file);
    if (sourceUrl) form.append('source_url', sourceUrl);
    try {
      const res = await api.post(`/api/cases/${caseId}/media/upload`, form);
      if (res.duplicate) duplicates++;
      else if (res.item?.path) {
        landed.push(res.item.path);
        filed.push(res.entity);
      }
    } catch (e) {
      failed.push({ name: file.name, message: e.message });
    }
  }
  return { landed, filed, duplicates, failed };
}
