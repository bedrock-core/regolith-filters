// @bedrock-core/regolith-filters — guides
// Compiles MDX guide content (data/guides/<locale>/**) into:
//   1. a guide IR manifest (data/guides/guides.generated.json, written in the
//      Regolith temp workspace — never synced back to the project; the bundler's
//      tsconfig-paths plugin resolves the packs/data alias against the temp
//      workspace, and the committed guides.generated.d.ts seeded by
//      `regolith install` types the module for the IDE) consumed via the
//      '@bedrock-core/generated/guides' alias, and
//   2. auto-localized .lang entries (RP/texts/<locale>.lang, marker-delimited
//      section) — long prose rides localization keys, so the client resolves
//      text per player language and the runtime's raw-text cap never applies.
//
// MUST run BEFORE the i18n filter (guide keys have to land in the bundle's
// .lang passthrough for measurement) which in turn runs before the bundler.

import fs from 'node:fs';
import path from 'node:path';
import picomatch from 'picomatch';

import { buildLocale, buildManifest } from './lib/build.js';
import { upsertGeneratedSection } from './lib/lang.js';
import { keyPrefix, sanitizeSegment } from './lib/keys.js';
import { reconcileLocale, summarizeKeysByPage } from './lib/locales.js';
import { readPngSize } from './lib/png.js';

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
  sourceDir: 'data/guides',
  defaultLocale: 'en_US',
  include: ['**/*.md', '**/*.mdx'],
  exclude: [],
  manifestPath: 'data/guides/guides.generated.json',
  maxCodeLineBytes: 60,
  strictLocales: false,
};

const argParsed = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings = Object.assign({}, defaults, argParsed);

if (!settings.namespace || sanitizeSegment(settings.namespace).length === 0) {
  console.error('❌ "namespace" setting is required (your addon namespace, e.g. "creator_pack" — keys become <namespace>.guides.*)');
  process.exit(1);
}

const cwd = process.cwd();
const sourceRoot = path.join(cwd, settings.sourceDir);
const prefix = keyPrefix(settings.namespace);
const ns = sanitizeSegment(settings.namespace);

console.log('📖 @bedrock-core/guides');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', cwd);

// ---------------------------------------------------------------------------
// Warning/error reporter
// ---------------------------------------------------------------------------

let errorCount = 0;
let warningCount = 0;

const reporterFor = (locale) => ({
  warn(scope, msg) {
    warningCount++;
    // stdout, not console.warn — Regolith tags stderr lines as [ERROR]
    console.log(`⚠️  [${locale}] ${scope}: ${msg}`);
  },
  error(scope, msg) {
    errorCount++;
    console.error(`❌ [${locale}] ${scope}: ${msg}`);
  },
});

// ---------------------------------------------------------------------------
// Discovery
// ---------------------------------------------------------------------------

/** Recursively list files under `dir` as POSIX-relative paths. */
function walkFiles(dir, base = '') {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(path.join(dir, entry.name), rel));
    else out.push(rel);
  }
  return out;
}

/**
 * Read one locale directory → page sources + category configs.
 * PageIds are extension-less POSIX paths relative to the locale root.
 */
