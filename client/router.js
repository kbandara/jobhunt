// WHY: hash routing in eight lines, in its own file so views can navigate without
// importing the app shell (which imports them — a cycle a novice reader should
// never have to reason about).

/** "#/job/abc" -> ["job", "abc"]. An empty hash means the board. */
export function parseHash() {
  const parts = window.location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  return parts.length === 0 ? ['board'] : parts;
}

export function navigate(path) {
  window.location.hash = path.startsWith('#') ? path : `#${path}`;
}
