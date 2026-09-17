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

import { buildLocale, buildManifest, type Report } from './lib/build.ts';
import { upsertGeneratedSection } from './lib/lang.ts';
import { keyPrefix, sanitizeSegment } from './lib/keys.ts';
import { inlineLinkedText, linksByKey } from './lib/linked.ts';
import { scanNamespace } from './lib/namespace.ts';
import { reconcileLocale, summarizeKeysByPage } from './lib/locales.ts';
import { readPngSize } from './lib/png.ts';
import { guideScreenModules, guideScreenTables } from './lib/screens.ts';

// ─── Environment ──────────────────────────────────────────────────────────────

function requireProjectRoot(): string {
  const root = process.env['ROOT_DIR'];
  if (!root) {
    console.error('❌ ROOT_DIR environment variable not set');
    console.error('This filter must be run by Regolith');
    process.exit(1);
  }
  return root;
}

const projectRoot = requireProjectRoot();

// ─── Settings ─────────────────────────────────────────────────────────────────

// ─── Output layout ────────────────────────────────────────────────────────────
// The same in every filter of this repository: generated JSON is minified unless
// a profile asks for it laid out, and then `indent` and `size` say how.

/** How generated JSON is laid out. Absent or `false` writes it minified. */
interface Pretty {
  /** 'tab' or 'space'; spaces when omitted. */
  indent?: 'tab' | 'space';
  /** Characters per level: 2 spaces or 1 tab when omitted. */
  size?: number;
}

/** The indent `JSON.stringify` takes, or `undefined` for minified output. */
function indentOf(pretty: Pretty | false | undefined): string | undefined {
  if (pretty === undefined || pretty === false) return undefined;
  const tab = pretty.indent === 'tab';
  return (tab ? '\t' : ' ').repeat(Math.max(1, Math.trunc(pretty.size ?? (tab ? 1 : 2))));
}

/** A generated JSON file: laid out and newline-terminated when `pretty` says so, minified otherwise. */
function jsonText(value: unknown, pretty: Pretty | false | undefined): string {
  const indent = indentOf(pretty);
  return indent === undefined ? JSON.stringify(value) : `${JSON.stringify(value, null, indent)}\n`;
}

interface Settings {
  /** Override for the scan; empty resolves it from `core.register()`. */
  namespace: string;
  sourceDir: string;
  defaultLocale: string;
  include: string[];
  exclude: string[];
  manifestPath: string;
  maxCodeLineBytes: number;
  strictLocales: boolean;
  compileScreens: boolean;
  screensDir: string;
  screenTitle: string;
  componentsModule: string;
  /** How the JSON this filter emits is laid out. Absent or `false` writes every generated file minified. */
  pretty?: Pretty | false;
}

const defaults: Settings = {
  namespace: '',
  sourceDir: 'data/guides',
  defaultLocale: 'en_US',
  include: ['**/*.md', '**/*.mdx'],
  exclude: [],
  manifestPath: 'data/guides/guides.generated.json',
  maxCodeLineBytes: 60,
  strictLocales: false,
  compileScreens: true,
  screensDir: 'BP/scripts/guides',
  screenTitle: 'Guide',
  componentsModule: '',
};

const argParsed: Partial<Settings> = process.argv[2] ? JSON.parse(process.argv[2]) : {};
const settings: Settings = Object.assign({}, defaults, argParsed);

/** Every JSON file this filter writes, laid out as the profile asked. */
const stringify = (value: unknown): string => jsonText(value, settings.pretty);

const cwd = process.cwd();

// Every key this filter emits is prefixed with the addon's namespace, so it has
// to be the same one i18n and ui-compiler resolve: the `namespace` setting, or
// the `core.register()` literals under BP/scripts.
function resolveNamespace(): string {
  if (settings.namespace) {
    if (!/^[a-z0-9_]+$/.test(settings.namespace)) {
      console.error(`❌ namespace "${settings.namespace}" must be lowercase a-z, 0-9 and _`);
      process.exit(1);
    }
    console.log(`🏷️  Namespace (from settings): ${settings.namespace}`);
    return settings.namespace;
  }

  const scanned = scanNamespace(path.join(cwd, 'BP', 'scripts'));

  if ('reason' in scanned) {
    console.error(`❌ no namespace — ${scanned.reason}`);
    console.error('   write creator/pack as string literals in the manifest passed to core.register(), or set the "namespace" filter setting');
    process.exit(1);
  }

  console.log(`🏷️  Namespace (from core.register): ${scanned.namespace}`);
  return scanned.namespace;
}

const namespace = resolveNamespace();
const sourceRoot = path.join(cwd, settings.sourceDir);
const prefix = keyPrefix(namespace);
const ns = sanitizeSegment(namespace);

console.log('📖 @bedrock-core/guides');
console.log('📂 Project root:', projectRoot);
console.log('📂 Working directory:', cwd);

// ─── Warning/error reporter ───────────────────────────────────────────────────

