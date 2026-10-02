/** Thin fetch wrapper for the local Azimut API. */

/**
 * Read a FastAPI error body into one line.
 *
 * A refused request answers with a string; a body the schema rejected answers
 * with the validator's list of objects, and handing that straight to `Error`
 * stringified every validation failure in the app as "[object Object]".
 */
export function detailLine(detail) {
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

/** What any request says when the app behind the tab is gone. */
export const NOT_RUNNING = 'Azimut is not running. Start it again, then reload this tab.';

/** What a failure says when its body gave no reason: a crash on the server
 *  answers with a bare "Internal Server Error". */
function fallback(status) {
  return status >= 500 ? `Azimut hit an unexpected error (HTTP ${status}). Settings → System → Report an issue has its log.` : `HTTP ${status}`;
}

class ApiError extends Error {
  constructor(status, detail) {
    super(detailLine(detail) || fallback(status));
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
  let res;
  try {
    res = await fetch(path, { ...init, ...opts });
  } catch (error) {
    // A cancelled request is the caller's own doing and says nothing to anyone.
    if (error?.name === 'AbortError') throw error;
    // Otherwise the request never reached a server: the app was stopped, its window
    // closed, or the machine went to sleep under it. The browser's own words for that
    // ("Failed to fetch", "NetworkError when attempting…") name none of those.
    throw new ApiError(0, NOT_RUNNING);
  }
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
  // `keepalive` lets a save sent while the tab closes outlive the page.
  post: (path, body, opts) => request('POST', path, body, opts),
  put: (path, body, opts) => request('PUT', path, body, opts),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

export { ApiError };
