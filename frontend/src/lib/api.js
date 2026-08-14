/** Thin fetch wrapper for the local Azimut API. */

/**
 * Read a FastAPI error body into one line.
 *
 * A refused request answers with a string; a body the schema rejected answers
 * with the validator's list of objects, and handing that straight to `Error`
 * stringified every validation failure in the app as "[object Object]".
 */
function detailLine(detail) {
  if (typeof detail === 'string') return detail;
  if (!Array.isArray(detail)) return '';
  return detail
    .map((item) => {
      if (typeof item === 'string') return item;
      const field = Array.isArray(item?.loc) ? item.loc.filter((p) => p !== 'body').join('.') : '';
      const message = item?.msg ?? '';
      return field && message ? `${field}: ${message}` : message || field;
    })
    .filter(Boolean)
    .join('; ');
}

class ApiError extends Error {
  constructor(status, detail) {
    super(detailLine(detail) || `HTTP ${status}`);
    this.status = status;
  }
}

async function request(method, path, body, opts = {}) {
  const init = { method, headers: {} };
  if (body instanceof FormData) {
    init.body = body;
  } else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(path, { ...init, ...opts });
  if (!res.ok) {
    let detail = '';
    try {
      detail = (await res.json()).detail;
    } catch {
      /* non-json error body */
    }
    throw new ApiError(res.status, detail);
  }
  if (res.status === 204) return null;
  return res.json();
}

export const api = {
  // `opts` reaches fetch (e.g. `{ signal }`) so a caller can cancel a stale
  // request — the bounded catalog aborts an in-flight page on case/filter change.
  get: (path, opts) => request('GET', path, undefined, opts),
  post: (path, body) => request('POST', path, body),
  put: (path, body) => request('PUT', path, body),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

export { ApiError };
