// Locale build + manifest assembly — pure (no filesystem); main.js feeds it
// file contents and receives structures to write.

import { createAccessResolver } from './access.ts';
import { ADMONITION_COLORS, compilePage } from './compile.ts';
import { resolveInternalLink } from './inline.ts';
import { catKey, pageKey } from './keys.ts';
import { humanizeFilename, parseGuideFile } from './parse.ts';
import { buildSidebar } from './sidebar.ts';

/** Diagnostics sink; `main.ts` counts and prints these. */
export interface Report {
  warn(scope: string, msg: string): void;
  error(scope: string, msg: string): void;
}

export interface LocaleBuild {
  pages: Map<string, any>;
  lang: Map<string, string>;
  pageIds: Set<string>;
}

export interface BuildLocaleInput {
  /** PageId → MDX source */
  files: Map<string, string>;
  /** dirPath → parsed _category_.json */
  categories: Map<string, Record<string, any>>;
  /** '<ns>.guides' */
  prefix: string;
  maxCodeLineBytes: number;
  /**
   * Valid link targets; defaults to this locale's own pages. Pass the default
   * locale's set when compiling translations.
   */
  linkTargets?: Set<string>;
  imageSize?: (src: string) => { w: number; h: number } | undefined;
  report: Report;
}

/** Compile every page of one locale. */
export function buildLocale({
  files,
  categories,
  prefix,
  maxCodeLineBytes,
  linkTargets,
  imageSize,
  report,
}: BuildLocaleInput): LocaleBuild {
  const pageIds = new Set(files.keys());
  const targets = linkTargets ?? pageIds;
  const pages = new Map<string, any>();
  const lang = new Map<string, string>();

  for (const pageId of [...files.keys()].sort()) {
    let parsed: ReturnType<typeof parseGuideFile>;
    try {
      parsed = parseGuideFile(files.get(pageId)!);
    } catch (err) {
      report.error(pageId, `parse error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')) : '';
    const basename = pageId.slice(pageId.lastIndexOf('/') + 1);

    const result = compilePage(parsed.root, {
      frontmatter: parsed.frontmatter,
      key: (nodePath: string) => pageKey(prefix, pageId, nodePath),
      resolveLink: (url: string) => resolveInternalLink(url, dir, targets),
      getDefinition: parsed.getDefinition,
      imageSize,
      warn: (msg: string) => report.warn(pageId, msg),
      error: (msg: string) => report.error(pageId, msg),
      maxCodeLineBytes,
      fallbackTitle: humanizeFilename(basename),
    });

    // Sidebar row extras (Docusaurus-adjacent frontmatter): `icon` is a texture path shown as
    // the row thumbnail; `description` becomes a one-line subtitle. The icon is locale-independent;
    // the description rides this locale's .lang under a structural key so translations pair up.
    const icon = typeof parsed.frontmatter.icon === 'string' && parsed.frontmatter.icon !== ''
      ? parsed.frontmatter.icon
      : undefined;

    // The subtitle renders through localizationKey, which can't carry a § prefix — so the muted
    // grey is baked into the value (like admonition titles). A leading §7 the author can still
    // override with their own inline codes; it also guards the digit-leading-label render bug.
    let descK;
    const description = parsed.frontmatter.description;
    if (typeof description === 'string' && description.trim() !== '') {
      descK = pageKey(prefix, pageId, '_desc');
      lang.set(descK, `§7${description.trim()}`);
    }

    pages.set(pageId, { frontmatter: parsed.frontmatter, titleK: result.titleK, blocks: result.blocks, icon, descK });
    for (const [key, value] of result.lang) lang.set(key, value);
  }

  // Category labels ride the locale's .lang so translated sidebars work.
  for (const [dirPath, category] of categories) {
    if (typeof category.label === 'string') {
      lang.set(catKey(prefix, dirPath), category.label);
    }
  }

  return { pages, lang, pageIds };
}

/**
 * Assemble the manifest from the default locale's build. Also mints the
 * sidebar `_cat` labels and `_adm` defaults into that build's lang map.
 *
 * @param {object} input
 * @param {{ pages: Map<string, object>, lang: Map<string, string> }} input.build  default-locale build
 */
export function buildManifest({
  build,
  categories,
  prefix,
  ns,
  defaultLocale,
  locales,
  report,
}: {
  build: LocaleBuild;
  categories: Map<string, Record<string, any>>;
  prefix: string;
  ns: string;
  defaultLocale: string;
  locales: string[];
  report: Report;
}): any {
  const access = createAccessResolver({ categories, warn: (msg) => report.warn('access', msg) });

  const { tree, order, publicOrder } = buildSidebar({
    pages: build.pages,
    categories,
    prefix,
    addLang: (key: string, value: string) => {
      if (!build.lang.has(key)) build.lang.set(key, value);
    },
    warn: (msg: string) => report.warn('sidebar', msg),
    access,
  });

  const pages: Record<string, any> = {};
  for (const [pageId, page] of build.pages) {
    pages[pageId] = { id: pageId, titleK: page.titleK, blocks: page.blocks };

    // Effective access, so a page hidden from the sidebar still says who it is for: `hidden`
    // pages stay linkable, and a link is exactly how a non-operator would otherwise reach one.
    const pageAccess = access.forPage(pageId, page.frontmatter);

    if (pageAccess !== undefined) pages[pageId].a = pageAccess;
  }

  order.forEach((pageId, i) => {
    if (i > 0) pages[pageId].prev = order[i - 1];
    if (i < order.length - 1) pages[pageId].next = order[i + 1];
  });

  const manifest: Record<string, any> = { v: 1, ns, defaultLocale, locales, tree, pages };

  // A guide with nothing gated compiles exactly as it did before this feature existed: no
  // `gated` flag, no second chain, not a byte of payload spent on an audience split that
  // does not exist. The flag is what tells the renderer the second chain is there to use.
  if (access.used()) {
    manifest.gated = true;

    publicOrder.forEach((pageId, i) => {
      if (i > 0) pages[pageId].pprev = publicOrder[i - 1];
      if (i < publicOrder.length - 1) pages[pageId].pnext = publicOrder[i + 1];
    });
  }

  const home = resolveHome(build.pages, report);

  if (home !== undefined) manifest.home = home;

  return manifest;
}

/**
 * The page marked `home: true` in its frontmatter — where the guide opens, instead of its
 * sidebar. Pairs naturally with `hidden: true`: a landing page usually should not also be a
 * sidebar row.
 *
 * Two pages claiming it is an authoring mistake, not a build-breaking one, so the first in
 * document order wins and the rest are reported. The renderer already drops the sidebar for a
 * single-page guide on its own, so this is only needed once there is more than one page.
 *
 */
function resolveHome(pages: Map<string, any>, report: Report): string | undefined {
  const declared: string[] = [];

  for (const [pageId, page] of pages) {
    if (page.frontmatter.home === true) declared.push(pageId);
  }

  if (declared.length > 1) {
    report.warn('home', `${declared.length} pages set "home: true" (${declared.join(', ')}) — using "${declared[0]}"`);
  }

  return declared[0];
}
