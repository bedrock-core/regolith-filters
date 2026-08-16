// Interpolation contract: {{var}} templates → Minecraft positional %N$s form.
// The same conversion runs at runtime in @bedrock-core/i18n when it publishes
// tables to replicated state — test/contract.test.js pins both sides to a
// shared table so they cannot drift apart silently.

const VAR_RE = /\{\{\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*\}\}/g;

/**
 * Variable names in order of first appearance, deduplicated. This order (taken
 * from the DEFAULT locale) is the recorded argument order: every locale maps
 * the same variable to the same positional slot, so a translation may reorder
 * text freely without reordering arguments.
 *
 * @param {string} template
 * @returns {string[]}
 */
export function templateVars(template) {
  const seen = [];
  for (const m of template.matchAll(VAR_RE)) {
    if (!seen.includes(m[1])) seen.push(m[1]);
  }
  return seen;
}

/**
 * Rewrite `{{var}}` to `%N$s`, N being the 1-based index in `order`.
 * A variable missing from `order` throws — callers validate variable parity
 * against the default locale before converting.
 *
 * @param {string} template
 * @param {readonly string[]} order
 * @returns {string}
 */
export function toPositional(template, order) {
  return template.replace(VAR_RE, (_, name) => {
    const idx = order.indexOf(name);
    if (idx === -1) throw new Error(`variable {{${name}}} is not in the recorded order [${order.join(', ')}]`);
    return `%${idx + 1}$s`;
  });
}

const NEST_RE = /\$t\(\s*([A-Za-z0-9_.]+)\s*\)/g;

/**
 * Inline `$t(other.key)` references — Bedrock .lang has no nesting, so they
 * are flattened at build time, recursively. `lookup` resolves a flat path to
 * its template within the same locale. Unknown references and cycles are
 * reported through `onError` and replaced with ''.
 *
 * @param {string} template
 * @param {(path: string) => string | undefined} lookup
 * @param {(msg: string) => void} onError
 * @param {string[]} [stack]
 * @returns {string}
 */
export function flattenNesting(template, lookup, onError, stack = []) {
  return template.replace(NEST_RE, (_, ref) => {
    if (stack.includes(ref)) {
      onError(`circular $t() reference: ${[...stack, ref].join(' → ')}`);
      return '';
    }
    const target = lookup(ref);
    if (target === undefined) {
      onError(`$t(${ref}) references an unknown key`);
      return '';
    }
    return flattenNesting(target, lookup, onError, [...stack, ref]);
  });
}
