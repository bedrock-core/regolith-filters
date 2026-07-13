/** Collecting reporter for tests. */
export function makeReport() {
  const warnings = [];
  const errors = [];
  return {
    warnings,
    errors,
    warn: (scope, msg) => warnings.push(`${scope}: ${msg}`),
    error: (scope, msg) => errors.push(`${scope}: ${msg}`),
  };
}

/** Single-page inline reporter (compile-level ctx). */
export function makeInlineReport() {
  const warnings = [];
  const errors = [];
  return {
    warnings,
    errors,
    warn: (msg) => warnings.push(msg),
    error: (msg) => errors.push(msg),
  };
}
