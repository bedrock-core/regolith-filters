// Nested resource objects → flat path→template maps, plus the build checks
// that turn silent runtime failures into build errors naming the path to fix.

import { templateVars } from './interp.js';

/**
 * Past six levels the runtime's type-level path recursion gives up and
 * degrades the whole key union to `string`, losing every compile-time
 * guarantee with nothing to explain why — so the build refuses first.
 */
export const MAX_DEPTH = 6;

export const PLURAL_SUFFIXES = ['zero', 'one', 'two', 'few', 'many', 'other'];

/** A segment must survive as part of a `key=value` line and as a TS property. */
const SEGMENT_RE = /^[A-Za-z0-9_]+$/;

/**
 * Flatten a default-exported resource object into path → template. Problems
 * are reported (and the entry skipped) instead of thrown, so one run surfaces
 * every issue at once.
 *
 * @param {unknown} value
 * @param {{ error(scope: string, msg: string): void }} report
 * @param {string} [prefix]
 * @param {number} [depth]
 * @returns {Map<string, string>}
 */
export function flattenResources(value, report, prefix = '', depth = 0) {
  const out = new Map();

  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    report.error(prefix || '<root>', 'resource module must default-export a nested object of strings');
    return out;
  }

  for (const [segment, child] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${segment}` : segment;

    if (!SEGMENT_RE.test(segment)) {
      report.error(path, `segment "${segment}" is not usable in a .lang key (allowed: A-Za-z0-9_)`);
      continue;
    }

    if (typeof child === 'string') {
      if (/\r|\n/.test(child)) {
        report.error(path, 'a .lang entry is one line — remove the newline');
        continue;
      }
      out.set(path, child);
      continue;
    }

    if (typeof child === 'object' && child !== null && !Array.isArray(child)) {
      if (depth + 1 >= MAX_DEPTH) {
        report.error(path, `nesting deeper than ${MAX_DEPTH} levels degrades the typed key union to string`);
        continue;
      }
      for (const [p, v] of flattenResources(child, report, path, depth + 1)) out.set(p, v);
      continue;
    }

    report.error(path, `values must be strings or nested objects, got ${Array.isArray(child) ? 'array' : typeof child}`);
  }

  return out;
}

/**
 * Locale parity, both directions. Missing keys mean a player sees raw keys;
 * extra keys almost always mean a rename landed in one file and not the other.
 * A locale-only plural variant whose group the default locale declares is NOT
 * extra — CLDR categories legitimately differ per locale (Czech `few`,
 * Arabic `two`).
 *
 * @param {Map<string, string>} defaultMap
 * @param {Map<string, string>} localeMap
 * @returns {{ missing: string[], extra: string[] }}
 */
export function checkParity(defaultMap, localeMap) {
  const missing = [...defaultMap.keys()].filter((k) => !localeMap.has(k));
  const extra = [...localeMap.keys()].filter((k) => {
    if (defaultMap.has(k)) return false;
    const base = pluralBase(k);
    return base === undefined || !defaultMap.has(`${base}_other`);
  });
  return { missing, extra };
}

/**
 * Per shared key, the variable SET must match the default locale's (order is
 * free — positional slots come from the default order). A drifted set means
 * arguments silently landing in the wrong placeholders, or not at all.
 *
 * @param {Map<string, string>} defaultMap
 * @param {Map<string, string>} localeMap
 * @returns {Array<{ path: string, expected: string[], got: string[] }>}
 */
export function checkVarParity(defaultMap, localeMap) {
  const drifted = [];
  for (const [path, template] of localeMap) {
    // A locale-only plural variant answers to its group's `_other` reference.
    const base = pluralBase(path);
    const reference = defaultMap.get(path)
      ?? (base === undefined ? undefined : defaultMap.get(`${base}_other`));
    if (reference === undefined) continue;
    const expected = templateVars(reference).sort();
    const got = templateVars(template).sort();
    if (expected.join('\0') !== got.join('\0')) drifted.push({ path, expected, got });
  }
  return drifted;
}

const PLURAL_RE = new RegExp(`^(.*)_(${PLURAL_SUFFIXES.join('|')})$`);

/**
 * Every plural group needs its `_other` — it is the universal fallback
 * category, and a group without it resolves to nothing for most counts.
 *
 * @param {Map<string, string>} map
 * @returns {string[]} base paths missing `_other`
 */
export function checkPlurals(map) {
  const bases = new Set();
  for (const path of map.keys()) {
    const m = PLURAL_RE.exec(path);
    if (m) bases.add(m[1]);
  }
  return [...bases].filter((base) => !map.has(`${base}_other`)).sort();
}

/** The plural base of a path, or undefined when it carries no plural suffix. */
export function pluralBase(path) {
  const m = PLURAL_RE.exec(path);
  return m ? m[1] : undefined;
}
