// @bedrock-core/regolith-filters — i18n
// Nested TypeScript objects (packs/data/i18n/<locale>.ts) are the source of
// truth for the addon's text. This filter generates everything downstream:
//   1. RP/texts/<locale>.lang — namespaced entries the client resolves per
//      player (marker-delimited section, coexists with the guides filter),
//   2. data/i18n/i18n.generated.json — the runtime bundle (flat per-locale
//      tables in {{var}} form + recorded argument order), written in the
//      Regolith temp workspace and inlined by the bundler via the
//      '@bedrock-core/generated/i18n' alias,
//   3. committed .d.ts files back in the project (changed-only writes), so
//      t()/key()/raw() autocomplete without ever running a build.
//
// Library resources (dependencies declaring bedrockCore.i18n) fold in under
// their namespace branch; vanilla keys are typed always, bundled only where
// referenced, and never emitted into the RP.
//
// MUST run BEFORE the bundler filter, and after guides if you use it.

import fs from 'node:fs';
import path from 'node:path';

import { bundleDtsText } from './lib/dts.js';
import { flattenNesting, templateVars, toPositional } from './lib/interp.js';
import { parseLang, stripGeneratedSection, upsertGeneratedSection } from './lib/lang.js';
import { discoverI18nLibs, libLocaleFiles } from './lib/libs.js';
import { loadTsModule } from './lib/load.js';
import { scanNamespace, scanVanillaUsage, walkSources } from './lib/scan.js';
import { checkParity, checkPlurals, checkVarParity, flattenResources, pluralBase } from './lib/tree.js';
import { fetchVanillaLang, vanillaDtsText, VANILLA_LANG_URL_TEMPLATE } from './lib/vanilla.js';

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

