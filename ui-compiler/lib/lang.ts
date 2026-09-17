// The pack's languages, read in and written back.
//
// Text whose shape depends on what it says — a trail collapsed to the room it
// has, a paragraph broken into lines — is composed by the build once for every
// language the pack ships. So every screen's build is handed each language's
// strings, as the filters before this one left them in `RP/texts`, and what the
// screens composed is written back under the keys they minted.

import fs from 'node:fs';
import path from 'node:path';

/** Every language the pack ships and its strings, in the shape the build registers. */
export interface PackLocales {
  defaultLocale: string;
  tables: Record<string, Record<string, string>>;
}

/** The strings the compiled screens composed, by language and key. */
export type ComposedLang = Record<string, Record<string, string>>;

const SECTION_BEGIN = '## <core:generated-ui:begin> do not edit — composed per language by the ui-compiler regolith filter';
const SECTION_END = '## <core:generated-ui:end>';

/** A `.lang` file's strings. A value keeps its spaces: a piece of a line ends in the one before the next. */
export function parseLang(content: string): Record<string, string> {
  const strings: Record<string, string> = {};

  for (const raw of content.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;

    if (line.trim() === '' || line.trimStart().startsWith('#')) {
      continue;
    }

    const at = line.indexOf('=');
    const key = at === -1 ? '' : line.slice(0, at).trim();

    if (key !== '') {
      strings[key] = line.slice(at + 1);
    }
  }

  return strings;
}

/**
 * The languages `textsDir` holds: those `languages.json` lists that have a
 * `.lang` file. Undefined when there are none, and nothing is composed.
 */
export function readPackLocales(textsDir: string, defaultLocale: string): PackLocales | undefined {
  const listed = path.join(textsDir, 'languages.json');
  const names = fs.existsSync(listed)
    ? (JSON.parse(fs.readFileSync(listed, 'utf-8')) as unknown[]).filter((name): name is string => typeof name === 'string')
    : [];
  const tables = Object.fromEntries(names
    .map(name => [name, path.join(textsDir, `${name}.lang`)] as const)
    .filter(([, file]) => fs.existsSync(file))
    .map(([name, file]) => [name, parseLang(fs.readFileSync(file, 'utf-8'))]));

  if (Object.keys(tables).length === 0) {
    return undefined;
  }

  return { defaultLocale: tables[defaultLocale] === undefined ? Object.keys(tables)[0] ?? defaultLocale : defaultLocale, tables };
}

/** Every screen's composed strings as one set; two screens composing one key compose the same strings under it. */
export function mergeLang(into: ComposedLang, lang: ComposedLang | undefined): void {
  for (const [locale, strings] of Object.entries(lang ?? {})) {
    Object.assign(into[locale] ??= {}, strings);
  }
}

/** Writes each language's composed strings into its `.lang` file, as a section of their own. */
export function writeComposedLang(textsDir: string, lang: ComposedLang): number {
  let written = 0;

  for (const [locale, strings] of Object.entries(lang)) {
    const file = path.join(textsDir, `${locale}.lang`);
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : '';
    const begin = existing.indexOf(SECTION_BEGIN);
    const end = begin === -1 ? -1 : existing.indexOf(SECTION_END, begin);
    const kept = begin === -1 ? existing : existing.slice(0, begin) + (end === -1 ? '' : existing.slice(end + SECTION_END.length));
    const keys = Object.keys(strings).sort();

    fs.writeFileSync(file, [
      kept.replace(/\s*$/, ''),
      '',
      SECTION_BEGIN,
      ...keys.map(key => `${key}=${strings[key]}`),
      SECTION_END,
      '',
    ].join('\n'), 'utf-8');
    written = Math.max(written, keys.length);
  }

  return written;
}
