// Locale build + manifest assembly — pure (no filesystem); main.js feeds it
// file contents and receives structures to write.

import { ADMONITION_COLORS, compilePage } from './compile.js';
import { resolveInternalLink } from './inline.js';
import { catKey, pageKey } from './keys.js';
import { humanizeFilename, parseGuideFile } from './parse.js';
import { buildSidebar } from './sidebar.js';

/**
 * Compile every page of one locale.
 *
 * @param {object} input
 * @param {Map<string, string>} input.files       PageId → MDX source
 * @param {Map<string, object>} input.categories  dirPath → parsed _category_.json
 * @param {string} input.prefix                   'bcg.<ns>'
 * @param {number} input.maxCodeLineBytes
 * @param {Set<string>} [input.linkTargets]       valid link targets (defaults to this locale's own pages;
 *                                                pass the default locale's set when compiling translations)
 * @param {(src: string) => {w: number, h: number} | undefined} [input.imageSize]
 * @param {{ warn(scope: string, msg: string): void, error(scope: string, msg: string): void }} input.report
 * @returns {{ pages: Map<string, object>, lang: Map<string, string>, pageIds: Set<string> }}
 */
export function buildLocale({ files, categories, prefix, maxCodeLineBytes, linkTargets, imageSize, report }) {
  const pageIds = new Set(files.keys());
  const targets = linkTargets ?? pageIds;
  const pages = new Map();
  const lang = new Map();

  for (const pageId of [...files.keys()].sort()) {
    let parsed;
    try {
      parsed = parseGuideFile(files.get(pageId));
    } catch (err) {
      report.error(pageId, `parse error: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')) : '';
    const basename = pageId.slice(pageId.lastIndexOf('/') + 1);

    const result = compilePage(parsed.root, {
      frontmatter: parsed.frontmatter,
      key: (nodePath) => pageKey(prefix, pageId, nodePath),
      resolveLink: (url) => resolveInternalLink(url, dir, targets),
      getDefinition: parsed.getDefinition,
      imageSize,
      warn: (msg) => report.warn(pageId, msg),
      error: (msg) => report.error(pageId, msg),
      maxCodeLineBytes,
      fallbackTitle: humanizeFilename(basename),
    });

    // Sidebar row extras (Docusaurus-adjacent frontmatter): `icon` is a texture path shown as
    // the row thumbnail; `description` becomes a one-line subtitle. The icon is locale-independent;
    // the description rides this locale's .lang under a structural key so translations pair up.
    const icon = typeof parsed.frontmatter.icon === 'string' && parsed.frontmatter.icon !== ''
      ? parsed.frontmatter.icon
      : undefined;
    if (icon !== undefined && icon.length > 80) {
      report.warn(pageId, `icon "${icon}" exceeds 80 characters — the serializer truncates texture paths at 80`);
    }

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
 * @param {Map<string, object>} input.categories
 * @param {string} input.prefix
 * @param {string} input.ns
 * @param {string} input.defaultLocale
 * @param {string[]} input.locales
 * @param {{ warn(scope: string, msg: string): void }} input.report
 */
export function buildManifest({ build, categories, prefix, ns, defaultLocale, locales, report }) {
  const { tree, order } = buildSidebar({
    pages: build.pages,
    categories,
    prefix,
    addLang: (key, value) => {
      if (!build.lang.has(key)) build.lang.set(key, value);
    },
    warn: (msg) => report.warn('sidebar', msg),
  });

  const pages = {};
  for (const [pageId, page] of build.pages) {
    pages[pageId] = { id: pageId, titleK: page.titleK, blocks: page.blocks };
  }
  order.forEach((pageId, i) => {
    if (i > 0) pages[pageId].prev = order[i - 1];
    if (i < order.length - 1) pages[pageId].next = order[i + 1];
  });

  const manifest = { v: 1, ns, defaultLocale, locales, tree, pages };
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
 * @param {Map<string, object>} pages  PageId → { frontmatter, ... }
 * @param {{ warn(scope: string, msg: string): void }} report
 * @returns {string | undefined}
 */
function resolveHome(pages, report) {
  const declared = [];

  for (const [pageId, page] of pages) {
    if (page.frontmatter.home === true) declared.push(pageId);
  }

  if (declared.length > 1) {
    report.warn('home', `${declared.length} pages set "home: true" (${declared.join(', ')}) — using "${declared[0]}"`);
  }

  return declared[0];
}