const projectRoot = process.env['ROOT_DIR'];
if (!projectRoot) {
  console.error('❌ ROOT_DIR environment variable not set');
  console.error('This filter must be run by Regolith');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const defaults = {
  namespace: '',
  defaultLocale: 'en_US',
  sourceDir: 'data/i18n',
  vanilla: true,
  vanillaLangUrlTemplate: VANILLA_LANG_URL_TEMPLATE,
  cacheMaxAgeHours: 24,
  strict: true,
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);

const cwd = process.cwd();
const cacheDir = path.join(projectRoot, '.regolith', 'cache', 'i18n');

console.log('🌐 @bedrock-core/i18n');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', cwd);

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

let errorCount = 0;
let warningCount = 0;

const report = {
  warn(scope, msg) {
    warningCount++;
    // stdout, not console.warn — Regolith tags stderr lines as [ERROR]
    console.log(`⚠️  ${scope}: ${msg}`);
  },
  error(scope, msg) {
    errorCount++;
    console.error(`❌ ${scope}: ${msg}`);
  },
};

/** Strict-gated problem: an error normally, a warning with `strict: false`. */
function problem(scope, msg) {
  if (settings.strict) report.error(scope, msg);
  else report.warn(scope, msg);
}

/** First few entries of a long list, for readable diagnostics. */
function summarize(list, cap = 8) {
  return list.length <= cap ? list.join(', ') : `${list.slice(0, cap).join(', ')} … +${list.length - cap} more`;
}

// ---------------------------------------------------------------------------
// Bedrock locale codes (the set the vanilla client ships)
// ---------------------------------------------------------------------------

const BEDROCK_LOCALES = new Set([
  'bg_BG', 'cs_CZ', 'da_DK', 'de_DE', 'el_GR', 'en_GB', 'en_US', 'es_ES', 'es_MX',
  'fi_FI', 'fr_CA', 'fr_FR', 'hu_HU', 'id_ID', 'it_IT', 'ja_JP', 'ko_KR', 'nb_NO',
  'nl_NL', 'pl_PL', 'pt_BR', 'pt_PT', 'ru_RU', 'sk_SK', 'sv_SE', 'tr_TR', 'uk_UA',
  'zh_CN', 'zh_TW',
]);

const LOCALE_FILE_RE = /^([a-z]{2}_[A-Z]{2})\.ts$/;

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function writeLangSection(locale, entries) {
  const textsDir = path.join(cwd, 'RP', 'texts');
  fs.mkdirSync(textsDir, { recursive: true });
  const langPath = path.join(textsDir, `${locale}.lang`);
  const existing = fs.existsSync(langPath) ? fs.readFileSync(langPath, 'utf-8') : '';
  fs.writeFileSync(langPath, upsertGeneratedSection(existing, entries), 'utf-8');
  console.log(`✅ RP/texts/${locale}.lang — ${entries.size} generated keys`);
}

function updateLanguagesJson(locales) {
  const languagesPath = path.join(cwd, 'RP', 'texts', 'languages.json');
  let existing = [];
  if (fs.existsSync(languagesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(languagesPath, 'utf-8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      report.warn('languages.json', 'RP/texts/languages.json is not valid JSON — rewriting it');
    }
  }
  const merged = [...new Set([...existing, ...locales])];
  if (merged.length !== existing.length) {
    fs.writeFileSync(languagesPath, JSON.stringify(merged, null, '\t') + '\n', 'utf-8');
    console.log(`✅ RP/texts/languages.json — ${merged.length} languages`);
  }
}

/**
 * The committed .d.ts files live in the real project (they are what the IDE
 * reads), so they are written straight to ROOT_DIR — but only when content
 * actually changed, to keep watch mode from re-triggering itself.
 */
function writeProjectFileIfChanged(relPath, content) {
  const abs = path.join(projectRoot, relPath);
  if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf-8') === content) return;
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, 'utf-8');
  console.log(`✅ ${relPath} — regenerated`);
}

/** Regolith's data path on real disk (packs/data unless the project moved it). */
function projectDataPath() {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(projectRoot, 'config.json'), 'utf-8'));
    if (typeof config?.regolith?.dataPath === 'string') return config.regolith.dataPath;
  } catch {
    // fall through to the default
  }
  return 'packs/data';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const srcRoot = path.join(cwd, settings.sourceDir);
  if (!fs.existsSync(srcRoot)) {
    console.log(`ℹ️  ${settings.sourceDir} not found — no translations to compile`);
    return;
  }

  // ── Discover authored locales ─────────────────────────────────────────────
  const locales = [];
  for (const entry of fs.readdirSync(srcRoot).sort()) {
    if (entry.endsWith('.d.ts') || entry.endsWith('.generated.json')) continue;
    const m = LOCALE_FILE_RE.exec(entry);
    if (!m) {
      if (entry.endsWith('.ts')) problem(entry, 'not a locale resource file — expected <xx_YY>.ts');
      continue;
    }
    if (!BEDROCK_LOCALES.has(m[1])) {
      problem(entry, `"${m[1]}" is not a locale code the Bedrock client ships — players can never select it`);
    }
    locales.push(m[1]);
  }

  if (locales.length === 0) {
    console.log(`ℹ️  no locale files under ${settings.sourceDir}/ — nothing to do`);
    return;
  }
  if (!locales.includes(settings.defaultLocale)) {
    report.error(settings.sourceDir, `default locale "${settings.defaultLocale}" has no ${settings.defaultLocale}.ts — it defines the shape, so it must exist`);
    process.exit(1);
  }
  console.log('🈯 Locales:', locales.join(', '));

  // ── Load and flatten own resources ────────────────────────────────────────
  const moduleCache = path.join(cacheDir, 'modules');
  /** @type {Map<string, Map<string, string>>} locale → path → template */
  const ownRaw = new Map();
  for (const locale of locales) {
    const abs = path.join(srcRoot, `${locale}.ts`);
    try {
      const mod = await loadTsModule(abs, moduleCache);
      ownRaw.set(locale, flattenResources(mod, {
        error: (scope, msg) => report.error(`[${locale}] ${scope}`, msg),
      }));
    } catch (err) {
      report.error(`[${locale}]`, `failed to load ${settings.sourceDir}/${locale}.ts: ${err instanceof Error ? err.message : String(err)}`);
      ownRaw.set(locale, new Map());
    }
  }

  // ── Discover and load library resources ───────────────────────────────────
  let libs = [];
  try {
    libs = discoverI18nLibs(projectRoot);
  } catch (err) {
    report.error('libraries', err instanceof Error ? err.message : String(err));
  }

  /**
   * namespace → {
   *   byLocale: Map<locale, Map<path, template>>   (paths WITHOUT the ns prefix)
   *   allPaths: Set<path>, typeRefs: string[], names: string[]
   * }
   */
  const libGroups = new Map();
  for (const lib of libs) {
    if (lib.namespace === 'vanilla') {
      report.error(lib.name, 'library namespace "vanilla" is reserved');
      continue;
    }
    const files = libLocaleFiles(lib);
    if (files.size === 0) {
      report.warn(lib.name, `declares bedrockCore.i18n but ${lib.dir} has no <xx_YY>.ts files`);
      continue;
    }
    let group = libGroups.get(lib.namespace);
    if (!group) {
      group = { byLocale: new Map(), allPaths: new Set(), typeRefs: [], names: [] };
      libGroups.set(lib.namespace, group);
    }
    group.names.push(lib.name);
    const typeLocale = files.has(settings.defaultLocale) ? settings.defaultLocale
      : files.has('en_US') ? 'en_US' : [...files.keys()].sort()[0];
    group.typeRefs.push(`${lib.name}/i18n/${typeLocale}`);

    for (const [locale, absPath] of files) {
      let flat;
      try {
        flat = flattenResources(await loadTsModule(absPath, moduleCache), {
          error: (scope, msg) => report.error(`[${lib.name} ${locale}] ${scope}`, msg),
        });
      } catch (err) {
        report.error(`[${lib.name} ${locale}]`, `failed to load resources: ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }
      let table = group.byLocale.get(locale);
      if (!table) {
        table = new Map();
        group.byLocale.set(locale, table);
      }
      for (const [p, v] of flat) {
        const existing = table.get(p);
        if (existing !== undefined && existing !== v) {
          report.error(`[${lib.namespace}] ${p}`, `defined by more than one package with different values (${group.names.join(', ')})`);
          continue;
        }
        table.set(p, v);
        group.allPaths.add(p);
      }
    }
  }

  for (const [ns, group] of libGroups) {
    const defaultTable = group.byLocale.get(settings.defaultLocale) ?? group.byLocale.get('en_US')
      ?? group.byLocale.get([...group.byLocale.keys()].sort()[0]);
    group.defaultTable = defaultTable ?? new Map();
    console.log(`📚 library namespace "${ns}" (${group.names.join(', ')}): ${group.allPaths.size} keys, ${group.byLocale.size} locales`);
  }

  // ── Split own resources: root keys vs library overrides vs reserved ───────
  /** @type {Map<string, Map<string, string>>} */
  const own = new Map();
  /** @type {Map<string, Map<string, string>>} locale → ns-prefixed path → template */
  const overrides = new Map();

  for (const locale of locales) {
    const roots = new Map();
    const over = new Map();
    for (const [p, v] of ownRaw.get(locale)) {
      const first = p.split('.')[0];
      if (first === 'vanilla') {
        report.error(`[${locale}] ${p}`, 'the "vanilla" branch is reserved — those strings already ship with the client');
        continue;
      }
      const group = libGroups.get(first);
      if (group) {
        const libPath = p.slice(first.length + 1);
        if (!group.allPaths.has(libPath)) {
          problem(`[${locale}] ${p}`, `no library under "${first}" defines this path — overrides must target existing keys`);
          continue;
        }
        over.set(p, v);
        continue;
      }
      roots.set(p, v);
    }
    own.set(locale, roots);
    overrides.set(locale, over);
  }

  const ownDefault = own.get(settings.defaultLocale);

  // ── Checks: parity, interpolation variables, plurals ──────────────────────
  for (const locale of locales) {
    if (locale === settings.defaultLocale) continue;

    const { missing, extra } = checkParity(ownDefault, own.get(locale));
    if (missing.length > 0) problem(`[${locale}] parity`, `${missing.length} keys missing (filled from ${settings.defaultLocale}): ${summarize(missing)}`);
    if (extra.length > 0) problem(`[${locale}] parity`, `${extra.length} keys have no ${settings.defaultLocale} counterpart (rename drift?) and were dropped: ${summarize(extra)}`);

    for (const { path: p, expected, got } of checkVarParity(ownDefault, own.get(locale))) {
      problem(`[${locale}] ${p}`, `interpolation variables drifted — ${settings.defaultLocale} has {${expected.join(', ')}}, this locale has {${got.join(', ')}}`);
    }
  }

  for (const [locale, over] of overrides) {
    for (const [p, v] of over) {
      const ns = p.split('.')[0];
      const libTemplate = libGroups.get(ns).defaultTable.get(p.slice(ns.length + 1));
      if (libTemplate === undefined) continue;
      const expected = templateVars(libTemplate).sort();
      const got = templateVars(v).sort();
      if (expected.join('\0') !== got.join('\0')) {
        problem(`[${locale}] ${p}`, `override must keep the library's interpolation variables {${expected.join(', ')}}, got {${got.join(', ')}}`);
      }
    }
  }

  {
    const combined = new Map(ownDefault);
    for (const [ns, group] of libGroups) {
      for (const [p, v] of group.defaultTable) combined.set(`${ns}.${p}`, v);
    }
    for (const base of checkPlurals(combined)) {
      problem(base, 'plural group is missing its _other form — the universal fallback category');
    }
  }

  // ── Namespace ─────────────────────────────────────────────────────────────
  const scriptSources = walkSources(path.join(cwd, 'BP', 'scripts'));
  let namespace = settings.namespace;
  if (namespace) {
    if (!/^[a-z0-9_]+$/.test(namespace)) {
      report.error('namespace', `"${namespace}" must be lowercase a-z0-9_`);
    } else {
      console.log(`🏷️  Namespace (from settings): ${namespace}`);
    }
  } else {
    const scanned = scanNamespace(scriptSources);
    if ('namespace' in scanned) {
      namespace = scanned.namespace;
      console.log(`🏷️  Namespace (from core.register): ${namespace}`);
    } else {
      report.error('namespace', `${scanned.reason} — write creator/pack as string literals in core.register(), or set the "namespace" filter setting`);
    }
  }
  // ── Vanilla ───────────────────────────────────────────────────────────────
  /** @type {Map<string, Map<string, string>>} locale → 'vanilla.'-prefixed key → string */
  const vanillaEntries = new Map();
  let vanillaKeySet = new Set();

  if (settings.vanilla) {
    const fetchOpts = {
      urlTemplate: settings.vanillaLangUrlTemplate,
      cacheDir,
      maxAgeHours: settings.cacheMaxAgeHours,
      log: (msg) => console.log(msg),
    };
    const vanillaDefault = await fetchVanillaLang(settings.defaultLocale, fetchOpts);
    vanillaKeySet = new Set(Object.keys(vanillaDefault));

    const usageSources = [...scriptSources];
    for (const lib of libs) usageSources.push(...walkSources(path.join(lib.pkgDir, 'src')));
    const used = [...scanVanillaUsage(usageSources, vanillaKeySet)].sort();
    console.log(`🔎 Vanilla keys referenced by scripts: ${used.length} (of ${vanillaKeySet.size})`);

    for (const locale of locales) {
      let table = vanillaDefault;
      if (locale !== settings.defaultLocale) {
        try {
          table = await fetchVanillaLang(locale, fetchOpts);
        } catch (err) {
          report.warn(`[${locale}] vanilla`, `${err instanceof Error ? err.message : String(err)} — falling back to ${settings.defaultLocale} strings`);
        }
      }
      const entries = new Map();
      for (const key of used) entries.set(`vanilla.${key}`, table[key] ?? vanillaDefault[key]);
      vanillaEntries.set(locale, entries);
    }
  }

  if (errorCount > 0) {
    console.error(`❌ i18n filter failed with ${errorCount} error(s)`);
    process.exit(1);
  }

  // ── Assemble per-locale tables ($t-flattened, in path space) ──────────────
  /** @type {Map<string, Map<string, string>>} */
  const tables = new Map();
  for (const locale of locales) {
    const combined = new Map();
    for (const [ns, group] of libGroups) {
      const table = group.byLocale.get(locale) ?? group.defaultTable;
      for (const p of [...group.allPaths].sort()) {
        const v = table.get(p) ?? group.defaultTable.get(p);
        if (v !== undefined) combined.set(`${ns}.${p}`, v);
      }
    }
    for (const [p, v] of overrides.get(locale)) combined.set(p, v);
    // Own keys iterate the DEFAULT locale's key set: parity already flagged
    // drift, this fills gaps and drops extras deterministically.
    const localeOwn = own.get(locale);
    for (const [p, defaultValue] of ownDefault) combined.set(p, localeOwn.get(p) ?? defaultValue);
    // …except locale-only plural variants, which are legitimate: CLDR
    // categories differ per locale (Czech `few`, Arabic `two`). Keep them when
    // the default locale declares the group.
    for (const [p, v] of localeOwn) {
      if (combined.has(p)) continue;
      const base = pluralBase(p);
      if (base !== undefined && ownDefault.has(`${base}_other`)) combined.set(p, v);
    }

    const flattened = new Map();
    for (const [p, v] of combined) {
      flattened.set(p, flattenNesting(v, (ref) => combined.get(ref), (msg) => problem(`[${locale}] ${p}`, msg)));
    }
    tables.set(locale, flattened);
  }

  // ── Recorded argument order (defining locale appearance order) ────────────
  // Default locale first so shared keys keep its order; locale-only plural
  // variants pick their order up from the locale that defines them.
  const args = {};
  for (const locale of [settings.defaultLocale, ...locales]) {
    for (const [p, v] of tables.get(locale) ?? []) {
      if (args[p] !== undefined) continue;
      const vars = templateVars(v);
      if (vars.length > 0) args[p] = vars;
    }
  }

  // ── Lang passthrough: hand-written + guides-filter entries ──────────────────
  // Every real key already in the pack's .lang (guide prose, pack.name,
  // anything hand-written) rides in the bundle under `extra` so the layout
  // engine can still measure it. Our own generated section is stripped first
  // — those keys re-enter through the tables. This is the ONLY side channel:
  // everything a library contributes is typed resources.
  const extra = {};
  for (const locale of locales) {
    const merged = {};
    for (const relPath of [`RP/texts/${locale}.lang`, `BP/texts/${locale}.lang`]) {
      const absPath = path.join(cwd, relPath);
      if (!fs.existsSync(absPath)) continue;
      Object.assign(merged, parseLang(stripGeneratedSection(fs.readFileSync(absPath, 'utf-8'))));
    }
    if (Object.keys(merged).length > 0) {
      extra[locale] = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
    }
  }

  // ── Emit .lang sections ───────────────────────────────────────────────────
  for (const locale of locales) {
    const entries = new Map();
    for (const [p, v] of tables.get(locale) ?? []) {
      const realKey = libGroups.has(p.split('.')[0]) ? p : `${namespace}.${p}`;
      try {
        entries.set(realKey, toPositional(v, args[p] ?? []));
      } catch (err) {
        report.error(`[${locale}] ${p}`, err instanceof Error ? err.message : String(err));
      }
    }
    writeLangSection(locale, entries);
  }
  updateLanguagesJson(locales);

  // ── Runtime bundle (temp workspace — inlined by the bundler) ──────────────
  const bundle = {
    namespace,
    defaultLocale: settings.defaultLocale,
    libs: [...libGroups.keys()].sort(),
    args: Object.fromEntries(Object.keys(args).sort().map((k) => [k, args[k]])),
    extra,
    locales: {},
  };
  for (const locale of locales) {
    const merged = { ...Object.fromEntries(tables.get(locale)), ...Object.fromEntries(vanillaEntries.get(locale) ?? []) };
    bundle.locales[locale] = Object.fromEntries(Object.keys(merged).sort().map((k) => [k, merged[k]]));
  }
  const bundlePath = path.join(srcRoot, 'i18n.generated.json');
  fs.writeFileSync(bundlePath, JSON.stringify(bundle, null, '\t'), 'utf-8');
  console.log(`✅ ${settings.sourceDir}/i18n.generated.json — ${Object.keys(bundle.locales).length} locales`);

  // ── Committed declarations (real project, changed-only) ───────────────────
  const dataPath = projectDataPath();
  writeProjectFileIfChanged(path.join(dataPath, 'i18n', 'i18n.generated.d.ts'), bundleDtsText({
    defaultLocale: settings.defaultLocale,
    vanilla: settings.vanilla,
    libs: [...libGroups.entries()].sort(([a], [b]) => a.localeCompare(b))
      .map(([ns, group]) => ({ namespace: ns, typeRefs: group.typeRefs.sort() })),
  }));
  if (settings.vanilla) {
    writeProjectFileIfChanged(path.join(dataPath, 'i18n', 'vanilla.generated.d.ts'), vanillaDtsText(vanillaKeySet));
  }

  if (errorCount > 0) {
    console.error(`❌ i18n filter failed with ${errorCount} error(s)`);
    process.exit(1);
  }
  if (warningCount > 0) console.log(`⚠️  finished with ${warningCount} warning(s)`);
}

try {
  await main();
} catch (err) {
  console.error('❌ i18n filter failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
}
