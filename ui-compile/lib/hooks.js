// Writing a hook into a vanilla file that may already carry one.
//
// A hook is a copy of a vanilla UI file holding modifications only. The pack
// being built may already ship its own copy of that file — the render pack
// does, to point the chest screen at its chest root — and overwriting it
// would throw that edit away. So a hook is MERGED: the file's existing
// modifications of each panel come first, the addon's follow.

/**
 * Reads a pack JSON file that may carry comments. Comments do not survive.
 *
 * @param {string} raw
 * @returns {object}
 */
export const parseJsonc = (raw) => {
  let out = '';
  let inString = false;
  let escaped = false;

  for (let at = 0; at < raw.length; at += 1) {
    const char = raw[at];
    const next = raw[at + 1];

    if (inString) {
      out += char;

      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }

      continue;
    }

    if (char === '"') {
      inString = true;
      out += char;

      continue;
    }

    if (char === '/' && next === '/') {
      while (at < raw.length && raw[at] !== '\n') {
        at += 1;
      }

      out += '\n';

      continue;
    }

    if (char === '/' && next === '*') {
      at += 2;

      while (at < raw.length && !(raw[at] === '*' && raw[at + 1] === '/')) {
        at += 1;
      }

      at += 1;

      continue;
    }

    out += char;
  }

  return JSON.parse(out);
};

/**
 * The hook document merged over what the file already holds.
 *
 * @param {string | undefined} existing the file's current text, if there is one
 * @param {object} hook the hook document: a namespace and modification entries
 * @returns {object} the document to write
 * @throws when the file defines a panel the hook modifies: that definition would
 *   replace vanilla's, which is the one thing a hook must never do
 */
export const mergeHook = (existing, hook) => {
  if (existing === undefined) {
    return hook;
  }

  const merged = parseJsonc(existing);

  for (const [name, entry] of Object.entries(hook)) {
    if (name === 'namespace') {
      continue;
    }

    const current = merged[name];

    if (current === undefined) {
      merged[name] = entry;

      continue;
    }

    if (!Array.isArray(current.modifications)) {
      throw new Error(
        `${hook.namespace}.${name} is DEFINED in the pack's own copy of the file; `
        + 'a hook can only add modifications to it, and a definition there replaces vanilla\'s for every pack',
      );
    }

    merged[name] = { ...current, modifications: [...current.modifications, ...entry.modifications] };
  }

  return merged;
};
