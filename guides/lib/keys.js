// Key assignment for generated .lang entries.
//
// Keys are STRUCTURAL (page path + node position), never content-derived:
// every locale compiles its own MDX tree with this same walk, so identical
// document structure yields identical keys across locales — that is what
// makes cross-locale pairing and parity checking possible.
//
// Scheme:
//   bcg.<ns>.<page_path_dots>.<node_path>     page content
//   bcg.<ns>._cat.<dir_path_dots>             category labels
//   bcg.<ns>._adm.<kind>                      default admonition titles
//
// node_path grammar (assigned by lib/compile.js):
//   title                 page title
//   b<N>                  top-level block N
//   b<N>.b<M>             admonition child block
//   b<N>.t                admonition custom title
//   b<N>.i<M>[.i<P>...]   list item (nested)
//   <path>.r<M>           inline run M (plain text or link) under a paragraph/list item

/** Sanitize one path segment: lowercase, anything outside [a-z0-9_] becomes '_'. */
export function sanitizeSegment(segment) {
  return String(segment).toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/** 'getting-started/intro' → 'getting_started.intro' */
export function pageIdToKeyPath(pageId) {
  return pageId.split('/').map(sanitizeSegment).join('.');
}

/** Root prefix shared by every key this filter emits: 'bcg.<ns>'. */
export function keyPrefix(ns) {
  return `bcg.${sanitizeSegment(ns)}`;
}

/** Full key for a node inside a page. */
export function pageKey(prefix, pageId, nodePath) {
  return `${prefix}.${pageIdToKeyPath(pageId)}.${nodePath}`;
}

/** Full key for a category (directory) label. */
export function catKey(prefix, dirPath) {
  return `${prefix}._cat.${pageIdToKeyPath(dirPath)}`;
}

/** Full key for a default admonition title. */
export function admKey(prefix, kind) {
  return `${prefix}._adm.${kind}`;
}
