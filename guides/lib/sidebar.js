// Sidebar tree + prev/next pagination — Docusaurus conventions:
// folder structure defines categories, `_category_.json` files control label /
// position / collapsed / link, frontmatter `sidebar_position` orders pages,
// ordering falls back to alphabetical, prev/next follow sidebar DFS order.

import { catKey } from './keys.js';
import { humanizeFilename } from './parse.js';

/**
 * @param {object} input
 * @param {Map<string, object>} input.pages       PageId → { frontmatter, titleK }
 * @param {Map<string, object>} input.categories  dirPath → parsed _category_.json
 * @param {string} input.prefix                   key prefix ('bcg.<ns>')
 * @param {(key: string, value: string) => void} input.addLang
 * @param {(msg: string) => void} input.warn
 * @returns {{ tree: Array, order: string[] }}    order = PageIds in DFS order
 */
export function buildSidebar({ pages, categories, prefix, addLang, warn }) {
  // Group page ids and child directories per directory path ('' = root).
  const dirPages = new Map(); // dirPath → PageId[]
  const dirChildren = new Map(); // dirPath → Set<childDirPath>

  const ensureDir = (dirPath) => {
    if (dirPages.has(dirPath)) return;
    dirPages.set(dirPath, []);
    dirChildren.set(dirPath, new Set());
    if (dirPath !== '') {
      const parent = dirPath.includes('/') ? dirPath.slice(0, dirPath.lastIndexOf('/')) : '';
      ensureDir(parent);
      dirChildren.get(parent).add(dirPath);
    }
  };

  ensureDir('');
  for (const pageId of pages.keys()) {
    const dir = pageId.includes('/') ? pageId.slice(0, pageId.lastIndexOf('/')) : '';
    ensureDir(dir);
    dirPages.get(dir).push(pageId);
  }
  for (const dirPath of categories.keys()) ensureDir(dirPath);

  const resolveCategoryLink = (dirPath, link) => {
    if (link === undefined || link === null) return undefined;
    // Accept a plain PageId string or Docusaurus' { type: 'doc', id } form.
    const id = typeof link === 'string' ? link : link.type === 'doc' ? link.id : undefined;
    if (id === undefined) {
      warn(`_category_.json in "${dirPath}": unsupported link form — ignored`);
      return undefined;
    }
    const candidates = id.includes('/') ? [id] : [`${dirPath}/${id}`, id];
    for (const candidate of candidates) {
      if (pages.has(candidate)) return candidate;
    }
    warn(`_category_.json in "${dirPath}": link target "${id}" does not exist — ignored`);
    return undefined;
  };

  const buildDir = (dirPath) => {
    const entries = [];

    for (const pageId of dirPages.get(dirPath) ?? []) {
      const page = pages.get(pageId);
      if (page.frontmatter.hidden === true) continue;
      const node = { t: 'page', id: pageId, titleK: page.titleK };
      if (page.icon !== undefined) node.icon = page.icon;
      if (page.descK !== undefined) node.descK = page.descK;
      entries.push({
        sort: [numberOr(page.frontmatter.sidebar_position, Infinity), pageId],
        node,
      });
    }

    for (const childDir of dirChildren.get(dirPath) ?? []) {
      const category = categories.get(childDir) ?? {};
      const dirName = childDir.slice(childDir.lastIndexOf('/') + 1);
      const labelK = catKey(prefix, childDir);
      addLang(labelK, typeof category.label === 'string' ? category.label : humanizeFilename(dirName));

      const node = { t: 'cat', id: childDir, labelK, children: buildDir(childDir) };
      if (category.collapsed === true) node.collapsed = true;
      if (typeof category.icon === 'string' && category.icon !== '') node.icon = category.icon;
      const link = resolveCategoryLink(childDir, category.link);
      if (link !== undefined) node.link = link;
      if (node.children.length === 0 && node.link === undefined) {
        warn(`category "${childDir}" has no visible pages — dropped from the sidebar`);
        continue;
      }
      entries.push({ sort: [numberOr(category.position, Infinity), dirName], node });
    }

    entries.sort((a, b) => (a.sort[0] - b.sort[0]) || (a.sort[1] < b.sort[1] ? -1 : 1));
    return entries.map((e) => e.node);
  };

  const tree = buildDir('');

  // DFS page order for prev/next: a category's link page slots in ahead of
  // its children (it acts as the category's landing page).
  const order = [];
  const seen = new Set();
  const visit = (nodes) => {
    for (const node of nodes) {
      if (node.t === 'page') {
        if (!seen.has(node.id)) {
          seen.add(node.id);
          order.push(node.id);
        }
      } else {
        if (node.link !== undefined && !seen.has(node.link)) {
          seen.add(node.link);
          order.push(node.link);
        }
        visit(node.children);
      }
    }
  };
  visit(tree);

  return { tree, order };
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
