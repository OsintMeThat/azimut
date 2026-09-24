import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { revealCaseFolder, revealMediaFolder } from './reveal.js';

vi.mock('./api.js', () => ({ api: { post: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
});

it('asks the backend to open a case by id, never by path', async () => {
  await revealCaseFolder('case-1');
  expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/reveal');
});

it('escapes the id, so it cannot carry a path into the URL', async () => {
  await revealCaseFolder('../etc');
  expect(api.post).toHaveBeenCalledWith('/api/cases/..%2Fetc/reveal');
});

it('sends the file path so the folder it sits in can be shown', async () => {
  await revealMediaFolder('case-1', 'media/site plan.pdf');
  expect(api.post).toHaveBeenCalledWith('/api/cases/case-1/media/reveal', {
    path: 'media/site plan.pdf',
  });
});
