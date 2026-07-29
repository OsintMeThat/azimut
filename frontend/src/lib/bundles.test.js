import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api } from './api.js';
import {
  bundleDownloadUrl,
  discardBundleUpload,
  inspectBundle,
  readBundleJob,
  startBundleExport,
  startBundleImport,
  waitForBundle,
} from './bundles.js';

vi.mock('./api.js', () => ({
  api: {
    del: vi.fn(),
    get: vi.fn(),
    post: vi.fn(),
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
});

it('uploads the selected file and keeps passwords out of URLs', async () => {
  const file = new Blob(['bundle']);
  await inspectBundle(file, 'secret');
  await startBundleImport('a'.repeat(32), 'secret');
  await startBundleExport('case-1', 'secret');

  const inspectBody = api.post.mock.calls[0][1];
  expect(api.post.mock.calls[0][0]).toBe('/api/cases/bundles/inspect');
  expect(inspectBody).toBeInstanceOf(FormData);
  expect(inspectBody.get('file')).toBeInstanceOf(Blob);
  expect(inspectBody.get('file').size).toBe(file.size);
  expect(inspectBody.get('password')).toBe('secret');
  expect(api.post).toHaveBeenNthCalledWith(2, '/api/cases/bundles/import', {
    upload_id: 'a'.repeat(32),
    password: 'secret',
  });
  expect(api.post).toHaveBeenNthCalledWith(3, '/api/cases/case-1/bundle/export', {
    password: 'secret',
  });
});

it('builds a same-origin download and can discard an unused upload', async () => {
  expect(bundleDownloadUrl('case one', 'job/two')).toBe(
    '/api/cases/case%20one/bundle/jobs/job%2Ftwo/download'
  );
  await discardBundleUpload('a'.repeat(32));
  expect(api.del).toHaveBeenCalledWith(`/api/cases/bundles/uploads/${'a'.repeat(32)}`);
});

it('polls the destination case until the durable job settles', async () => {
  api.get
    .mockResolvedValueOnce({ state: 'running' })
    .mockResolvedValueOnce({ state: 'ready' });

  await expect(waitForBundle('case-1', 'job-1', 0)).resolves.toEqual({ state: 'ready' });
  expect(readBundleJob).toBeTypeOf('function');
  expect(api.get).toHaveBeenCalledTimes(2);
  expect(api.get).toHaveBeenLastCalledWith('/api/cases/case-1/bundle/jobs/job-1');
});

it('can stop polling when its component goes away', async () => {
  const controller = new AbortController();
  api.get.mockResolvedValue({ state: 'running' });

  const waiting = waitForBundle('case-1', 'job-1', {
    pause: 10_000,
    signal: controller.signal,
  });
  await Promise.resolve();
  controller.abort();

  await expect(waiting).rejects.toMatchObject({ name: 'AbortError' });
});

it('bounds a job that never settles', async () => {
  api.get.mockResolvedValue({ state: 'running' });

  await expect(
    waitForBundle('case-1', 'job-1', { pause: 0, maxPause: 0, timeout: 0 })
  ).rejects.toThrow('timed out');
});
