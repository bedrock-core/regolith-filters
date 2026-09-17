/** Collecting reporter for tests. */
export function makeReport() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (scope: string, msg: string) => warnings.push(`${scope}: ${msg}`),
    error: (scope: string, msg: string) => errors.push(`${scope}: ${msg}`),
  };
}

/** Single-page inline reporter (compile-level ctx). */
export function makeInlineReport() {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    warn: (msg: string) => warnings.push(msg),
    error: (msg: string) => errors.push(msg),
  };
}
