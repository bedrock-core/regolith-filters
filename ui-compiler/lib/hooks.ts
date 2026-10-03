// Writing a hook into a vanilla file that may already carry one.
//
// Hooks modify vanilla controls and can declare addon-owned bridge controls.
// Existing modifications precede the addon's, preserving hooks already in the pack.

import { isDeepStrictEqual } from 'node:util';

/** One JSON UI document: a namespace, and definitions or modification entries. */
export type Document = Record<string, unknown>;

/** A definition carrying modifications, which is all a hook may add to. */
interface Modifiable {
  [property: string]: unknown;
  modifications?: unknown[];
}

/** Reads a pack JSON file that may carry comments. Comments do not survive. */
export const parseJsonc = (raw: string): Document => {
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

  return JSON.parse(out) as Document;
};

/**
 * The hook document merged over what the file already holds.
 *
 * @param existing the file's current text, if there is one
 * @param hook the hook document: a namespace, modification entries and new addon-owned definitions
 * @returns the document to write
 * @throws when the file defines a panel the hook modifies: that definition would
 *   replace vanilla's, which is the one thing a hook must never do
 */
export const mergeHook = (existing: string | undefined, hook: Document): Document => {
  if (existing === undefined) {
    return hook;
  }

  const merged = parseJsonc(existing);

  if (merged.namespace !== hook.namespace) throw new Error('The existing UI hook has a different namespace.');

  for (const [name, entry] of Object.entries(hook)) {
    if (name === 'namespace') {
      continue;
    }

    const current = merged[name] as Modifiable | undefined;

    if (current === undefined) {
      merged[name] = entry;

      continue;
    }

    const incoming = entry as Modifiable;

    if ('type' in incoming || 'controls' in incoming) {
      throw new Error(`${String(hook.namespace)}.${name} is already defined; an addon-owned hook control cannot replace it`);
    }

    if ('type' in current || 'controls' in current) {
      throw new Error(
        `${String(hook.namespace)}.${name} is DEFINED in the pack's own copy of the file; `
        + 'a hook can only add modifications to it, and a definition there replaces vanilla\'s for every pack',
      );
    }

    const properties = { ...current };
    for (const [property, value] of Object.entries(incoming)) {
      if (property === 'modifications') continue;
      if (property in current && !isDeepStrictEqual(current[property], value)) {
        throw new Error(`${String(hook.namespace)}.${name}.${property} conflicts with the compiler's vanilla hook`);
      }
      properties[property] = value;
    }

    const modifications = [...current.modifications ?? []];
    for (const modification of incoming.modifications ?? []) {
      if (!modifications.some(value => isDeepStrictEqual(value, modification))) modifications.push(modification);
    }
    merged[name] = { ...properties, ...modifications.length === 0 ? {} : { modifications } };
  }

  return merged;
};