let errorCount = 0;
let warningCount = 0;

const reporterFor = (locale: string): Report => ({
  warn(scope: string, msg: string): void {
    warningCount++;
    // stdout, not console.warn — Regolith tags stderr lines as [ERROR]
    console.log(`⚠️  [${locale}] ${scope}: ${msg}`);
  },
  error(scope: string, msg: string): void {
    errorCount++;
    console.error(`❌ [${locale}] ${scope}: ${msg}`);
  },
});

// ─── Discovery ────────────────────────────────────────────────────────────────

/** Recursively list files under `dir` as POSIX-relative paths. */
function walkFiles(dir: string, base = ''): string[] {
  const out: string[] = [];
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
function readLocaleDir(localeDir: string, report: Report): { files: Map<string, string>; categories: Map<string, Record<string, any>> } {
  const isIncluded = picomatch(settings.include);
  const isExcluded = settings.exclude.length > 0 ? picomatch(settings.exclude) : () => false;

  const files = new Map<string, string>();
  const categories = new Map<string, Record<string, any>>();

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
function imageSize(src: string): { w: number; h: number } | undefined {
  const abs = path.join(cwd, 'RP', ...src.split('/')) + '.png';
  try {
    return readPngSize(fs.readFileSync(abs));
  } catch {
    return undefined;
  }
}

// ─── Output helpers ───────────────────────────────────────────────────────────

function writeLangSection(locale: string, entries: Map<string, string>): void {
  const textsDir = path.join(cwd, 'RP', 'texts');
  fs.mkdirSync(textsDir, { recursive: true });
  const langPath = path.join(textsDir, `${locale}.lang`);
  const existing = fs.existsSync(langPath) ? fs.readFileSync(langPath, 'utf-8') : '';
  fs.writeFileSync(langPath, upsertGeneratedSection(existing, entries), 'utf-8');
  console.log(`✅ RP/texts/${locale}.lang — ${entries.size} generated keys`);
}

/** Ensure every guide locale is listed in RP/texts/languages.json. */
function updateLanguagesJson(locales: string[]): void {
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
    fs.writeFileSync(languagesPath, stringify(merged), 'utf-8');
    console.log(`✅ RP/texts/languages.json — ${merged.length} languages`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main(): void {
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
  const localeLinks = new Map([[settings.defaultLocale, linksByKey(defaultBuild.pages)]]);
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
    localeLinks.set(locale, linksByKey(build.pages));
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

  // Which screens to compile: every page for everyone, or — when anything is
  // gated — the pages a player may open, and every page again for operators.
  const screenInput = {
    pageIds: Object.keys(manifest.pages),
    gated: manifest.gated === true,
    gatedPageIds: Object.keys(manifest.pages).filter((pageId: string) => manifest.pages[pageId].a !== undefined),
  };

  // Each page's compiled screen name in each set, so a link inside a guide
  // reaches the module this filter names rather than re-deriving the fold at
  // runtime.
  if (settings.compileScreens) {
    const { screens, opScreens } = guideScreenTables(screenInput);

    manifest.screens = screens;
    if (opScreens !== undefined) manifest.opScreens = opScreens;
  }

  // A paragraph with links is broken into lines per language by the ui-compiler,
  // which draws it through keys of its own: it travels as its text in every
  // language, and its own key is never shipped.
  const linked = inlineLinkedText(manifest.pages, localeLang, localeLinks, settings.defaultLocale);

  if (linked > 0) console.log(`ℹ️  ${linked} paragraph(s) with links carried in every language`);

  // ── Write outputs ─────────────────────────────────────────────────────────
  const manifestPath = path.join(cwd, settings.manifestPath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, stringify(manifest), 'utf-8');
  console.log(`✅ ${settings.manifestPath} — ${Object.keys(manifest.pages).length} pages`);

  for (const [locale, entries] of localeLang) writeLangSection(locale, entries);
  updateLanguagesJson(locales);

  // One screen module per page plus the entry and the index, for the
  // ui-compiler filter to bake and the bundler to ship — a guide page is a
  // screen of its own.
  if (settings.compileScreens) {
    const modules = guideScreenModules({
      ...screenInput,
      screensDir: settings.screensDir,
      manifestPath: settings.manifestPath,
      title: settings.screenTitle,
      ...settings.componentsModule === '' ? {} : { components: settings.componentsModule },
    });

    for (const module of modules) {
      const file = path.join(cwd, module.file);

      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, module.source, 'utf-8');
    }

    console.log(`✅ ${settings.screensDir}/ — ${modules.length} screen modules${screenInput.gated ? ', a second set for operators among them' : ''}`);
  }

  if (warningCount > 0) console.log(`⚠️  finished with ${warningCount} warning(s)`);
}

try {
  main();
} catch (err) {
  console.error('❌ guides filter failed:', err instanceof Error ? (err.stack ?? err.message) : String(err));
  process.exit(1);
}
