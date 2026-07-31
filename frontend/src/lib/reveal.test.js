import { beforeEach, expect, it, vi } from 'vitest';
import { api } from './api.js';
import { revealCaseFolder, revealWorkspaceFolder } from './reveal.js';

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

it('opens the workspace with no argument at all', async () => {
  await revealWorkspaceFolder();
  expect(api.post).toHaveBeenCalledWith('/api/settings/reveal-workspace');
});