function readLocaleDir(localeDir, report) {
  const isIncluded = picomatch(settings.include);
  const isExcluded = settings.exclude.length > 0 ? picomatch(settings.exclude) : () => false;

  const files = new Map();
  const categories = new Map();

  for (const rel of walkFiles(localeDir)) {
    const abs = path.join(localeDir, rel);
    if (path.basename(rel) === '_category_.json') {
      const dirPath = path.posix.dirname(rel);
      try {
        categories.set(dirPath === '.' ? '' : dirPath, JSON.parse(fs.readFileSync(abs, 'utf-8')));
      } catch (err) {
        report.error(rel, `invalid _category_.json: ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    if (!/\.mdx?$/i.test(rel)) continue;
    if (!isIncluded(rel) || isExcluded(rel)) continue;
    files.set(rel.replace(/\.mdx?$/i, ''), fs.readFileSync(abs, 'utf-8'));
  }

  return { files, categories };
}

/** Sniff RP texture dimensions so <img> blocks get an aspect ratio. */
function imageSize(src) {
  const abs = path.join(cwd, 'RP', ...src.split('/')) + '.png';
  try {
    return readPngSize(fs.readFileSync(abs));
  } catch {
    return undefined;
  }
}

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

/** Ensure every guide locale is listed in RP/texts/languages.json. */
function updateLanguagesJson(locales) {
  const languagesPath = path.join(cwd, 'RP', 'texts', 'languages.json');
  let existing = [];
  if (fs.existsSync(languagesPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(languagesPath, 'utf-8'));
      if (Array.isArray(parsed)) existing = parsed;
    } catch {
      console.warn('⚠️  RP/texts/languages.json is not valid JSON — rewriting it');
    }
  }
  const merged = [...new Set([...existing, ...locales])];
  if (merged.length !== existing.length) {
    fs.writeFileSync(languagesPath, JSON.stringify(merged, null, '\t') + '\n', 'utf-8');
    console.log(`✅ RP/texts/languages.json — ${merged.length} languages`);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  if (!fs.existsSync(sourceRoot)) {
    console.log(`ℹ️  ${settings.sourceDir} not found — no guides to compile`);
    return;
  }

  // Locale folders are the only directories here; the filter's own data files
  // (guides.generated.d.ts, and the .json manifest this run writes) sit beside them.
  const locales = fs
    .readdirSync(sourceRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  if (locales.length === 0) {
    console.log(`ℹ️  no locale folders under ${settings.sourceDir}/ — no guides to compile`);
    return;
  }

  if (!locales.includes(settings.defaultLocale)) {
    console.error(`❌ default locale "${settings.defaultLocale}" not found under ${settings.sourceDir}/`);
    process.exit(1);
  }

  // ── Default locale: source of structural truth ───────────────────────────
  const defaultReport = reporterFor(settings.defaultLocale);
  const { files, categories } = readLocaleDir(path.join(sourceRoot, settings.defaultLocale), defaultReport);

  if (files.size === 0) {
    console.log(`ℹ️  no guide pages in ${settings.sourceDir}/${settings.defaultLocale} — nothing to do`);
    return;
  }

  const defaultBuild = buildLocale({
    files,
    categories,
    prefix,
    maxCodeLineBytes: settings.maxCodeLineBytes,
    imageSize,
    report: defaultReport,
  });

  const manifest = buildManifest({
    build: defaultBuild,
    categories,
    prefix,
    ns,
    defaultLocale: settings.defaultLocale,
    locales,
    report: defaultReport,
  });

  console.log(`ℹ️  [${settings.defaultLocale}] ${defaultBuild.pages.size} pages, ${defaultBuild.lang.size} keys`);

  // ── Other locales: values only, keys paired structurally ─────────────────
  const localeLang = new Map([[settings.defaultLocale, defaultBuild.lang]]);
  let drift = false;

  for (const locale of locales) {
    if (locale === settings.defaultLocale) continue;
    const report = reporterFor(locale);
    const localeDir = readLocaleDir(path.join(sourceRoot, locale), report);
    const build = buildLocale({
      files: localeDir.files,
      categories: localeDir.categories,
      prefix,
      maxCodeLineBytes: settings.maxCodeLineBytes,
      linkTargets: defaultBuild.pageIds,
      imageSize,
      report,
    });

    const { filled, missing, extra } = reconcileLocale(defaultBuild.lang, build.lang);
    if (missing.length > 0) {
      drift = true;
      report.warn('parity', `${missing.length} untranslated keys filled from ${settings.defaultLocale}: ${summarizeKeysByPage(missing, prefix).join(', ')}`);
    }
    if (extra.length > 0) {
      drift = true;
      report.warn('parity', `${extra.length} keys have no ${settings.defaultLocale} counterpart (structure drift?) and were dropped: ${summarizeKeysByPage(extra, prefix).join(', ')}`);
    }
    localeLang.set(locale, filled);
    console.log(`ℹ️  [${locale}] ${build.pages.size} pages translated`);
  }

  if (errorCount > 0) {
    console.error(`❌ guides filter failed with ${errorCount} error(s)`);
    process.exit(1);
  }
  if (settings.strictLocales && drift) {
    console.error('❌ strictLocales is enabled and locales are out of sync with the default locale');
    process.exit(1);
  }

  // ── Write outputs ─────────────────────────────────────────────────────────
  const manifestPath = path.join(cwd, settings.manifestPath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, '\t'), 'utf-8');
  console.log(`✅ ${settings.manifestPath} — ${Object.keys(manifest.pages).length} pages`);

  for (const [locale, entries] of localeLang) writeLangSection(locale, entries);
  updateLanguagesJson(locales);

  if (warningCount > 0) console.log(`⚠️  finished with ${warningCount} warning(s)`);
}

try {
  main();
} catch (err) {
  console.error('❌ guides filter failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
}
