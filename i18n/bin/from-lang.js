#!/usr/bin/env node
// Migration from translation-keys / hand-written .lang to TS-first authoring.
//
// Reads every RP/BP texts/<locale>.lang in the project, takes the keys under
// YOUR namespace prefix, and writes them back as nested TypeScript resource
// modules in <dataPath>/i18n/<locale>.ts — the i18n filter's authoring format.
//
//   node bin/from-lang.js --namespace drav0011_economy [--force]
//
// Omit --namespace to derive it from the core.register({ creator, pack })
// literals in your scripts. Non-destructive: .lang files are left untouched;
// the summary lists what moved and what stayed (un-namespaced keys such as
// pack.name, guide sections, other addons' keys). After checking the generated
// modules in, delete the migrated lines from .lang — the filter regenerates
// them, namespaced identically, inside its marker section.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

import { parseLang } from '../lib/lang.js';
import { scanNamespace, walkSources } from '../lib/scan.js';

// ---------------------------------------------------------------------------
// Arguments & project layout
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const force = argv.includes('--force');
const nsFlag = argv.indexOf('--namespace');
let namespace = nsFlag === -1 ? '' : (argv[nsFlag + 1] ?? '');

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, 'config.json');

if (!fs.existsSync(configPath)) {
  console.error('❌ no config.json here — run from your Regolith project root');
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
const dataPath = config?.regolith?.dataPath ?? 'packs/data';
const rpDir = config?.packs?.resourcePack ?? './packs/RP';
const bpDir = config?.packs?.behaviorPack ?? './packs/BP';

if (!namespace) {
  const scanned = scanNamespace(walkSources(path.join(projectRoot, bpDir, 'scripts')));
  if ('namespace' in scanned) {
    namespace = scanned.namespace;
    console.log(`🏷️  Namespace (from core.register): ${namespace}`);
  } else {
    console.error(`❌ ${scanned.reason} — pass --namespace <creator_pack>`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Collect .lang entries per locale (RP first, BP overrides — mirroring the
// merge order translation-keys used), skipping generated marker sections.
// ---------------------------------------------------------------------------

/** Strip every marker-delimited generated section (guides, i18n — any `## <core…>` pair). */
function stripGeneratedSections(content) {
  return content.replace(/^## <core[^\n]*:begin>[\s\S]*?(?:^## <core[^\n]*:end>[^\n]*\n?|(?![\s\S]))/gm, '');
}

const byLocale = new Map();

for (const packDir of [rpDir, bpDir]) {
  const textsDir = path.join(projectRoot, packDir, 'texts');
  if (!fs.existsSync(textsDir)) continue;

  for (const entry of fs.readdirSync(textsDir)) {
    const m = /^([a-z]{2}_[A-Z]{2})\.lang$/.exec(entry);
    if (!m) continue;

    const parsed = parseLang(stripGeneratedSections(fs.readFileSync(path.join(textsDir, entry), 'utf-8')));
    const existing = byLocale.get(m[1]) ?? {};
    byLocale.set(m[1], { ...existing, ...parsed });
  }
}

if (byLocale.size === 0) {
  console.log('ℹ️  no <locale>.lang files found — nothing to migrate');
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Partition, nest, and emit
// ---------------------------------------------------------------------------

/** Set `value` at a dot path inside `tree`; returns a conflict description or null. */
function setPath(tree, dotPath, value) {
  const segments = dotPath.split('.');
  let node = tree;

  for (const [i, segment] of segments.entries()) {
    if (i === segments.length - 1) {
      if (typeof node[segment] === 'object') { return 'is also a branch (has longer sibling keys)'; }
      node[segment] = value;
      return null;
    }
    if (typeof node[segment] === 'string') { return `collides with the shorter key at "${segments.slice(0, i + 1).join('.')}"`; }
    node[segment] = node[segment] ?? {};
    node = node[segment];
  }

  return null;
}

const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function emitTree(node, indent) {
  const pad = '  '.repeat(indent);
  const lines = ['{'];
  for (const key of Object.keys(node)) {
    const prop = IDENT_RE.test(key) ? key : `'${key}'`;
    const value = node[key];
    if (typeof value === 'string') {
      lines.push(`${pad}  ${prop}: '${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}',`);
    } else {
      lines.push(`${pad}  ${prop}: ${emitTree(value, indent + 1)},`);
    }
  }
  lines.push(`${pad}}`);
  return lines.join('\n');
}

const outDir = path.join(projectRoot, dataPath, 'i18n');
const prefix = `${namespace}.`;
let wrote = 0;

for (const [locale, entries] of [...byLocale.entries()].sort()) {
  const tree = {};
  const skipped = [];
  const conflicts = [];

  for (const key of Object.keys(entries).sort()) {
    if (!key.startsWith(prefix)) { skipped.push(key); continue; }
    const conflict = setPath(tree, key.slice(prefix.length), entries[key]);
    if (conflict) { conflicts.push(`${key} ${conflict}`); }
  }

  const own = Object.keys(entries).length - skipped.length - conflicts.length;
  if (own === 0) {
    console.log(`ℹ️  [${locale}] no keys under "${prefix}" — skipped (${skipped.length} foreign keys left in .lang)`);
    continue;
  }

  const outFile = path.join(outDir, `${locale}.ts`);
  if (fs.existsSync(outFile) && !force) {
    console.error(`❌ [${locale}] ${path.relative(projectRoot, outFile)} exists — pass --force to overwrite`);
    continue;
  }

  const header = [
    `// Migrated from .lang by the i18n filter's from-lang tool. Namespace "${namespace}"`,
    '// is stripped here and re-applied by the filter at build time.',
  ];
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outFile, `${header.join('\n')}\nexport default ${emitTree(tree, 0)} as const;\n`, 'utf-8');
  wrote++;

  console.log(`✅ [${locale}] ${own} keys → ${path.relative(projectRoot, outFile)}`);
  const positional = Object.keys(entries).filter(k => k.startsWith(prefix) && /%(?:\d+\$)?s/.test(entries[k])).length;
  if (positional > 0) console.log(`ℹ️  [${locale}] ${positional} value(s) carry %s slots — rename them to {{var}} templates to get typed, named arguments`);
  if (skipped.length > 0) console.log(`ℹ️  [${locale}] left in .lang (no "${prefix}" prefix): ${skipped.slice(0, 8).join(', ')}${skipped.length > 8 ? ` … +${skipped.length - 8} more` : ''}`);
  for (const conflict of conflicts) console.log(`⚠️  [${locale}] NOT migrated — ${conflict}; restructure by hand`);
}

if (wrote > 0) {
  console.log('\nNext: add the i18n filter to config.json (before bundler, after guides),');
  console.log('build once, then delete the migrated lines from your .lang files — the');
  console.log('filter regenerates them, namespaced identically, in its marker section.');
}
