// Static scans over TypeScript sources in the temp workspace.
//
// 1. Namespace: find the `core.register({ creator: '...', pack: '...' })`
//    string literals — the same two fields the server runtime's
//    addonNamespace() joins at startup, so the build-time .lang prefix and the
//    runtime state namespace cannot diverge.
// 2. Vanilla usage: which vanilla keys the scripts reference, as string
//    literals ('item.apple.name' or 'vanilla.item.apple.name') or as selector
//    chains ($ => $.vanilla.item.apple.name). Only those keys' strings enter
//    the runtime bundle — the client already ships the full vanilla table.

import fs from 'node:fs';
import path from 'node:path';

const SOURCE_RE = /\.(?:ts|tsx|js|jsx|mjs)$/;

/**
 * Recursively read source files under `dir` (skipping node_modules and
 * declaration files). Missing dir → empty list.
 *
 * @param {string} dir
 * @returns {Array<{ path: string, text: string }>}
 */
export function walkSources(dir) {
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...walkSources(abs));
      continue;
    }
    if (!SOURCE_RE.test(entry.name) || entry.name.endsWith('.d.ts')) continue;
    out.push({ path: abs, text: fs.readFileSync(abs, 'utf-8') });
  }
  return out;
}

const CREATOR_RE = /\bcreator\s*:\s*(['"`])([a-z0-9_]+)\1/g;
const PACK_RE = /\bpack\s*:\s*(['"`])([a-z0-9_]+)\1/g;

/**
 * Derive `creator_pack` from the register call's literals. Only files that
 * contain a `.register(` call are considered, so unrelated `creator:`/`pack:`
 * properties elsewhere don't poison the scan. Exactly one distinct value per
 * field must remain — otherwise the reason names what went wrong and the
 * `namespace` setting takes over.
 *
 * @param {Array<{ path: string, text: string }>} sources
 * @returns {{ namespace: string } | { reason: string }}
 */
export function scanNamespace(sources) {
  const creators = new Set();
  const packs = new Set();

  for (const { text } of sources) {
    if (!text.includes('.register(')) continue;
    for (const m of text.matchAll(CREATOR_RE)) creators.add(m[2]);
    for (const m of text.matchAll(PACK_RE)) packs.add(m[2]);
  }

  if (creators.size === 1 && packs.size === 1) {
    return { namespace: `${[...creators][0]}_${[...packs][0]}` };
  }
  if (creators.size === 0 || packs.size === 0) {
    return { reason: 'no core.register({ creator, pack }) string literals found' };
  }
  return {
    reason: `ambiguous register literals (creator: ${[...creators].join('/')}, pack: ${[...packs].join('/')})`,
  };
}

const STRING_LITERAL_RE = /(['"`])([^'"`\n]{1,200})\1/g;
const CHAIN_RE = /\bvanilla((?:\s*\.\s*[A-Za-z0-9_$]+)+)/g;

/**
 * Vanilla keys the sources reference. A key assembled at runtime is not a
 * literal and will not be found — the client still resolves it, but `t()`
 * falls back to the raw key and measurement for that string is approximate.
 *
 * @param {Array<{ path: string, text: string }>} sources
 * @param {Set<string>} vanillaKeys
 * @returns {Set<string>}
 */
export function scanVanillaUsage(sources, vanillaKeys) {
  const used = new Set();

  for (const { text } of sources) {
    for (const m of text.matchAll(STRING_LITERAL_RE)) {
      const raw = m[2];
      const candidate = raw.startsWith('vanilla.') ? raw.slice('vanilla.'.length) : raw;
      if (vanillaKeys.has(candidate)) used.add(candidate);
    }
    for (const m of text.matchAll(CHAIN_RE)) {
      const key = m[1].replaceAll(/\s/g, '').split('.').filter(Boolean).join('.');
      if (vanillaKeys.has(key)) used.add(key);
    }
  }

  return used;
}
