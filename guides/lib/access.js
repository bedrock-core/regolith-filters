// Who a page is for — `access: op` in a page's frontmatter or in a `_category_.json`.
//
// Access is INHERITED downward and never widened by a child: every page under an op-gated
// category is op-gated whatever its own frontmatter says. Resolving that here, once, is what
// lets the manifest carry the *effective* value on every node — the renderer gates a node by
// reading one field instead of walking its parents, and the public prev/next chain baked in
// `build.js` is correct by construction.
//
// One level, deliberately. Roles ('admin', 'mod', ...) are a later shape; accepting a string
// now rather than a boolean is what makes `access: [admin]` a non-breaking addition.

/** The only access level this version understands. */
const OP = 'op';

/**
 * @param {object} input
 * @param {Map<string, object>} input.categories  dirPath → parsed _category_.json
 * @param {(msg: string) => void} input.warn
 * @returns {{ forDir: (dirPath: string) => string | undefined,
 *             forPage: (pageId: string, frontmatter?: object) => string | undefined,
 *             used: () => boolean }}
 */
export function createAccessResolver({ categories, warn }) {
  const dirCache = new Map();
  let used = false;

  /** An unknown value is an authoring typo, not a reason to fail the build — but silently
   *  publishing a page the author believed was gated would be worse than a noisy warning. */
  const declared = (value, where) => {
    if (value === undefined || value === null) { return undefined; }
    if (value === OP) { return OP; }

    warn(`${where}: unsupported access "${String(value)}" — ignored (only "op" is understood)`);

    return undefined;
  };

  const forDir = (dirPath) => {
    if (dirCache.has(dirPath)) { return dirCache.get(dirPath); }

    const parent = dirPath === ''
      ? undefined
      : forDir(dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '');
    // Parent first: a gated ancestor decides the answer, so a child's own value is never even
    // consulted — that is the "cannot widen" rule, and it also skips a redundant warning.
    const value = parent ?? declared((categories.get(dirPath) ?? {}).access, `_category_.json in "${dirPath}"`);

    dirCache.set(dirPath, value);
    if (value !== undefined) { used = true; }

    return value;
  };

  const forPage = (pageId, frontmatter = {}) => {
    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')) : '';
    const value = forDir(dir) ?? declared(frontmatter.access, pageId);

    if (value !== undefined) { used = true; }

    return value;
  };

  /** Whether anything in this guide is gated at all — the manifest's `gated` flag. */
  return { forDir, forPage, used: () => used };
}
