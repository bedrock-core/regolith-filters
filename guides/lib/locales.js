// Cross-locale parity: every locale must end up with the exact key set the
// default locale produced. Missing keys are filled with default-locale values
// (the client then falls back to readable text instead of a raw key); extra
// keys mean structural drift and are dropped — the manifest never references
// them.

/**
 * @param {Map<string, string>} defaultLang  default-locale key→value
 * @param {Map<string, string>} localeLang   this locale's key→value
 * @returns {{ filled: Map<string, string>, missing: string[], extra: string[] }}
 */
export function reconcileLocale(defaultLang, localeLang) {
  const filled = new Map();
  const missing = [];
  const extra = [];

  for (const [key, defaultValue] of defaultLang) {
    if (localeLang.has(key)) {
      filled.set(key, localeLang.get(key));
    } else {
      filled.set(key, defaultValue);
      missing.push(key);
    }
  }

  for (const key of localeLang.keys()) {
    if (!defaultLang.has(key)) extra.push(key);
  }

  return { filled, missing, extra };
}

/**
 * Compress a flat key list into per-page counts for readable warnings:
 * ['bcg.ns.a.b0','bcg.ns.a.b1','bcg.ns.c.title'] → ['a (2 keys)', 'c (1 key)']
 */
export function summarizeKeysByPage(keys, prefix) {
  const counts = new Map();
  for (const key of keys) {
    const rest = key.startsWith(`${prefix}.`) ? key.slice(prefix.length + 1) : key;
    const page = rest.replace(/\.(title|b\d+.*|t)$/, '');
    counts.set(page, (counts.get(page) ?? 0) + 1);
  }
  return [...counts.entries()].map(([page, n]) => `${page} (${n} key${n === 1 ? '' : 's'})`);
}
