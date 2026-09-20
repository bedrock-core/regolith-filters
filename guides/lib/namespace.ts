// The addon namespace, scanned out of the sources rather than configured.
//
// `core.register({ manifest: { creator, pack } })` already carries the two
// fields the server runtime joins at startup, so reading the string literals
// back keeps the build-time key prefix and the runtime state namespace from
// diverging. The i18n and ui-compiler filters resolve it the same way.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs)$/;
const CREATOR_RE = /\bcreator\s*:\s*(['"`])([a-z0-9_]+)\1/g;
const PACK_RE = /\bpack\s*:\s*(['"`])([a-z0-9_]+)\1/g;

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules') walk(abs, out);
      continue;
    }
    if (SOURCE_RE.test(entry.name) && !entry.name.endsWith('.d.ts')) out.push(abs);
  }
  return out;
}

/**
 * Derive `creator_pack` from the register call's literals under `dir`. Only
 * files containing a `.register(` call are read, so unrelated `creator:` and
 * `pack:` properties elsewhere don't poison the scan. Exactly one distinct
 * value per field must remain — otherwise the reason names what went wrong and
 * the `namespace` setting takes over.
 */
export function scanNamespace(dir: string): { namespace: string } | { reason: string } {
  const creators = new Set<string>();
  const packs = new Set<string>();

  for (const file of walk(dir)) {
    const text = fs.readFileSync(file, 'utf-8');
    if (!text.includes('.register(')) continue;
    for (const m of text.matchAll(CREATOR_RE)) if (m[2] !== undefined) creators.add(m[2]);
    for (const m of text.matchAll(PACK_RE)) if (m[2] !== undefined) packs.add(m[2]);
  }

  if (creators.size === 1 && packs.size === 1) {
    return { namespace: `${[...creators][0]}_${[...packs][0]}` };
  }
  if (creators.size === 0 || packs.size === 0) {
    return { reason: 'no core.register({ manifest: { creator, pack } }) string literals found' };
  }
  return {
    reason: `ambiguous register literals (creator: ${[...creators].join('/')}, pack: ${[...packs].join('/')})`,
  };
}
