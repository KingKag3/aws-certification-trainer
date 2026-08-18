/** Minimal hash router. Works from any subdirectory, which GitHub Pages needs. */

export function parseHash(hash = window.location.hash) {
  const raw = hash.replace(/^#\/?/, '');
  const [pathPart, queryPart] = raw.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const query = {};
  if (queryPart) {
    for (const [k, v] of new URLSearchParams(queryPart)) query[k] = v;
  }
  return { segments, query, raw };
}

export function buildHash(segments, query = {}) {
  const path = segments.filter(Boolean).join('/');
  const qs = new URLSearchParams(
    Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '')
  ).toString();
  return `#/${path}${qs ? `?${qs}` : ''}`;
}

export function navigate(segments, query) {
  window.location.hash = buildHash(segments, query);
}

export function createRouter(onRoute) {
  const handle = () => onRoute(parseHash());
  window.addEventListener('hashchange', handle);
  return { start: handle };
}
