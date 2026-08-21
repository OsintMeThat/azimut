import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from './api.js';

function answers(status, body) {
  vi.stubGlobal(
    'fetch',
    vi.fn().mockResolvedValue({
      ok: status < 400,
      status,
      json: async () => body,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('API errors', () => {
  it('reads a refusal the backend wrote as a sentence', async () => {
    answers(409, { detail: 'a case named “Rooftop” already exists' });
    await expect(api.get('/api/cases')).rejects.toThrow('a case named “Rooftop” already exists');
  });

  it('reads a schema rejection, which arrives as the validator’s list of objects', async () => {
    // FastAPI answers 422 with `detail` as an array. Handed straight to Error,
    // every validation failure in the app surfaced as "[object Object]".
    answers(422, {
      detail: [
        { loc: ['body', 'lon'], msg: 'Input should be less than or equal to 180', type: 'less_than_equal' },
      ],
    });
    await expect(api.post('/api/satellite/capture', {})).rejects.toThrow(
      'lon: Input should be less than or equal to 180'
    );
  });

  it('joins several rejected fields into one line', async () => {
    answers(422, {
      detail: [
        { loc: ['body', 'lat'], msg: 'field required' },
        { loc: ['body', 'zoom'], msg: 'must be an integer' },
      ],
    });
    await expect(api.post('/api/x', {})).rejects.toThrow('lat: field required; zoom: must be an integer');
  });

  it('falls back to the status when the body says nothing usable', async () => {
    answers(500, { detail: [] });
    await expect(api.get('/api/x')).rejects.toThrow('HTTP 500');
  });

  it('carries the status for callers that branch on it', async () => {
    answers(404, { detail: 'case not found' });
    await expect(api.get('/api/cases/nope')).rejects.toMatchObject({
      status: 404,
      constructor: ApiError,
    });
  });
});
